//! Embedded Libby (libbyapp.com) browser tab.
//!
//! The Libby view is a native child webview overlaid on the main window at
//! bounds the frontend reports (the `/libby` route renders a placeholder div
//! and mirrors its rect here). A child webview — not an iframe — because both
//! halves of the feature depend on native hooks: the initialization script
//! injects our CSS into Libby's page context on every navigation, and the
//! download handler routes `.acsm`/ebook files into the Common Stacks
//! download shelf. Desktop only: Tauri's multi-webview API doesn't exist on
//! iOS/Android.

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
    use std::time::Duration;
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
                                match write_loan_sidecar(&dest, &b).await {
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

        // Webview creation must happen on the main thread (macOS requirement);
        // block briefly so the command can report failures.
        let (tx, rx) = std::sync::mpsc::channel::<Result<(), String>>();
        let position = LogicalPosition::new(bounds.x, bounds.y);
        let size = LogicalSize::new(bounds.width, bounds.height);
        let win = window.clone();
        window
            .run_on_main_thread(move || {
                let result = win
                    .add_child(builder, position, size)
                    .map(|_| ())
                    .map_err(|e| e.to_string());
                let _ = tx.send(result);
            })
            .map_err(err)?;
        rx.recv_timeout(Duration::from_secs(5))
            .map_err(|_| "timed out creating the Libby view".to_string())?
    }

    /// Download the cover image and write the loan metadata sidecar that the
    /// download shelf reads (see `downloads::read_loan_meta`).
    async fn write_loan_sidecar(
        path: &std::path::Path,
        book: &super::LibbyContext,
    ) -> anyhow::Result<()> {
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

#[tauri::command]
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
