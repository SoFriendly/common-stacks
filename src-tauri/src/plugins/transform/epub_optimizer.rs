//! EPUB image optimizer.
//!
//! Mirrors the on-device JavaScript optimizer from the Crosspoint Reader's
//! FilesPage.html. Re-encodes every image inside an EPUB as a single-quality
//! JPEG, renames the entry, and rewrites OPF/XHTML/CSS references so the book
//! still opens cleanly. Output is a valid EPUB OCF (mimetype first, STORE).

use crate::plugins::{
    PluginDescriptor, SendProgress, SendTargetSettings, SettingField, SettingKind, Transformer,
};
use anyhow::{anyhow, Result};
use async_trait::async_trait;
use image::codecs::jpeg::JpegEncoder;
use image::ImageReader;
use std::collections::HashMap;
use std::io::{Cursor, Read, Write};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

pub struct EpubOptimizer;

const IMG_EXTENSIONS: &[&str] = &["png", "gif", "webp", "bmp", "jpg", "jpeg"];
const TEXT_EXTENSIONS: &[&str] = &[
    "html", "xhtml", "htm", "opf", "ncx", "xml", "css", "smil",
];
#[allow(dead_code)]
pub const DEFAULT_QUALITY: u8 = 70;

#[async_trait]
impl Transformer for EpubOptimizer {
    fn descriptor(&self) -> PluginDescriptor {
        PluginDescriptor {
            id: "epub-image-optimizer".into(),
            name: "EPUB image optimizer".into(),
            description:
                "Recompress images inside EPUB files as JPEG to reduce size on device storage. \
                 Only runs on .epub files."
                    .into(),
        }
    }

    fn applies_to(&self) -> &[&'static str] {
        &["epub"]
    }

    fn settings_schema(&self) -> Vec<SettingField> {
        vec![
            SettingField {
                key: "enabled".into(),
                label: "Optimize EPUB images before upload".into(),
                help: Some(
                    "Recompresses PNG/GIF/WEBP/BMP images inside the EPUB as JPEG. Useful for slow storage on e-readers."
                        .into(),
                ),
                required: false,
                kind: SettingKind::Boolean,
                placeholder: None,
                default: Some("false".into()),
            },
            SettingField {
                key: "quality".into(),
                label: "JPEG quality".into(),
                help: Some("1–100. Lower values shrink the file but soften images.".into()),
                required: false,
                kind: SettingKind::Number,
                placeholder: Some(format!("{}", DEFAULT_QUALITY)),
                default: Some(format!("{}", DEFAULT_QUALITY)),
            },
        ]
    }

    async fn transform(
        &self,
        input: Vec<u8>,
        settings: &SendTargetSettings,
    ) -> Result<Vec<u8>> {
        let enabled = settings
            .fields
            .get("enabled")
            .map(|s| s == "true")
            .unwrap_or(false);
        if !enabled {
            return Ok(input);
        }
        let quality: u8 = settings
            .fields
            .get("quality")
            .and_then(|s| s.trim().parse().ok())
            .map(|n: u32| n.clamp(1, 100) as u8)
            .unwrap_or(DEFAULT_QUALITY);
        run(input, quality).await
    }
}

/// Standalone entry point so send targets (e.g. Crosspoint) can call the
/// optimizer directly from their own toggle without going through the
/// plugin registry. Always runs the heavy work on a blocking thread.
#[allow(dead_code)]
pub async fn run(input: Vec<u8>, quality: u8) -> Result<Vec<u8>> {
    run_with_progress(input, quality, None).await
}

pub type ProgressCallback = Box<dyn Fn(SendProgress) + Send + Sync + 'static>;

pub async fn run_with_progress(
    input: Vec<u8>,
    quality: u8,
    progress: Option<ProgressCallback>,
) -> Result<Vec<u8>> {
    tokio::task::spawn_blocking(move || optimize_blocking(&input, quality, progress.as_deref()))
        .await
        .map_err(|e| anyhow!("optimizer task panicked: {}", e))?
}

fn optimize_blocking(
    input: &[u8],
    quality: u8,
    progress: Option<&(dyn Fn(SendProgress) + Send + Sync)>,
) -> Result<Vec<u8>> {
    let emit = |p: SendProgress| {
        if let Some(cb) = progress {
            cb(p);
        }
    };
    let mut archive = ZipArchive::new(Cursor::new(input))?;
    let mut out_buf = Cursor::new(Vec::with_capacity(input.len()));
    let mut out = ZipWriter::new(&mut out_buf);

    // First pass: figure out which entries we'll rename (image → .jpg) so the
    // text-rewrite step can swap references in one shot. Also count total
    // images so progress can report "N of M".
    let mut renames: HashMap<String, String> = HashMap::new();
    let mut total_images: u64 = 0;
    for i in 0..archive.len() {
        let f = archive.by_index(i)?;
        let name = f.name().to_string();
        if let Some(ext) = extension(&name) {
            let lower = ext.to_ascii_lowercase();
            if IMG_EXTENSIONS.contains(&lower.as_str()) {
                total_images += 1;
                if lower != "jpg" {
                    let stem = &name[..name.len() - ext.len() - 1]; // strip ".<ext>"
                    renames.insert(name.clone(), format!("{}.jpg", stem));
                }
            }
        }
    }
    emit(SendProgress::ratio(
        "optimizing",
        if total_images == 0 {
            "No images to optimize".into()
        } else {
            format!("Optimizing {} images…", total_images)
        },
        0,
        total_images.max(1),
    ));

    let stored = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
    let deflated = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);

    // EPUB OCF requires `mimetype` first, stored uncompressed.
    if let Ok(mut f) = archive.by_name("mimetype") {
        let mut data = Vec::new();
        f.read_to_end(&mut data)?;
        out.start_file("mimetype", stored)?;
        out.write_all(&data)?;
    }

    let mut processed_images: u64 = 0;
    for i in 0..archive.len() {
        let mut f = archive.by_index(i)?;
        let name = f.name().to_string();
        if name == "mimetype" {
            continue;
        }
        if f.is_dir() {
            // Preserve directory entries with no content.
            out.add_directory(&name, deflated)?;
            continue;
        }

        let mut data = Vec::new();
        f.read_to_end(&mut data)?;

        let new_name = renames.get(&name).cloned().unwrap_or_else(|| name.clone());
        let lower_ext = extension(&name)
            .map(|s| s.to_ascii_lowercase())
            .unwrap_or_default();

        if IMG_EXTENSIONS.contains(&lower_ext.as_str()) {
            processed_images += 1;
            let basename = name.rsplit('/').next().unwrap_or(&name).to_string();
            emit(SendProgress::ratio(
                "optimizing",
                format!("Image {} of {}: {}", processed_images, total_images, basename),
                processed_images,
                total_images.max(1),
            ));
            match reencode_jpeg(&data, quality) {
                Ok(jpg) => {
                    out.start_file(&new_name, stored)?;
                    out.write_all(&jpg)?;
                }
                Err(e) => {
                    tracing::warn!("optimizer: keeping original {} ({})", name, e);
                    out.start_file(&name, deflated)?;
                    out.write_all(&data)?;
                }
            }
        } else if TEXT_EXTENSIONS.contains(&lower_ext.as_str()) {
            let text = String::from_utf8(data).map(|s| rewrite_text(&s, &renames));
            match text {
                Ok(updated) => {
                    out.start_file(&new_name, deflated)?;
                    out.write_all(updated.as_bytes())?;
                }
                Err(e) => {
                    out.start_file(&new_name, deflated)?;
                    out.write_all(e.as_bytes())?;
                }
            }
        } else {
            out.start_file(&new_name, deflated)?;
            out.write_all(&data)?;
        }
    }

    out.finish()?;
    Ok(out_buf.into_inner())
}

fn extension(name: &str) -> Option<&str> {
    let last = name.rsplit('/').next()?;
    let idx = last.rfind('.')?;
    if idx + 1 >= last.len() {
        return None;
    }
    Some(&last[idx + 1..])
}

fn reencode_jpeg(bytes: &[u8], quality: u8) -> Result<Vec<u8>> {
    let img = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()?
        .decode()?;
    let rgb = img.to_rgb8();
    let mut out = Vec::with_capacity(bytes.len() / 2);
    {
        let mut enc = JpegEncoder::new_with_quality(&mut out, quality);
        enc.encode(&rgb, rgb.width(), rgb.height(), image::ExtendedColorType::Rgb8)?;
    }
    Ok(out)
}

/// Rewrite image filename references inside text-like EPUB entries. Replaces
/// the full path, the basename, and updates known image MIME types to
/// image/jpeg. Done as a string replace; HTML attribute boundaries are
/// preserved because the search strings include the original extension.
fn rewrite_text(input: &str, renames: &HashMap<String, String>) -> String {
    let mut out = input.to_string();
    for (old, new) in renames {
        out = out.replace(old, new);
        if let (Some(old_base), Some(new_base)) =
            (old.rsplit('/').next(), new.rsplit('/').next())
        {
            if old_base != old.as_str() {
                out = out.replace(old_base, new_base);
            }
        }
    }
    out = out.replace("image/png", "image/jpeg");
    out = out.replace("image/gif", "image/jpeg");
    out = out.replace("image/webp", "image/jpeg");
    out = out.replace("image/bmp", "image/jpeg");
    out
}
