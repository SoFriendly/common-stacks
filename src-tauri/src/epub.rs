use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::io::Cursor;
use std::path::Path;
use zip::ZipArchive;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct EpubMetadata {
    pub title: Option<String>,
    pub authors: Vec<String>,
    pub identifiers: Vec<String>,
    pub language: Option<String>,
}

pub fn inspect_path(path: &Path) -> Result<EpubMetadata> {
    let bytes = std::fs::read(path)?;
    inspect_bytes(&bytes)
}

pub fn inspect_bytes(bytes: &[u8]) -> Result<EpubMetadata> {
    let mut archive = ZipArchive::new(Cursor::new(bytes))?;

    // Find the OPF path via META-INF/container.xml
    let opf_path = {
        let mut container = archive.by_name("META-INF/container.xml")?;
        let mut s = String::new();
        std::io::Read::read_to_string(&mut container, &mut s)?;
        find_opf(&s).unwrap_or_else(|| "content.opf".to_string())
    };

    let opf_xml = {
        let mut f = archive.by_name(&opf_path)?;
        let mut s = String::new();
        std::io::Read::read_to_string(&mut f, &mut s)?;
        s
    };

    Ok(parse_opf(&opf_xml))
}

fn find_opf(container: &str) -> Option<String> {
    // crude: look for full-path="..."
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
                    "title" | "creator" | "identifier" | "language"
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
