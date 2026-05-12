//! Send to Kindle via Cloudflare Email Service.
//!
//! Hands a book attachment + Kindle address to a relay Worker that calls
//! Cloudflare's Email Service. The Cloudflare API token never leaves the
//! Worker; the desktop app only knows the public URL.
//!
//! See `workers/kindle/` for the Worker source.

use crate::plugins::{
    PluginDescriptor, SendContext, SendProgress, SendRequest, SendResult, SendTarget,
    SendTargetSettings, SettingField, SettingKind,
};
use anyhow::{anyhow, Result};
use async_trait::async_trait;
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use serde::Serialize;

const MAX_ATTACHMENT_BYTES: usize = 5 * 1024 * 1024 - 4096; // Email Service caps total at 5 MiB.

pub struct KindleCloudflareTarget;

#[derive(Serialize)]
struct RelayRequest<'a> {
    kindle_address: &'a str,
    filename: String,
    content_base64: String,
    content_type: &'a str,
    title: Option<&'a str>,
    author: Option<&'a str>,
}

#[async_trait]
impl SendTarget for KindleCloudflareTarget {
    fn descriptor(&self) -> PluginDescriptor {
        PluginDescriptor {
            id: "kindle-cloudflare".into(),
            name: "Send to Kindle".into(),
            description:
                "Deliver an EPUB or PDF to your Kindle via the Common Stacks relay. \
                 Add the relay's sender address to Amazon's Approved Personal Document E-mail List."
                    .into(),
        }
    }

    fn settings_schema(&self) -> Vec<SettingField> {
        vec![
            SettingField {
                key: "kindle_address".into(),
                label: "Kindle email".into(),
                help: Some(
                    "Your personal @kindle.com address. Find it under \"Manage Your Content and Devices\" on Amazon."
                        .into(),
                ),
                required: true,
                kind: SettingKind::Email,
                placeholder: Some("yourname@kindle.com".into()),
                default: None,
            },
            SettingField {
                key: "relay_url".into(),
                label: "Relay endpoint".into(),
                help: Some(
                    "Defaults to the Common Stacks public relay. Override only if you host your own."
                        .into(),
                ),
                required: false,
                kind: SettingKind::Url,
                placeholder: Some("https://kindle.commonstacks.com/send".into()),
                default: Some("https://kindle.commonstacks.com/send".into()),
            },
        ]
    }

    async fn send(
        &self,
        req: &SendRequest,
        settings: &SendTargetSettings,
        ctx: &SendContext,
    ) -> Result<SendResult> {
        let kindle = settings
            .fields
            .get("kindle_address")
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .ok_or_else(|| anyhow!("Kindle email is required"))?;
        let relay = settings
            .fields
            .get("relay_url")
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "https://kindle.commonstacks.com/send".into());
        // Shared secret is baked in at build time (see src-tauri/build.rs).
        // Falls back to the per-target setting only if a user has set one for
        // a self-hosted relay — which the UI no longer exposes, but we still
        // honor for backwards compatibility with existing configs.
        let shared_secret = option_env!("CS_KINDLE_RELAY_SECRET")
            .map(|s| s.to_string())
            .filter(|s| !s.is_empty())
            .or_else(|| {
                settings
                    .fields
                    .get("shared_secret")
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
            });

        let filename = req
            .file_path
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .ok_or_else(|| anyhow!("invalid file path"))?;

        ctx.emit(SendProgress::stage("reading", "Reading file…"));
        let bytes = tokio::fs::read(&req.file_path).await?;
        if bytes.len() > MAX_ATTACHMENT_BYTES {
            return Err(anyhow!(
                "File is {:.1} MB — Amazon and Cloudflare Email Service cap total message size at 5 MiB. \
                 Try enabling EPUB optimization on the Crosspoint target, or use the SMTP Kindle plugin which is less strict.",
                bytes.len() as f64 / 1024.0 / 1024.0
            ));
        }

        ctx.emit(SendProgress::stage(
            "encoding",
            format!("Encoding {} ({:.1} MB)…", filename, bytes.len() as f64 / 1024.0 / 1024.0),
        ));
        let content_base64 = B64.encode(&bytes);

        ctx.emit(SendProgress::stage(
            "uploading",
            format!("Sending to {}…", kindle),
        ));

        let payload = RelayRequest {
            kindle_address: &kindle,
            filename: filename.clone(),
            content_base64,
            content_type: mime_for(&filename),
            title: req.title.as_deref(),
            author: req.author.as_deref(),
        };

        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(120))
            .user_agent("Common Stacks/0.1")
            .build()?;
        let mut http_req = client.post(&relay).json(&payload);
        if let Some(token) = shared_secret {
            http_req = http_req.header("x-cs-token", token);
        }
        let resp = http_req.send().await?;
        let status = resp.status();
        let body: serde_json::Value = resp.json().await.unwrap_or_else(|_| serde_json::json!({}));
        let ok = body.get("ok").and_then(|v| v.as_bool()).unwrap_or(false);
        let message = body
            .get("message")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        if status.is_success() && ok {
            Ok(SendResult {
                ok: true,
                message: if message.is_empty() {
                    format!("sent to {}", kindle)
                } else {
                    message
                },
            })
        } else if status.as_u16() == 401 {
            Err(anyhow!(
                "The Kindle relay rejected this request. The build may be missing the relay secret — \
                 rebuild from source with the latest workers/kindle/.env present."
            ))
        } else {
            Err(anyhow!(
                "Relay returned {}: {}",
                status,
                if message.is_empty() {
                    "no error body".into()
                } else {
                    message
                }
            ))
        }
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
        "txt" => "text/plain",
        _ => "application/octet-stream",
    }
}
