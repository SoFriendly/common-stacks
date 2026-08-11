//! Embedded Libby (libbyapp.com) browser tab.
//!
//! Desktop: a native child webview overlaid on the main window at bounds the
//! frontend reports (the `/libby` route renders a placeholder div and mirrors
//! its rect here). The initialization script injects our CSS into Libby's
//! page context on every navigation, and wry's download handler routes
//! `.acsm`/ebook files into the Common Stacks download shelf.
//!
//! Android: the `/libby` route embeds libbyapp.com in an iframe inside the
//! main webview. The same injection script reaches the cross-origin iframe
//! because wry registers initialization scripts via
//! `addDocumentStartJavaScript` with origin `*` (we add it app-wide as a
//! plugin script, guarded by hostname). Book context and download requests
//! travel over a `WebMessageListener` bridge set up in MainActivity.kt,
//! forwarded through the React app into `libby_report_context` /
//! `libby_android_download`.

use serde::{Deserialize, Serialize};

pub const LABEL: &str = "libby";

/// Book context scraped from the Libby page by the injected script and
/// reported over the `cs-libby://` protocol. Consumed when a download starts
/// so the file can be named and decorated with real book metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LibbyContext {
    pub title: String,
    #[serde(default)]
    pub author: Option<String>,
    #[serde(default)]
    pub cover: Option<String>,
}

/// Handler for the `cs-libby://` custom protocol — the one-way reporting
/// channel from the Libby webview's injected script (which has no Tauri IPC
/// access, deliberately) into the app.
pub fn protocol_handler<R: tauri::Runtime>(
    ctx: tauri::UriSchemeContext<'_, R>,
    request: tauri::http::Request<Vec<u8>>,
) -> tauri::http::Response<Vec<u8>> {
    use tauri::Manager;
    if ctx.webview_label() == LABEL && request.method() == tauri::http::Method::POST {
        if let Ok(book) = serde_json::from_slice::<LibbyContext>(request.body()) {
            let app = ctx.app_handle();
            let state = app.state::<crate::state::AppState>();
            let slot = state.libby_context.lock();
            if let Ok(mut slot) = slot {
                *slot = Some(book);
            }
        }
    }
    tauri::http::Response::builder()
        .status(200)
        .header("Access-Control-Allow-Origin", "*")
        .header("Access-Control-Allow-Methods", "POST, OPTIONS")
        .header("Access-Control-Allow-Headers", "*")
        .body(Vec::new())
        .unwrap_or_default()
}

#[derive(Debug, Clone, Copy, Deserialize)]
pub struct LibbyBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

type CmdResult<T> = Result<T, String>;

#[cfg(not(any(target_os = "ios", target_os = "android")))]
mod desktop {
    use super::{LibbyBounds, LABEL};
    use crate::state::AppState;
    use tauri::webview::{DownloadEvent, WebviewBuilder};
    use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, WebviewUrl};

    const LIBBY_URL: &str = "https://libbyapp.com";
    const INIT_SCRIPT: &str = include_str!("libby_inject.js");

    fn err<E: std::fmt::Display>(e: E) -> String {
        format!("{}", e)
    }

    pub fn show(app: &AppHandle, bounds: &LibbyBounds) -> Result<(), String> {
        if let Some(webview) = app.get_webview(LABEL) {
            set_bounds(app, bounds)?;
            webview.show().map_err(err)?;
            return Ok(());
        }
        create(app, bounds)
    }

    pub fn hide(app: &AppHandle) -> Result<(), String> {
        if let Some(webview) = app.get_webview(LABEL) {
            webview.hide().map_err(err)?;
        }
        Ok(())
    }

    pub fn set_bounds(app: &AppHandle, bounds: &LibbyBounds) -> Result<(), String> {
        let webview = match app.get_webview(LABEL) {
            Some(w) => w,
            None => return Ok(()),
        };
        webview
            .set_position(LogicalPosition::new(bounds.x, bounds.y))
            .map_err(err)?;
        webview
            .set_size(LogicalSize::new(bounds.width, bounds.height))
            .map_err(err)?;
        Ok(())
    }

    pub fn eval(app: &AppHandle, js: &str) -> Result<(), String> {
        let webview = app
            .get_webview(LABEL)
            .ok_or_else(|| "Libby view is not open".to_string())?;
        webview.eval(js).map_err(err)
    }

    fn create(app: &AppHandle, bounds: &LibbyBounds) -> Result<(), String> {
        let window = app
            .get_window("main")
            .ok_or_else(|| "main window not available".to_string())?;

        let url: tauri::Url = LIBBY_URL.parse().map_err(err)?;
        let nav_app = app.clone();
        let builder = WebviewBuilder::new(LABEL, WebviewUrl::External(url))
            .initialization_script(INIT_SCRIPT)
            // Reporting channel from the injected script: it "navigates" to
            // cs-libby://ctx?d=<json>, we capture the payload and cancel the
            // navigation. Deterministic in WKWebView, unlike fetch()ing a
            // custom scheme from an https origin.
            .on_navigation(move |url| {
                if url.scheme() == "cs-libby" {
                    if let Some((_, d)) = url.query_pairs().find(|(k, _)| k == "d") {
                        match serde_json::from_str::<super::LibbyContext>(&d) {
                            Ok(book) => {
                                tracing::info!("libby context: {:?}", book);
                                let state = nav_app.state::<AppState>();
                                let slot = state.libby_context.lock();
                                if let Ok(mut slot) = slot {
                                    *slot = Some(book);
                                }
                            }
                            Err(e) => tracing::warn!("libby context parse failed: {}", e),
                        }
                    }
                    return false;
                }
                true
            })
            .on_download(|webview, event| {
                match event {
                    DownloadEvent::Requested { url, destination } => {
                        // Route the file into the download shelf instead of the
                        // webview's default location.
                        let state = webview.app_handle().state::<AppState>();
                        // This closure runs on the event loop, not inside the
                        // tokio runtime, so a non-blocking read with a
                        // fallback beats risking a deadlock.
                        let dir = match state.config.try_read() {
                            Ok(cfg) => crate::config::resolved_download_dir(&cfg),
                            Err(_) => crate::config::default_download_dir(),
                        };
                        let suggested = destination
                            .file_name()
                            .map(|s| s.to_string_lossy().to_string())
                            .filter(|s| !s.is_empty())
                            .or_else(|| {
                                url.path_segments()
                                    .and_then(|mut s| s.next_back())
                                    .filter(|s| !s.is_empty())
                                    .map(|s| s.to_string())
                            })
                            .unwrap_or_else(|| "libby-download".to_string());
                        // Name the file after the book being viewed when the
                        // injected script has reported one; the raw fulfillment
                        // filename is an opaque token otherwise.
                        let book = state.libby_context.lock().ok().and_then(|g| g.clone());
                        let filename = match &book {
                            Some(b) => {
                                let ext = suggested.rsplit('.').next().filter(|e| {
                                    e.len() <= 5 && !e.contains(['/', ' ']) && *e != suggested
                                });
                                crate::downloads::build_filename(
                                    &b.title,
                                    b.author.as_deref(),
                                    ext.unwrap_or("acsm"),
                                )
                            }
                            None => sanitize_filename::sanitize(&suggested),
                        };
                        if std::fs::create_dir_all(&dir).is_ok() {
                            *destination = crate::downloads::unique_path(&dir, &filename);
                        }
                        tracing::info!("libby download -> {}", destination.display());
                        // Write the metadata sidecar now, while the download
                        // runs — the destination is known here, and wry's
                        // Finished event doesn't reliably echo the path back
                        // on macOS. A second shelf-refresh event fires once
                        // the cover is in place.
                        if let Some(b) = book {
                            let dest = destination.clone();
                            let app = webview.app_handle().clone();
                            tauri::async_runtime::spawn(async move {
                                match super::write_loan_sidecar(&dest, &b).await {
                                    Ok(()) => {
                                        let _ = app.emit(
                                            "libby-download-finished",
                                            serde_json::json!({ "path": dest, "success": true }),
                                        );
                                    }
                                    Err(e) => tracing::warn!("libby sidecar failed: {}", e),
                                }
                            });
                        }
                        // Tell the click-through automation the download it was
                        // driving toward has started.
                        let _ = webview.eval("window.__csLibbyAutoDone && window.__csLibbyAutoDone()");
                    }
                    DownloadEvent::Finished { path, success, .. } => {
                        let app = webview.app_handle().clone();
                        // wry doesn't reliably echo the destination path back
                        // here on macOS; the sidecar was already written at
                        // Requested time. The last-reported context is the
                        // book this download was for.
                        let book = app
                            .state::<AppState>()
                            .libby_context
                            .lock()
                            .ok()
                            .and_then(|g| g.clone());
                        // In-page confirmation modal (defined by the injected
                        // script) — the native webview covers our React UI, so
                        // feedback has to render inside the Libby page itself.
                        let modal = serde_json::json!({
                            "ok": success,
                            "title": book.as_ref().map(|b| b.title.clone()),
                            "cover": book.as_ref().and_then(|b| b.cover.clone()),
                        });
                        let _ = webview.eval(&format!(
                            "window.__csLibbyModal && window.__csLibbyModal({})",
                            modal
                        ));
                        let _ = app.emit(
                            "libby-download-finished",
                            serde_json::json!({ "path": path, "success": success }),
                        );
                    }
                    _ => {}
                }
                true
            });

        // `add_child` hops to the main thread itself and blocks until the
        // webview exists. It must therefore NOT be called from the main
        // thread: on Windows the caller is then inside WebView2's IPC
        // callback, and creating a controller re-enters WebView2 — its
        // completion callback never arrives and wry's nested message pump
        // spins forever, leaving an empty Libby pane. `libby_show` is
        // declared `#[tauri::command(async)]` to keep us off that thread.
        window
            .add_child(
                builder,
                LogicalPosition::new(bounds.x, bounds.y),
                LogicalSize::new(bounds.width, bounds.height),
            )
            .map(|_| ())
            .map_err(err)
    }
}

/// Download the cover image and write the loan metadata sidecar that the
/// download shelf reads (see `downloads::read_loan_meta`). Shared by the
/// desktop download hook and the Android download command.
pub(crate) async fn write_loan_sidecar(
    path: &std::path::Path,
    book: &LibbyContext,
) -> anyhow::Result<()> {
    use std::time::Duration;
        let mut cover_file: Option<String> = None;
        let mut cover_mime: Option<String> = None;
        let stem = path
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .ok_or_else(|| anyhow::anyhow!("no file stem"))?;
        let meta_dir = crate::downloads::loan_meta_dir(
            path.parent().ok_or_else(|| anyhow::anyhow!("no parent"))?,
        );
        std::fs::create_dir_all(&meta_dir)?;

        if let Some(cover_url) = &book.cover {
            let client = crate::tls::client_builder()
                .timeout(Duration::from_secs(15))
                .user_agent("Common Stacks/0.1")
                .build()?;
            match client.get(cover_url).send().await {
                Ok(resp) if resp.status().is_success() => {
                    let mime = resp
                        .headers()
                        .get("content-type")
                        .and_then(|v| v.to_str().ok())
                        .unwrap_or("image/jpeg")
                        .split(';')
                        .next()
                        .unwrap_or("image/jpeg")
                        .to_string();
                    let bytes = resp.bytes().await?;
                    let name = format!("{}.cover", stem);
                    std::fs::write(meta_dir.join(&name), &bytes)?;
                    cover_file = Some(name);
                    cover_mime = Some(mime);
                }
                Ok(resp) => {
                    tracing::warn!("libby cover fetch: HTTP {}", resp.status());
                }
                Err(e) => tracing::warn!("libby cover fetch failed: {}", e),
            }
        }

        let json = serde_json::json!({
            "title": book.title,
            "author": book.author,
            "cover_file": cover_file,
            "cover_mime": cover_mime,
        });
        std::fs::write(
            meta_dir.join(format!("{}.json", stem)),
            serde_json::to_vec_pretty(&json)?,
        )?;
        Ok(())
}

#[cfg(not(any(target_os = "ios", target_os = "android")))]
mod commands_impl {
    use super::*;

    pub fn show(app: &tauri::AppHandle, bounds: &LibbyBounds) -> CmdResult<()> {
        desktop::show(app, bounds)
    }
    pub fn hide(app: &tauri::AppHandle) -> CmdResult<()> {
        desktop::hide(app)
    }
    pub fn set_bounds(app: &tauri::AppHandle, bounds: &LibbyBounds) -> CmdResult<()> {
        desktop::set_bounds(app, bounds)
    }
    pub fn back(app: &tauri::AppHandle) -> CmdResult<()> {
        desktop::eval(app, "history.back()")
    }
    pub fn reload(app: &tauri::AppHandle) -> CmdResult<()> {
        desktop::eval(app, "location.reload()")
    }
}

#[cfg(any(target_os = "ios", target_os = "android"))]
mod commands_impl {
    use super::*;

    const UNSUPPORTED: &str = "The Libby tab is not available on mobile.";

    pub fn show(_app: &tauri::AppHandle, _bounds: &LibbyBounds) -> CmdResult<()> {
        Err(UNSUPPORTED.into())
    }
    pub fn hide(_app: &tauri::AppHandle) -> CmdResult<()> {
        Err(UNSUPPORTED.into())
    }
    pub fn set_bounds(_app: &tauri::AppHandle, _bounds: &LibbyBounds) -> CmdResult<()> {
        Err(UNSUPPORTED.into())
    }
    pub fn back(_app: &tauri::AppHandle) -> CmdResult<()> {
        Err(UNSUPPORTED.into())
    }
    pub fn reload(_app: &tauri::AppHandle) -> CmdResult<()> {
        Err(UNSUPPORTED.into())
    }
}

// `async` so Tauri runs this off the main thread: creating the child webview
// blocks until WebView2/WKWebView hands the view back, and on Windows a
// synchronous command would be running inside WebView2's own IPC callback,
// where that wait deadlocks (see `desktop::create`).
#[tauri::command(async)]
pub fn libby_show(app: tauri::AppHandle, bounds: LibbyBounds) -> CmdResult<()> {
    commands_impl::show(&app, &bounds)
}

#[tauri::command]
pub fn libby_hide(app: tauri::AppHandle) -> CmdResult<()> {
    commands_impl::hide(&app)
}

#[tauri::command]
pub fn libby_set_bounds(app: tauri::AppHandle, bounds: LibbyBounds) -> CmdResult<()> {
    commands_impl::set_bounds(&app, &bounds)
}

#[tauri::command]
pub fn libby_back(app: tauri::AppHandle) -> CmdResult<()> {
    commands_impl::back(&app)
}

#[tauri::command]
pub fn libby_reload(app: tauri::AppHandle) -> CmdResult<()> {
    commands_impl::reload(&app)
}

/// Android: book context relayed from the iframe's injected script via the
/// MainActivity WebMessageListener bridge and the React app.
#[tauri::command]
pub async fn libby_report_context(
    state: tauri::State<'_, crate::state::AppState>,
    context: LibbyContext,
) -> CmdResult<()> {
    tracing::info!("libby context (bridge): {:?}", context);
    let slot = state.libby_context.lock();
    if let Ok(mut slot) = slot {
        *slot = Some(context);
    }
    Ok(())
}

/// Android: a download initiated inside the Libby iframe, captured by the
/// WebView DownloadListener in MainActivity. The WebView can't write files
/// itself, so we re-fetch the URL with the session cookies and route the
/// bytes through the regular shelf pipeline (naming, sidecar, event).
#[derive(Debug, Deserialize)]
pub struct AndroidDownloadRequest {
    pub url: String,
    #[serde(default)]
    pub cookie: String,
    #[serde(default)]
    pub user_agent: String,
    #[serde(default)]
    pub mime: String,
    #[serde(default)]
    pub disposition: String,
}

#[tauri::command]
pub async fn libby_android_download(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::state::AppState>,
    request: AndroidDownloadRequest,
) -> CmdResult<serde_json::Value> {
    use tauri::Emitter;

    let book = state.libby_context.lock().ok().and_then(|g| g.clone());

    let mut client = crate::tls::client_builder()
        .timeout(std::time::Duration::from_secs(120));
    client = if request.user_agent.is_empty() {
        client.user_agent("Common Stacks/0.1")
    } else {
        client.user_agent(&request.user_agent)
    };
    let client = client.build().map_err(|e| e.to_string())?;

    let mut req = client.get(&request.url);
    if !request.cookie.is_empty() {
        req = req.header("Cookie", request.cookie.clone());
    }
    let resp = req.send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("download failed: HTTP {}", resp.status()));
    }
    let content_type = resp
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;

    let ext = filename_from_disposition(&request.disposition)
        .and_then(|n| {
            n.rsplit('.')
                .next()
                .map(|s| s.to_ascii_lowercase())
                .filter(|e| {
                    !e.is_empty() && e.len() <= 5 && e.chars().all(|c| c.is_ascii_alphanumeric())
                })
        })
        .or_else(|| crate::downloads::ext_from_mime(&request.mime).map(String::from))
        .or_else(|| {
            content_type
                .as_deref()
                .and_then(crate::downloads::ext_from_mime)
                .map(String::from)
        })
        .unwrap_or_else(|| "acsm".into());

    let filename = match &book {
        Some(b) => crate::downloads::build_filename(&b.title, b.author.as_deref(), &ext),
        None => filename_from_disposition(&request.disposition)
            .map(|n| sanitize_filename::sanitize(&n))
            .unwrap_or_else(|| format!("libby-download.{}", ext)),
    };
    let dir = {
        let cfg = state.config.read().await;
        crate::config::resolved_download_dir(&cfg)
    };
    let path = crate::downloads::write_file(&dir, &filename, &bytes).map_err(|e| e.to_string())?;
    tracing::info!("libby android download -> {}", path.display());

    if let Some(b) = &book {
        if let Err(e) = write_loan_sidecar(&path, b).await {
            tracing::warn!("libby sidecar failed: {}", e);
        }
    }

    let payload = serde_json::json!({
        "path": path,
        "success": true,
        "title": book.as_ref().map(|b| b.title.clone()),
        "cover": book.as_ref().and_then(|b| b.cover.clone()),
    });
    let _ = app.emit("libby-download-finished", payload.clone());
    Ok(payload)
}

/// Pull the filename out of a Content-Disposition header
/// (`attachment; filename="URLLink.acsm"`).
fn filename_from_disposition(disposition: &str) -> Option<String> {
    let lower = disposition.to_ascii_lowercase();
    let idx = lower.find("filename=")?;
    let rest = disposition[idx + "filename=".len()..].trim_start_matches(['"', '\'']);
    let end = rest.find(['"', '\'', ';']).unwrap_or(rest.len());
    let name = rest[..end].trim();
    if name.is_empty() {
        None
    } else {
        Some(name.to_string())
    }
}
