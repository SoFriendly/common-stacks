//! Send-to-device target for the Crosspoint Reader.
//!
//! Reverse-engineered from the firmware at
//! https://github.com/jmitch/crosspoint-reader-main:
//!   * `POST /upload?path=<dir>` with a multipart/form-data body — no auth, no
//!     CSRF; the upload handler streams the file part to the SD card.
//!   * `GET /api/status` returns JSON with `{version, ip, mode, ...}` and is a
//!     reliable way to confirm the device is actually a Crosspoint before
//!     attempting an upload.
//! Device hostname is `crosspoint.local` via mDNS on both STA and AP modes.

use crate::plugins::{
    PluginDescriptor, SendContext, SendProgress, SendRequest, SendResult, SendTarget,
    SendTargetSettings, SettingField, SettingKind,
};
use anyhow::{anyhow, Result};
use async_trait::async_trait;
use reqwest::multipart::{Form, Part};
use serde::Deserialize;

pub struct CrosspointTarget;

#[derive(Deserialize)]
struct StatusResponse {
    #[serde(default)]
    version: String,
    #[serde(default)]
    mode: String,
}

#[async_trait]
impl SendTarget for CrosspointTarget {
    fn descriptor(&self) -> PluginDescriptor {
        PluginDescriptor {
            id: "crosspoint".into(),
            name: "Crosspoint Reader".into(),
            description: "Upload books over Wi-Fi to a Crosspoint Reader on your local network.".into(),
        }
    }

    fn settings_schema(&self) -> Vec<SettingField> {
        vec![
            SettingField {
                key: "host".into(),
                label: "Hostname or IP".into(),
                help: Some(
                    "Use the device's IP if mDNS is unreliable on your network.".into(),
                ),
                required: false,
                kind: SettingKind::Text,
                placeholder: Some("crosspoint.local".into()),
                default: Some("crosspoint.local".into()),
            },
            SettingField {
                key: "port".into(),
                label: "Port".into(),
                help: None,
                required: false,
                kind: SettingKind::Number,
                placeholder: Some("80".into()),
                default: Some("80".into()),
            },
            SettingField {
                key: "folder".into(),
                label: "Destination folder".into(),
                help: Some(
                    "Path on the device's SD card. Must start with /. The folder must already exist — the device won't create it."
                        .into(),
                ),
                required: false,
                kind: SettingKind::Text,
                placeholder: Some("/".into()),
                default: Some("/".into()),
            },
            SettingField {
                key: "optimize_epubs".into(),
                label: "Optimize EPUB images before upload".into(),
                help: Some(
                    "Re-encodes images inside .epub files as JPEG to shrink the file. \
                     Non-EPUB files are uploaded as-is."
                        .into(),
                ),
                required: false,
                kind: SettingKind::Boolean,
                placeholder: None,
                default: Some("false".into()),
            },
            SettingField {
                key: "optimize_quality".into(),
                label: "JPEG quality".into(),
                help: Some("1–100. Only applies when EPUB optimization is on.".into()),
                required: false,
                kind: SettingKind::Number,
                placeholder: Some("70".into()),
                default: Some("70".into()),
            },
        ]
    }

    async fn send(
        &self,
        req: &SendRequest,
        settings: &SendTargetSettings,
        ctx: &SendContext,
    ) -> Result<SendResult> {
        let host = settings
            .fields
            .get("host")
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "crosspoint.local".into());
        let port: u16 = settings
            .fields
            .get("port")
            .and_then(|s| s.trim().parse().ok())
            .unwrap_or(80);
        let folder = {
            let raw = settings
                .fields
                .get("folder")
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| "/".into());
            if raw.starts_with('/') {
                raw
            } else {
                format!("/{}", raw)
            }
        };

        let base = format!("http://{}:{}", host, port);
        ctx.emit(SendProgress::stage("connecting", format!("Looking for {}…", host)));

        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(600))
            .connect_timeout(std::time::Duration::from_secs(8))
            .user_agent("CommonStacks/0.1")
            .build()?;

        // Probe /api/status first so we fail fast with a clear message if the
        // host isn't actually a Crosspoint.
        let status_url = format!("{}/api/status", base);
        match client.get(&status_url).send().await {
            Ok(resp) if resp.status().is_success() => {
                // Best-effort parse; firmware versions <1.0 may not include all fields.
                if let Ok(body) = resp.json::<StatusResponse>().await {
                    tracing::info!(
                        "Crosspoint detected at {} (v{}, mode={})",
                        host,
                        body.version,
                        body.mode
                    );
                }
            }
            Ok(resp) => {
                return Err(anyhow!(
                    "Probe of {} returned HTTP {} — host may not be a Crosspoint Reader.",
                    status_url,
                    resp.status()
                ));
            }
            Err(e) => {
                return Err(anyhow!(
                    "Could not reach {} ({}). Is the Crosspoint on the network and is mDNS working?",
                    base,
                    e
                ));
            }
        }

        let filename = req
            .file_path
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .ok_or_else(|| anyhow!("invalid file path"))?;
        ctx.emit(SendProgress::stage("reading", "Reading file…"));
        let mut bytes = tokio::fs::read(&req.file_path).await?;

        let optimize_enabled = settings
            .fields
            .get("optimize_epubs")
            .map(|s| s == "true")
            .unwrap_or(false);
        let is_epub = filename
            .rsplit('.')
            .next()
            .map(|s| s.eq_ignore_ascii_case("epub"))
            .unwrap_or(false);
        if optimize_enabled && is_epub {
            let quality: u8 = settings
                .fields
                .get("optimize_quality")
                .and_then(|s| s.trim().parse().ok())
                .map(|n: u32| n.clamp(1, 100) as u8)
                .unwrap_or(70);
            ctx.emit(SendProgress::stage(
                "optimizing",
                format!("Optimizing EPUB (Q{})…", quality),
            ));
            let progress = ctx.clone();
            let original_size = bytes.len();
            match crate::plugins::transform::epub_optimizer::run_with_progress(
                bytes.clone(),
                quality,
                Some(Box::new(move |p| progress.emit(p))),
            )
            .await
            {
                Ok(optimized) => {
                    tracing::info!(
                        "EPUB optimizer: {} -> {} bytes (Q{})",
                        original_size,
                        optimized.len(),
                        quality
                    );
                    let pct = if original_size > 0 {
                        100u64 - (optimized.len() as u64 * 100 / original_size as u64)
                    } else {
                        0
                    };
                    ctx.emit(SendProgress::stage(
                        "optimized",
                        format!(
                            "Optimized {} → {} ({}% smaller)",
                            fmt_size(original_size),
                            fmt_size(optimized.len()),
                            pct
                        ),
                    ));
                    bytes = optimized;
                }
                Err(e) => {
                    tracing::warn!("EPUB optimizer failed, sending original: {}", e);
                    ctx.emit(SendProgress::stage(
                        "optimize_failed",
                        format!("Optimization failed, sending original ({})", e),
                    ));
                }
            }
        }

        let mime = mime_for(&filename);

        let upload_size = bytes.len();
        let part = Part::bytes(bytes)
            .file_name(filename.clone())
            .mime_str(mime)?;
        let form = Form::new().part("file", part);

        let upload_url = format!(
            "{}/upload?path={}",
            base,
            urlencode_path_component(&folder)
        );

        ctx.emit(SendProgress::stage(
            "uploading",
            format!("Uploading {} to {}…", fmt_size(upload_size), host),
        ));
        let resp = client.post(&upload_url).multipart(form).send().await?;
        let status = resp.status();
        if status.is_success() {
            Ok(SendResult {
                ok: true,
                message: format!("uploaded {} to {}{}", filename, host, folder),
            })
        } else {
            let body = resp.text().await.unwrap_or_default();
            Err(anyhow!(
                "Crosspoint upload to {} returned {}: {}",
                upload_url,
                status,
                body
            ))
        }
    }
}

fn fmt_size(n: usize) -> String {
    let n = n as f64;
    if n < 1024.0 {
        format!("{} B", n as u64)
    } else if n < 1024.0 * 1024.0 {
        format!("{:.1} KB", n / 1024.0)
    } else if n < 1024.0 * 1024.0 * 1024.0 {
        format!("{:.1} MB", n / 1024.0 / 1024.0)
    } else {
        format!("{:.2} GB", n / 1024.0 / 1024.0 / 1024.0)
    }
}

fn mime_for(filename: &str) -> &'static str {
    let ext = filename
        .rsplit('.')
        .next()
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_default();
    match ext.as_str() {
        "epub" => "application/epub+zip",
        "pdf" => "application/pdf",
        "mobi" => "application/x-mobipocket-ebook",
        "azw3" => "application/vnd.amazon.ebook",
        "cbz" => "application/vnd.comicbook+zip",
        "cbr" => "application/vnd.comicbook-rar",
        "txt" => "text/plain",
        _ => "application/octet-stream",
    }
}

/// Percent-encode a path so it's safe as a query-string value, preserving '/'.
fn urlencode_path_component(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' | b'/' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}
