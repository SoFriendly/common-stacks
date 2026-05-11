use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::io::{Cursor, Read};
use std::path::Path;
use zip::ZipArchive;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct EpubMetadata {
    pub title: Option<String>,
    pub authors: Vec<String>,
    pub identifiers: Vec<String>,
    pub language: Option<String>,
    pub description: Option<String>,
    pub publisher: Option<String>,
    pub subjects: Vec<String>,
    /// Cover image as a data URL (or absent if none).
    pub cover_data_url: Option<String>,
}

pub fn inspect_path(path: &Path) -> Result<EpubMetadata> {
    let bytes = std::fs::read(path)?;
    inspect_bytes(&bytes)
}

pub fn inspect_bytes(bytes: &[u8]) -> Result<EpubMetadata> {
    let mut archive = ZipArchive::new(Cursor::new(bytes))?;

    let opf_path = {
        let mut container = archive.by_name("META-INF/container.xml")?;
        let mut s = String::new();
        container.read_to_string(&mut s)?;
        find_opf(&s).unwrap_or_else(|| "content.opf".to_string())
    };

    let opf_xml = {
        let mut f = archive.by_name(&opf_path)?;
        let mut s = String::new();
        f.read_to_string(&mut s)?;
        s
    };

    let mut meta = parse_opf(&opf_xml);
    if let Some((bytes, mime)) = extract_cover(&mut archive, &opf_path, &opf_xml) {
        meta.cover_data_url = Some(to_data_url(&mime, &bytes));
    }
    Ok(meta)
}

fn find_opf(container: &str) -> Option<String> {
    let key = "full-path=\"";
    let idx = container.find(key)?;
    let rest = &container[idx + key.len()..];
    let end = rest.find('"')?;
    Some(rest[..end].to_string())
}

fn parse_opf(xml: &str) -> EpubMetadata {
    use quick_xml::events::Event;
    use quick_xml::Reader;

    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);

    let mut meta = EpubMetadata::default();
    let mut text_buf = String::new();
    let mut current: Option<String> = None;
    let mut buf = Vec::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Eof) | Err(_) => break,
            Ok(Event::Start(e)) => {
                let name = local(e.name().as_ref());
                if matches!(
                    name.as_str(),
                    "title"
                        | "creator"
                        | "identifier"
                        | "language"
                        | "description"
                        | "publisher"
                        | "subject"
                ) {
                    current = Some(name);
                    text_buf.clear();
                }
            }
            Ok(Event::Text(t)) => {
                if current.is_some() {
                    text_buf.push_str(&t.xml_content().unwrap_or_default());
                }
            }
            Ok(Event::End(e)) => {
                let name = local(e.name().as_ref());
                if Some(name.as_str()) == current.as_deref() {
                    let val = text_buf.trim().to_string();
                    match name.as_str() {
                        "title" if meta.title.is_none() => meta.title = Some(val),
                        "creator" => meta.authors.push(val),
                        "identifier" => meta.identifiers.push(val),
                        "language" if meta.language.is_none() => meta.language = Some(val),
                        "description" if meta.description.is_none() => {
                            meta.description = Some(val)
                        }
                        "publisher" if meta.publisher.is_none() => meta.publisher = Some(val),
                        "subject" => meta.subjects.push(val),
                        _ => {}
                    }
                    current = None;
                }
            }
            _ => {}
        }
        buf.clear();
    }

    meta
}

fn local(n: &[u8]) -> String {
    let s = String::from_utf8_lossy(n);
    s.rsplit_once(':').map(|(_, l)| l.to_string()).unwrap_or_else(|| s.into_owned())
}

const MAX_COVER_BYTES: usize = 6 * 1024 * 1024;

/// Find and extract the cover image. Mirrors Mayberry's two-strategy approach:
/// 1. EPUB 3 — manifest item with `properties="cover-image"`.
/// 2. EPUB 2 — `<meta name="cover" content="item-id"/>` → manifest item.
fn extract_cover<R: Read + std::io::Seek>(
    archive: &mut ZipArchive<R>,
    opf_path: &str,
    opf_xml: &str,
) -> Option<(Vec<u8>, String)> {
    let opf_dir = opf_path.rsplit_once('/').map(|(d, _)| d).unwrap_or("");
    let (manifest, metas) = parse_manifest_and_metas(opf_xml);

    // Strategy 1: EPUB 3.
    for item in &manifest {
        if item.properties.contains("cover-image") {
            if let Some(bytes) = read_zip(archive, &join_path(opf_dir, &item.href)) {
                return Some((bytes, item.media_type.clone()));
            }
        }
    }

    // Strategy 2: EPUB 2.
    if let Some(cover_id) = metas
        .iter()
        .find(|(name, _)| name.eq_ignore_ascii_case("cover"))
        .map(|(_, content)| content.clone())
    {
        if let Some(item) = manifest
            .iter()
            .find(|m| m.id == cover_id && m.media_type.starts_with("image/"))
        {
            if let Some(bytes) = read_zip(archive, &join_path(opf_dir, &item.href)) {
                return Some((bytes, item.media_type.clone()));
            }
        }
    }

    None
}

#[derive(Default)]
struct ManifestItem {
    id: String,
    href: String,
    media_type: String,
    properties: String,
}

fn parse_manifest_and_metas(xml: &str) -> (Vec<ManifestItem>, Vec<(String, String)>) {
    use quick_xml::events::Event;
    use quick_xml::Reader;

    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);

    let mut manifest = Vec::new();
    let mut metas = Vec::new();
    let mut buf = Vec::new();
    let mut in_manifest = false;
    let mut in_metadata = false;

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Eof) | Err(_) => break,
            Ok(Event::Start(e)) => {
                let name = local(e.name().as_ref());
                if name == "manifest" {
                    in_manifest = true;
                } else if name == "metadata" {
                    in_metadata = true;
                } else if in_manifest && name == "item" {
                    manifest.push(item_from_attrs(&e));
                } else if in_metadata && name == "meta" {
                    if let Some(pair) = meta_from_attrs(&e) {
                        metas.push(pair);
                    }
                }
            }
            Ok(Event::Empty(e)) => {
                let name = local(e.name().as_ref());
                if in_manifest && name == "item" {
                    manifest.push(item_from_attrs(&e));
                } else if in_metadata && name == "meta" {
                    if let Some(pair) = meta_from_attrs(&e) {
                        metas.push(pair);
                    }
                }
            }
            Ok(Event::End(e)) => {
                let name = local(e.name().as_ref());
                if name == "manifest" {
                    in_manifest = false;
                } else if name == "metadata" {
                    in_metadata = false;
                }
            }
            _ => {}
        }
        buf.clear();
    }
    (manifest, metas)
}

fn item_from_attrs(e: &quick_xml::events::BytesStart<'_>) -> ManifestItem {
    let mut item = ManifestItem::default();
    for a in e.attributes().flatten() {
        let k = local(a.key.as_ref());
        let v = a
            .unescape_value()
            .map(|c| c.into_owned())
            .unwrap_or_else(|_| String::from_utf8_lossy(&a.value).into_owned());
        match k.as_str() {
            "id" => item.id = v,
            "href" => item.href = v,
            "media-type" => item.media_type = v,
            "properties" => item.properties = v,
            _ => {}
        }
    }
    item
}

fn meta_from_attrs(e: &quick_xml::events::BytesStart<'_>) -> Option<(String, String)> {
    let mut name = String::new();
    let mut content = String::new();
    for a in e.attributes().flatten() {
        let k = local(a.key.as_ref());
        let v = a
            .unescape_value()
            .map(|c| c.into_owned())
            .unwrap_or_else(|_| String::from_utf8_lossy(&a.value).into_owned());
        match k.as_str() {
            "name" => name = v,
            "content" => content = v,
            _ => {}
        }
    }
    if name.is_empty() || content.is_empty() {
        None
    } else {
        Some((name, content))
    }
}

fn join_path(dir: &str, rel: &str) -> String {
    if dir.is_empty() {
        rel.to_string()
    } else {
        format!("{}/{}", dir, rel)
    }
}

fn read_zip<R: Read + std::io::Seek>(archive: &mut ZipArchive<R>, name: &str) -> Option<Vec<u8>> {
    let mut f = archive.by_name(name).ok()?;
    if f.size() as usize > MAX_COVER_BYTES {
        return None;
    }
    let mut bytes = Vec::with_capacity(f.size() as usize);
    f.read_to_end(&mut bytes).ok()?;
    Some(bytes)
}

fn to_data_url(mime: &str, bytes: &[u8]) -> String {
    use base64::{engine::general_purpose::STANDARD as B64, Engine};
    let mime = if mime.is_empty() { "image/jpeg" } else { mime };
    format!("data:{};base64,{}", mime, B64.encode(bytes))
}
