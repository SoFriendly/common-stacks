use crate::plugins::{
    PluginDescriptor, SendContext, SendRequest, SendResult, SendTarget, SendTargetSettings,
    SettingField, SettingKind,
};
use anyhow::{anyhow, Result};
use async_trait::async_trait;
use lettre::message::{header::ContentType, Attachment, MultiPart, SinglePart};
use lettre::transport::smtp::authentication::Credentials;
use lettre::{AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor};

pub struct KindleEmailTarget;

#[async_trait]
impl SendTarget for KindleEmailTarget {
    fn descriptor(&self) -> PluginDescriptor {
        PluginDescriptor {
            id: "kindle-email".into(),
            name: "Send to Kindle (SMTP)".into(),
            description:
                "Advanced: email a book to your Kindle via your own SMTP server. \
                 Useful if you'd rather not use the Common Stacks relay."
                    .into(),
        }
    }

    fn settings_schema(&self) -> Vec<SettingField> {
        vec![
            SettingField {
                key: "kindle_address".into(),
                label: "Kindle email".into(),
                help: Some("e.g. yourname@kindle.com".into()),
                required: true,
                kind: SettingKind::Email,
                placeholder: Some("yourname@kindle.com".into()),
                default: None,
            },
            SettingField {
                key: "from_address".into(),
                label: "Your email (sender)".into(),
                help: Some(
                    "Must be on Amazon's Approved Personal Document E-mail List.".into(),
                ),
                required: true,
                kind: SettingKind::Email,
                placeholder: None,
                default: None,
            },
            SettingField {
                key: "smtp_host".into(),
                label: "SMTP host".into(),
                help: Some("e.g. smtp.gmail.com".into()),
                required: true,
                kind: SettingKind::Text,
                placeholder: Some("smtp.example.com".into()),
                default: None,
            },
            SettingField {
                key: "smtp_port".into(),
                label: "SMTP port".into(),
                help: Some("Typically 587 (STARTTLS) or 465 (TLS).".into()),
                required: true,
                kind: SettingKind::Number,
                placeholder: Some("587".into()),
                default: Some("587".into()),
            },
            SettingField {
                key: "smtp_username".into(),
                label: "SMTP username".into(),
                help: None,
                required: true,
                kind: SettingKind::Text,
                placeholder: None,
                default: None,
            },
            SettingField {
                key: "smtp_password".into(),
                label: "SMTP password / app password".into(),
                help: Some("App-specific password for Gmail / iCloud / etc.".into()),
                required: true,
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
        let get = |k: &str| -> Result<&String> {
            settings
                .fields
                .get(k)
                .ok_or_else(|| anyhow!("missing required setting `{}`", k))
        };
        let to = get("kindle_address")?;
        let from = get("from_address")?;
        let host = get("smtp_host")?;
        let port: u16 = get("smtp_port")?.parse().map_err(|_| anyhow!("bad smtp_port"))?;
        let user = get("smtp_username")?.clone();
        let pass = get("smtp_password")?.clone();

        let filename = req
            .file_path
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| "book.epub".into());
        let bytes = tokio::fs::read(&req.file_path).await?;
        let content_type = mime_for(&filename);

        let subject = match (&req.title, &req.author) {
            (Some(t), Some(a)) => format!("{} — {}", t, a),
            (Some(t), None) => t.clone(),
            _ => "Common Stacks book".into(),
        };

        let attachment = Attachment::new(filename).body(bytes, content_type.parse()?);

        let email = Message::builder()
            .from(from.parse()?)
            .to(to.parse()?)
            .subject(subject)
            .multipart(
                MultiPart::mixed()
                    .singlepart(
                        SinglePart::builder()
                            .header(ContentType::TEXT_PLAIN)
                            .body("Sent via Common Stacks.".to_string()),
                    )
                    .singlepart(attachment),
            )?;

        let creds = Credentials::new(user, pass);
        // Port 465 uses implicit TLS; everything else (587, 25, custom) uses
        // STARTTLS. Trying STARTTLS against 465 hangs because the server
        // expects a TLS handshake immediately.
        let builder = if port == 465 {
            AsyncSmtpTransport::<Tokio1Executor>::relay(host)?
        } else {
            AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(host)?
        };
        let mailer: AsyncSmtpTransport<Tokio1Executor> =
            builder.port(port).credentials(creds).build();

        match mailer.send(email).await {
            Ok(_) => Ok(SendResult {
                ok: true,
                message: format!("sent to {}", to),
            }),
            Err(e) => Err(anyhow!("SMTP send failed: {}", e)),
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
