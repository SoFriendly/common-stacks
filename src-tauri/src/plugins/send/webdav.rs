use crate::plugins::{
    PluginDescriptor, SendContext, SendRequest, SendResult, SendTarget, SendTargetSettings,
    SettingField, SettingKind,
};
use anyhow::{anyhow, Result};
use async_trait::async_trait;

pub struct WebDavTarget;

#[async_trait]
impl SendTarget for WebDavTarget {
    fn descriptor(&self) -> PluginDescriptor {
        PluginDescriptor {
            id: "webdav".into(),
            name: "WebDAV".into(),
            description:
                "Upload a book file to a WebDAV server (Nextcloud, ownCloud, KOReader, etc.)."
                    .into(),
        }
    }

    fn settings_schema(&self) -> Vec<SettingField> {
        vec![
            SettingField {
                key: "base_url".into(),
                label: "WebDAV base URL".into(),
                help: Some("Folder to upload into, e.g. https://cloud.example.com/remote.php/dav/files/me/Books/".into()),
                required: true,
                kind: SettingKind::Url,
                placeholder: Some("https://cloud.example.com/path/".into()),
                default: None,
            },
            SettingField {
                key: "username".into(),
                label: "Username".into(),
                help: None,
                required: false,
                kind: SettingKind::Text,
                placeholder: None,
                default: None,
            },
            SettingField {
                key: "password".into(),
                label: "Password".into(),
                help: Some("Use an app-specific password where supported.".into()),
                required: false,
                kind: SettingKind::Secret,
                placeholder: None,
                default: None,
            },
        ]
    }

    async fn send(
        &self,
        req: &SendRequest,
        settings: &SendTargetSettings,
        _ctx: &SendContext,
    ) -> Result<SendResult> {
        let base = settings
            .fields
            .get("base_url")
            .ok_or_else(|| anyhow!("missing base_url"))?
            .trim_end_matches('/')
            .to_string();
        let user = settings.fields.get("username").cloned().unwrap_or_default();
        let pass = settings.fields.get("password").cloned().unwrap_or_default();

        let filename = req
            .file_path
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .ok_or_else(|| anyhow!("invalid file path"))?;
        let target = format!("{}/{}", base, urlencode_path(&filename));

        let bytes = tokio::fs::read(&req.file_path).await?;

        let client = crate::tls::client_builder()
            .timeout(std::time::Duration::from_secs(120))
            .user_agent("Common Stacks/0.1")
            .build()?;
        let mut req_b = client.put(&target).body(bytes);
        if !user.is_empty() {
            req_b = req_b.basic_auth(user, Some(pass));
        }
        let resp = req_b.send().await?;
        let status = resp.status();
        if status.is_success() {
            Ok(SendResult {
                ok: true,
                message: format!("uploaded to {}", target),
            })
        } else {
            let body = resp.text().await.unwrap_or_default();
            Err(anyhow!("WebDAV PUT {} returned {}: {}", target, status, body))
        }
    }
}

fn urlencode_path(s: &str) -> String {
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
