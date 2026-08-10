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
//!
//! Library loan files are no longer handled by the firmware itself; newer
//! firmware delegates that to an SD plugin. We upload the loan file to the
//! destination folder, then drive the firmware's plugin job APIs to fetch the
//! book, falling back to manual instructions on older setups.

use crate::plugins::{
    PluginDescriptor, SendContext, SendProgress, SendRequest, SendResult, SendTarget,
    SendTargetSettings, SettingField, SettingKind,
};
use anyhow::{anyhow, Result};
use async_trait::async_trait;
use reqwest::multipart::{Form, Part};
use serde::Deserialize;
use std::net::{Ipv4Addr, SocketAddrV4, UdpSocket};
use std::time::Duration;

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
            description: "Upload books over Wi-Fi to a Crosspoint Reader on your local network."
                .into(),
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

        ctx.emit(SendProgress::stage(
            "connecting",
            format!("Looking for {}…", host),
        ));

        let connect_host = if host.to_ascii_lowercase().ends_with(".local") {
            ctx.emit(SendProgress::stage(
                "resolving",
                format!("Resolving {}…", host),
            ));
            // Resolve via the OS first (Bonjour on macOS, the system resolver
            // elsewhere): it's the only mDNS path macOS lets an app use — raw
            // multicast is blocked by Local Network privacy — and it returns the
            // A record fast. A direct query is a fallback for resolvers that
            // don't do .local. Pinning `base` to the IP also avoids repeating
            // the slow AAAA lookup on every request.
            let resolved = match resolve_os_ipv4(&host, port).await {
                Some(ip) => Some(ip),
                None => resolve_mdns_ipv4(&host).await,
            };
            match resolved {
                Some(ip) => {
                    ctx.emit(SendProgress::stage(
                        "resolved",
                        format!("Found {} at {}…", host, ip),
                    ));
                    ip.to_string()
                }
                None => host.clone(),
            }
        } else {
            host.clone()
        };
        let base = format!("http://{}:{}", connect_host, port);

        let client = crate::tls::client_builder()
            .timeout(Duration::from_secs(600))
            .connect_timeout(Duration::from_secs(8))
            .user_agent("Common Stacks/0.1")
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
                let hint = if host.to_ascii_lowercase().ends_with(".local") && connect_host == host
                {
                    " Android could not resolve the .local name; set the Crosspoint Reader host to its IP address in Settings."
                } else {
                    ""
                };
                return Err(anyhow!(
                    "Could not reach {} ({}). Is the Crosspoint on the network and is mDNS working?{}",
                    base,
                    e,
                    hint
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
        let is_loan = filename
            .rsplit('.')
            .next()
            .map(|s| s.eq_ignore_ascii_case(LOAN_EXT))
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

        upload_multipart(&client, &base, &folder, &filename, bytes, ctx, &host).await?;

        // Library loans: drive the device's plugin job APIs to fetch the book
        // right now; if that machinery isn't available (old firmware, plugin
        // missing, mobile build), fall back to pointing the user at the
        // device's web File Manager.
        if is_loan {
            match fulfill_loan(&client, &base, &folder, &filename, req, ctx).await {
                Ok(FulfillOutcome::Fulfilled { title, final_name }) => {
                    return Ok(SendResult {
                        ok: true,
                        message: format!(
                            "fetched \"{}\" to {}{} as {}",
                            title, host, folder, final_name
                        ),
                    });
                }
                Ok(FulfillOutcome::Unavailable(reason)) => {
                    tracing::info!("crosspoint auto-fulfill unavailable: {}", reason);
                    return Ok(SendResult {
                        ok: true,
                        message: format!(
                            "uploaded {} to {}{}. To fetch the book, open the Crosspoint's \
                             web File Manager in that folder and use Protected Content → \
                             Fetch selected book.",
                            filename, host, folder
                        ),
                    });
                }
                Err(e) => {
                    // The job ran and failed (e.g. device not activated). The
                    // loan file is still on the card for a manual retry.
                    return Err(anyhow!(
                        "{} — the loan file was uploaded to {}{}, so you can retry from \
                         the Crosspoint's web File Manager via Protected Content → Fetch \
                         selected book.",
                        e,
                        host,
                        folder
                    ));
                }
            }
        }

        Ok(SendResult {
            ok: true,
            message: format!("uploaded {} to {}{}", filename, host, folder),
        })
    }
}

// ======================================================================== //
// Loan fulfillment via the device's plugin job APIs
//
//   POST /api/plugin-jobs {plugin, action:"fulfill", args:{path}} -> {id}
//   GET  /api/plugin-jobs/status?id=N -> {state, result}
//
// Jobs only execute while a page hosting the SD plugin is open, so we spin up
// a hidden webview on the device's /plugins-run page for the duration. When
// the job finishes we read the resulting EPUB back, inspect its OPF metadata,
// and rename it (plus its .rights sidecar) to "Title - Author.epub" instead
// of the opaque name the loan file shipped with.
// ======================================================================== //

const PLUGIN_NAME: &str = "protected-content";
/// Extension of library loan files the plugin's "fulfill" action accepts.
const LOAN_EXT: &str = "acsm";
const LOAN_MIME: &str = "application/vnd.adobe.adept+xml";
const RUNNER_LABEL: &str = "crosspoint-runner";
const FULFILL_TIMEOUT: Duration = Duration::from_secs(8 * 60);
const FULFILL_POLL: Duration = Duration::from_secs(2);

enum FulfillOutcome {
    Fulfilled { title: String, final_name: String },
    /// Auto-fulfillment couldn't start; not an error, fall back to the manual
    /// instructions.
    Unavailable(String),
}

#[derive(Deserialize)]
struct PluginInfo {
    #[serde(default)]
    name: String,
}

#[derive(Deserialize)]
struct JobSubmitResponse {
    id: u64,
}

#[derive(Deserialize)]
struct JobStatusResponse {
    #[serde(default)]
    state: String,
    #[serde(default)]
    result: Option<serde_json::Value>,
}

#[derive(Deserialize)]
struct FileEntry {
    #[serde(default)]
    name: String,
}

async fn fulfill_loan(
    client: &reqwest::Client,
    base: &str,
    folder: &str,
    filename: &str,
    req: &SendRequest,
    ctx: &SendContext,
) -> Result<FulfillOutcome> {
    let Some(app) = ctx.app.as_ref() else {
        return Ok(FulfillOutcome::Unavailable("no app handle".into()));
    };
    if cfg!(any(target_os = "ios", target_os = "android")) {
        return Ok(FulfillOutcome::Unavailable(
            "runner webview needs the desktop app".into(),
        ));
    }

    // The handling plugin must be on the SD card for the job to ever run.
    let plugins: Vec<PluginInfo> = match client.get(format!("{}/api/plugins", base)).send().await {
        Ok(resp) if resp.status().is_success() => resp.json().await.unwrap_or_default(),
        _ => return Ok(FulfillOutcome::Unavailable("firmware has no plugin API".into())),
    };
    if !plugins.iter().any(|p| p.name == PLUGIN_NAME) {
        return Ok(FulfillOutcome::Unavailable(format!(
            "{} plugin not on the SD card",
            PLUGIN_NAME
        )));
    }

    let device_path = join_device_path(folder, filename);
    ctx.emit(SendProgress::stage(
        "fulfill_queue",
        "Queuing fulfillment on the device…",
    ));
    let submit = client
        .post(format!("{}/api/plugin-jobs", base))
        .json(&serde_json::json!({
            "plugin": PLUGIN_NAME,
            "action": "fulfill",
            "args": { "path": device_path },
        }))
        .send()
        .await;
    let job_id = match submit {
        Ok(resp) if resp.status().is_success() => {
            match resp.json::<JobSubmitResponse>().await {
                Ok(r) => r.id,
                Err(e) => return Ok(FulfillOutcome::Unavailable(format!("bad job response: {}", e))),
            }
        }
        Ok(resp) => {
            return Ok(FulfillOutcome::Unavailable(format!(
                "job submit returned HTTP {}",
                resp.status()
            )))
        }
        Err(e) => return Ok(FulfillOutcome::Unavailable(format!("job submit failed: {}", e))),
    };

    // Jobs only run while a page hosts the plugin; open the device's headless
    // runner in a hidden webview for the duration.
    if let Err(e) = runner::open(app, base) {
        return Ok(FulfillOutcome::Unavailable(format!(
            "could not open the runner webview: {}",
            e
        )));
    }
    let poll_result = poll_job(client, base, job_id, ctx).await;
    runner::close(app);
    let result = poll_result?;

    let title = result
        .get("title")
        .and_then(|v| v.as_str())
        .unwrap_or("book")
        .to_string();
    let dest = result
        .get("dest")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();

    // Name the fetched EPUB from its own metadata rather than whatever the
    // job result called it.
    let mut final_title = title.clone();
    let mut final_name = dest.rsplit('/').next().unwrap_or(&dest).to_string();
    if dest.ends_with(".epub") {
        match rename_from_metadata(client, base, &dest, req, ctx).await {
            Ok(Some((meta_title, new_name))) => {
                final_title = meta_title;
                final_name = new_name;
            }
            Ok(None) => {}
            Err(e) => tracing::warn!("crosspoint metadata rename skipped: {}", e),
        }
    }

    Ok(FulfillOutcome::Fulfilled {
        title: final_title,
        final_name,
    })
}

async fn poll_job(
    client: &reqwest::Client,
    base: &str,
    job_id: u64,
    ctx: &SendContext,
) -> Result<serde_json::Value> {
    let started = std::time::Instant::now();
    let mut last_state = String::new();
    loop {
        if started.elapsed() > FULFILL_TIMEOUT {
            return Err(anyhow!(
                "fulfillment timed out after {} minutes",
                FULFILL_TIMEOUT.as_secs() / 60
            ));
        }
        tokio::time::sleep(FULFILL_POLL).await;

        let status: JobStatusResponse = match client
            .get(format!("{}/api/plugin-jobs/status?id={}", base, job_id))
            .send()
            .await
        {
            Ok(resp) if resp.status().is_success() => match resp.json().await {
                Ok(s) => s,
                Err(_) => continue,
            },
            _ => continue,
        };

        if status.state != last_state {
            last_state = status.state.clone();
            let msg = match status.state.as_str() {
                "pending" => Some("Waiting for the device…"),
                "running" => Some("Fetching the book on the device…"),
                _ => None,
            };
            if let Some(m) = msg {
                ctx.emit(SendProgress::stage("fulfilling", m));
            }
        }

        match status.state.as_str() {
            "done" => {
                ctx.emit(SendProgress::stage("fulfilled", "Book fetched on the device"));
                return Ok(status.result.unwrap_or(serde_json::Value::Null));
            }
            "error" => {
                let detail = status
                    .result
                    .as_ref()
                    .and_then(|r| r.get("error"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("fulfillment failed on the device")
                    .to_string();
                return Err(anyhow!("Fulfillment failed: {}", detail));
            }
            "unknown" => {
                return Err(anyhow!(
                    "the device forgot the fulfillment job (it may have restarted)"
                ));
            }
            _ => {}
        }
    }
}

/// Read the fetched EPUB back from the device, inspect its OPF metadata, and
/// rename the book (and its `.rights` sidecar) to "Title - Author.epub".
/// Returns `(display_title, new_file_name)` when a rename happened.
async fn rename_from_metadata(
    client: &reqwest::Client,
    base: &str,
    dest: &str,
    req: &SendRequest,
    ctx: &SendContext,
) -> Result<Option<(String, String)>> {
    ctx.emit(SendProgress::stage("naming", "Reading EPUB metadata…"));
    let resp = client
        .get(format!(
            "{}/download?path={}",
            base,
            urlencode_path_component(dest)
        ))
        .send()
        .await?;
    if !resp.status().is_success() {
        return Err(anyhow!("could not read back the EPUB (HTTP {})", resp.status()));
    }
    let bytes = resp.bytes().await?;
    let meta = crate::epub::inspect_bytes(&bytes)?;

    let title = meta
        .title
        .filter(|t| !t.trim().is_empty())
        .or_else(|| req.title.clone())
        .filter(|t| !t.trim().is_empty());
    let Some(title) = title else { return Ok(None) };
    let author = meta
        .authors
        .first()
        .cloned()
        .filter(|a| !a.trim().is_empty())
        .or_else(|| req.author.clone());

    // Cap the stem so long titles stay FAT-friendly.
    let desired = {
        let name = crate::downloads::build_filename(&title, author.as_deref(), "epub");
        let stem = name.trim_end_matches(".epub");
        let capped: String = stem.chars().take(80).collect();
        format!("{}.epub", capped.trim_end())
    };

    let current = dest.rsplit('/').next().unwrap_or(dest);
    if desired.eq_ignore_ascii_case(current) {
        return Ok(None);
    }

    let dir = match dest.rfind('/') {
        Some(0) | None => "/".to_string(),
        Some(i) => dest[..i].to_string(),
    };
    let new_name = pick_free_name(client, base, &dir, &desired, current).await?;

    // Rename the rights sidecar first — the reader pairs it to the book by
    // filename, so the book must never end up renamed without it. A 404 just
    // means there is no sidecar.
    let rights_old = format!("{}.rights", dest);
    let rights_new = format!("{}.rights", new_name);
    let rights_status = rename_on_device(client, base, &rights_old, &rights_new).await?;
    if !rights_status.is_success() && rights_status.as_u16() != 404 {
        return Err(anyhow!("rights sidecar rename returned HTTP {}", rights_status));
    }
    let had_rights = rights_status.is_success();

    let epub_status = rename_on_device(client, base, dest, &new_name).await?;
    if !epub_status.is_success() {
        if had_rights {
            // Roll the sidecar back so the pair stays consistent.
            let rolled = join_device_path(&dir, &rights_new);
            let orig = rights_old.rsplit('/').next().unwrap_or(&rights_old);
            let _ = rename_on_device(client, base, &rolled, orig).await;
        }
        return Err(anyhow!("EPUB rename returned HTTP {}", epub_status));
    }

    ctx.emit(SendProgress::stage(
        "renamed",
        format!("Named it {}", new_name),
    ));
    Ok(Some((title, new_name)))
}

/// `POST /rename?path=<file>&name=<new base name>`.
async fn rename_on_device(
    client: &reqwest::Client,
    base: &str,
    path: &str,
    new_name: &str,
) -> Result<reqwest::StatusCode> {
    let url = format!(
        "{}/rename?path={}&name={}",
        base,
        urlencode_path_component(path),
        urlencode_path_component(new_name)
    );
    Ok(client.post(&url).send().await?.status())
}

/// Choose `desired` or "stem (n).epub" so that neither the name nor its
/// `.rights` sidecar collides with an existing file in `dir`.
async fn pick_free_name(
    client: &reqwest::Client,
    base: &str,
    dir: &str,
    desired: &str,
    current: &str,
) -> Result<String> {
    let entries: Vec<FileEntry> = client
        .get(format!(
            "{}/api/files?path={}",
            base,
            urlencode_path_component(dir)
        ))
        .send()
        .await?
        .json()
        .await
        .unwrap_or_default();
    let mut taken: std::collections::HashSet<String> = entries
        .into_iter()
        .map(|e| e.name.to_lowercase())
        .collect();
    // The file being renamed doesn't block its own new name.
    taken.remove(&current.to_lowercase());
    taken.remove(&format!("{}.rights", current.to_lowercase()));

    let stem = desired.trim_end_matches(".epub");
    for n in 1..100 {
        let candidate = if n == 1 {
            format!("{}.epub", stem)
        } else {
            format!("{} ({}).epub", stem, n)
        };
        let lower = candidate.to_lowercase();
        if !taken.contains(&lower) && !taken.contains(&format!("{}.rights", lower)) {
            return Ok(candidate);
        }
    }
    Err(anyhow!("could not find a free name for {}", desired))
}

fn join_device_path(dir: &str, name: &str) -> String {
    if dir == "/" {
        format!("/{}", name)
    } else {
        format!("{}/{}", dir.trim_end_matches('/'), name)
    }
}

/// Hidden webview hosting the device's /plugins-run page, which executes
/// queued plugin jobs. Desktop only — mobile Tauri can't create extra webview
/// windows.
#[cfg(not(any(target_os = "ios", target_os = "android")))]
mod runner {
    use super::RUNNER_LABEL;
    use anyhow::{anyhow, Result};
    use tauri::{AppHandle, Manager, WebviewUrl};

    pub fn open(app: &AppHandle, base: &str) -> Result<()> {
        close(app);
        let url: tauri::Url = format!("{}/plugins-run", base).parse()?;
        // Window creation must happen on the main thread (macOS requirement);
        // block briefly so we can report failures.
        let (tx, rx) = std::sync::mpsc::channel::<Result<(), String>>();
        let handle = app.clone();
        app.run_on_main_thread(move || {
            let result = tauri::WebviewWindowBuilder::new(
                &handle,
                RUNNER_LABEL,
                WebviewUrl::External(url),
            )
            .title("Crosspoint fulfillment")
            .visible(false)
            .skip_taskbar(true)
            .build()
            .map(|_| ())
            .map_err(|e| e.to_string());
            let _ = tx.send(result);
        })?;
        rx.recv_timeout(std::time::Duration::from_secs(5))
            .map_err(|_| anyhow!("timed out creating the runner webview"))?
            .map_err(|e| anyhow!(e))
    }

    pub fn close(app: &AppHandle) {
        if let Some(w) = app.get_webview_window(RUNNER_LABEL) {
            let _ = w.destroy();
        }
    }
}

#[cfg(any(target_os = "ios", target_os = "android"))]
mod runner {
    use anyhow::{anyhow, Result};
    use tauri::AppHandle;

    pub fn open(_app: &AppHandle, _base: &str) -> Result<()> {
        Err(anyhow!("not supported on mobile"))
    }

    pub fn close(_app: &AppHandle) {}
}

/// `POST /upload?path=<dir>` with a multipart body, the firmware's plain file
/// upload.
async fn upload_multipart(
    client: &reqwest::Client,
    base: &str,
    folder: &str,
    filename: &str,
    bytes: Vec<u8>,
    ctx: &SendContext,
    host: &str,
) -> Result<()> {
    let upload_size = bytes.len();
    let part = Part::bytes(bytes)
        .file_name(filename.to_string())
        .mime_str(mime_for(filename))?;
    let form = Form::new().part("file", part);

    let upload_url = format!("{}/upload?path={}", base, urlencode_path_component(folder));

    ctx.emit(SendProgress::stage(
        "uploading",
        format!("Uploading {} to {}…", fmt_size(upload_size), host),
    ));
    let resp = client.post(&upload_url).multipart(form).send().await?;
    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(anyhow!(
            "Crosspoint upload to {} returned {}: {}",
            upload_url,
            status,
            body
        ));
    }
    Ok(())
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

/// Resolve `host` to an IPv4 via the OS resolver (Bonjour on macOS,
/// systemd-resolved/avahi on Linux, the system resolver on Windows). This is the
/// mDNS path macOS permits from an app — raw multicast is blocked by Local
/// Network privacy — and it returns the A record quickly. IPv4-only so the base
/// URL pins to the device IP and we skip the slow AAAA lookup on later requests.
async fn resolve_os_ipv4(host: &str, port: u16) -> Option<Ipv4Addr> {
    let target = format!("{}:{}", host, port);
    let addrs = tokio::net::lookup_host(target).await.ok()?;
    for addr in addrs {
        if let std::net::IpAddr::V4(v4) = addr.ip() {
            return Some(v4);
        }
    }
    None
}

async fn resolve_mdns_ipv4(host: &str) -> Option<Ipv4Addr> {
    let host = host.trim_end_matches('.').to_ascii_lowercase();
    tokio::task::spawn_blocking(move || resolve_mdns_ipv4_blocking(&host))
        .await
        .ok()
        .flatten()
}

fn resolve_mdns_ipv4_blocking(host: &str) -> Option<Ipv4Addr> {
    let query = build_mdns_query(host)?;
    let socket = UdpSocket::bind(("0.0.0.0", 0)).ok()?;
    let _ = socket.set_read_timeout(Some(Duration::from_millis(550)));
    let _ = socket.set_multicast_ttl_v4(255);
    let mdns = SocketAddrV4::new(Ipv4Addr::new(224, 0, 0, 251), 5353);
    let mut buf = [0u8; 1500];

    for _ in 0..3 {
        let _ = socket.send_to(&query, mdns);
        if let Ok((n, _)) = socket.recv_from(&mut buf) {
            if let Some(ip) = parse_mdns_a_response(host, &buf[..n]) {
                return Some(ip);
            }
        }
    }
    None
}

fn build_mdns_query(host: &str) -> Option<Vec<u8>> {
    let mut out = Vec::with_capacity(64);
    out.extend_from_slice(&[
        0, 0, // transaction id
        0, 0, // flags
        0, 1, // questions
        0, 0, // answers
        0, 0, // authority
        0, 0, // additional
    ]);
    for label in host.split('.') {
        let bytes = label.as_bytes();
        if bytes.is_empty() || bytes.len() > 63 {
            return None;
        }
        out.push(bytes.len() as u8);
        out.extend_from_slice(bytes);
    }
    out.push(0);
    out.extend_from_slice(&[
        0, 1, // A
        0x80, 1, // IN with QU bit, asking responders to reply unicast
    ]);
    Some(out)
}

fn parse_mdns_a_response(host: &str, packet: &[u8]) -> Option<Ipv4Addr> {
    if packet.len() < 12 {
        return None;
    }
    let qd = u16::from_be_bytes([packet[4], packet[5]]) as usize;
    let an = u16::from_be_bytes([packet[6], packet[7]]) as usize;
    let ns = u16::from_be_bytes([packet[8], packet[9]]) as usize;
    let ar = u16::from_be_bytes([packet[10], packet[11]]) as usize;

    let mut offset = 12;
    for _ in 0..qd {
        parse_dns_name(packet, &mut offset)?;
        offset = offset.checked_add(4)?;
        if offset > packet.len() {
            return None;
        }
    }

    for _ in 0..(an + ns + ar) {
        let name = parse_dns_name(packet, &mut offset)?;
        if offset.checked_add(10)? > packet.len() {
            return None;
        }
        let rr_type = u16::from_be_bytes([packet[offset], packet[offset + 1]]);
        let class = u16::from_be_bytes([packet[offset + 2], packet[offset + 3]]) & 0x7fff;
        let rd_len = u16::from_be_bytes([packet[offset + 8], packet[offset + 9]]) as usize;
        offset += 10;
        if offset.checked_add(rd_len)? > packet.len() {
            return None;
        }
        if rr_type == 1 && class == 1 && rd_len == 4 && same_dns_name(&name, host) {
            return Some(Ipv4Addr::new(
                packet[offset],
                packet[offset + 1],
                packet[offset + 2],
                packet[offset + 3],
            ));
        }
        offset += rd_len;
    }
    None
}

fn parse_dns_name(packet: &[u8], offset: &mut usize) -> Option<String> {
    let mut labels = Vec::new();
    let mut pos = *offset;
    let mut jumped = false;
    let mut jumps = 0;

    loop {
        let len = *packet.get(pos)?;
        if len & 0xc0 == 0xc0 {
            let next = *packet.get(pos + 1)? as usize;
            let ptr = (((len & 0x3f) as usize) << 8) | next;
            if !jumped {
                *offset = pos + 2;
            }
            pos = ptr;
            jumped = true;
            jumps += 1;
            if jumps > 8 {
                return None;
            }
            continue;
        }
        if len == 0 {
            if !jumped {
                *offset = pos + 1;
            }
            break;
        }
        pos += 1;
        let end = pos.checked_add(len as usize)?;
        let label = std::str::from_utf8(packet.get(pos..end)?).ok()?;
        labels.push(label.to_ascii_lowercase());
        pos = end;
    }

    Some(labels.join("."))
}

fn same_dns_name(a: &str, b: &str) -> bool {
    a.trim_end_matches('.')
        .eq_ignore_ascii_case(b.trim_end_matches('.'))
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
        e if e == LOAN_EXT => LOAN_MIME,
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
