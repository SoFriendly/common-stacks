use crate::config::{AuthConfig, Config, Source};
use crate::dedup::{self, MergedBook};
use crate::downloads::{self, DownloadedFile};
use crate::opds::feed::Feed;
use crate::plugins::{
    EnrichQuery, EnrichedMetadata, PluginDescriptor, SendContext, SendProgress, SendRequest,
    SendResult, SendTargetSettings, SettingField,
};
use crate::state::AppState;
use futures::future::join_all;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::State;

type CmdResult<T> = Result<T, String>;

fn err<E: std::fmt::Display>(e: E) -> String {
    format!("{}", e)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SourceInput {
    pub name: String,
    pub url: String,
    #[serde(default)]
    pub auth: AuthConfig,
}

#[tauri::command]
pub async fn list_sources(state: State<'_, AppState>) -> CmdResult<Vec<Source>> {
    Ok(state.sources().await)
}

#[tauri::command]
pub async fn add_source(state: State<'_, AppState>, input: SourceInput) -> CmdResult<Source> {
    let id = slugify(&input.name);
    let source = Source {
        id: id.clone(),
        name: input.name,
        url: input.url,
        enabled: true,
        auth: input.auth,
    };
    {
        let mut cfg = state.config.write().await;
        cfg.sources.retain(|s| s.id != id);
        cfg.sources.push(source.clone());
    }
    state.save().await.map_err(err)?;
    Ok(source)
}

#[tauri::command]
pub async fn remove_source(state: State<'_, AppState>, id: String) -> CmdResult<()> {
    {
        let mut cfg = state.config.write().await;
        cfg.sources.retain(|s| s.id != id);
    }
    state.save().await.map_err(err)
}

#[tauri::command]
pub async fn update_source(state: State<'_, AppState>, source: Source) -> CmdResult<()> {
    {
        let mut cfg = state.config.write().await;
        if let Some(existing) = cfg.sources.iter_mut().find(|s| s.id == source.id) {
            *existing = source;
        } else {
            cfg.sources.push(source);
        }
    }
    state.save().await.map_err(err)
}

#[tauri::command]
pub async fn reorder_sources(state: State<'_, AppState>, ids: Vec<String>) -> CmdResult<()> {
    {
        let mut cfg = state.config.write().await;
        cfg.sources.sort_by_key(|s| {
            ids.iter()
                .position(|id| id == &s.id)
                .unwrap_or(usize::MAX)
        });
    }
    state.save().await.map_err(err)
}

#[derive(Serialize)]
pub struct ValidateResult {
    pub ok: bool,
    pub title: Option<String>,
    pub message: Option<String>,
}

#[tauri::command]
pub async fn validate_source(
    state: State<'_, AppState>,
    url: String,
    auth: Option<AuthConfig>,
) -> CmdResult<ValidateResult> {
    let probe = Source {
        id: "__probe".into(),
        name: "probe".into(),
        url: url.clone(),
        enabled: true,
        auth: auth.unwrap_or(AuthConfig::None),
    };
    match state.client.fetch_feed(&probe, &url).await {
        Ok(f) => Ok(ValidateResult {
            ok: true,
            title: Some(f.title),
            message: None,
        }),
        Err(e) => Ok(ValidateResult {
            ok: false,
            title: None,
            message: Some(format!("{}", e)),
        }),
    }
}

#[derive(Serialize)]
pub struct FetchResult {
    pub source_id: String,
    pub feed: Feed,
}

#[tauri::command]
pub async fn fetch_feed(
    state: State<'_, AppState>,
    source_id: String,
    url: Option<String>,
) -> CmdResult<FetchResult> {
    let source = state
        .sources()
        .await
        .into_iter()
        .find(|s| s.id == source_id)
        .ok_or_else(|| format!("unknown source: {}", source_id))?;
    let target = url.unwrap_or_else(|| source.url.clone());
    let feed = state.client.fetch_feed(&source, &target).await.map_err(err)?;
    Ok(FetchResult {
        source_id: source.id,
        feed,
    })
}

#[derive(Serialize)]
pub struct SearchResult {
    pub merged: Vec<MergedBook>,
    pub errors: Vec<SearchError>,
}

#[derive(Serialize)]
pub struct SearchError {
    pub source_id: String,
    pub source_name: String,
    pub message: String,
}

#[tauri::command]
pub async fn search(state: State<'_, AppState>, query: String) -> CmdResult<SearchResult> {
    let sources: Vec<Source> = state
        .sources()
        .await
        .into_iter()
        .filter(|s| s.enabled)
        .collect();
    let client = state.client.clone();

    let futures = sources.iter().cloned().map(|s| {
        let client = client.clone();
        let q = query.clone();
        async move {
            let r = client.search(&s, &q).await;
            (s, r)
        }
    });

    let results = join_all(futures).await;
    let mut per_source: Vec<(String, String, Vec<_>)> = Vec::new();
    let mut errors: Vec<SearchError> = Vec::new();
    for (source, res) in results {
        match res {
            Ok(feed) => per_source.push((source.id.clone(), source.name.clone(), feed.entries)),
            Err(e) => errors.push(SearchError {
                source_id: source.id,
                source_name: source.name,
                message: format!("{}", e),
            }),
        }
    }
    let merged = dedup::merge(&per_source);
    Ok(SearchResult { merged, errors })
}

#[derive(Debug, Deserialize)]
pub struct DownloadRequest {
    pub source_id: String,
    pub title: String,
    pub author: Option<String>,
    pub href: String,
    pub mime: Option<String>,
}

#[derive(Serialize)]
pub struct DownloadResult {
    pub path: PathBuf,
}

#[tauri::command]
pub async fn download_book(
    state: State<'_, AppState>,
    request: DownloadRequest,
) -> CmdResult<DownloadResult> {
    let source = state
        .sources()
        .await
        .into_iter()
        .find(|s| s.id == request.source_id)
        .ok_or_else(|| format!("unknown source: {}", request.source_id))?;

    let (bytes, ct) = state
        .client
        .download(&source, &request.href)
        .await
        .map_err(err)?;

    let ext = ext_from_href(&request.href)
        .or_else(|| {
            request
                .mime
                .as_deref()
                .and_then(downloads::ext_from_mime)
                .map(|s| s.to_string())
        })
        .or_else(|| ct.as_deref().and_then(downloads::ext_from_mime).map(|s| s.to_string()))
        .unwrap_or_else(|| "bin".to_string());

    let filename = downloads::build_filename(&request.title, request.author.as_deref(), &ext);

    let dir = {
        let cfg = state.config.read().await;
        crate::config::resolved_download_dir(&cfg)
    };
    let path = downloads::write_file(&dir, &filename, &bytes).map_err(err)?;
    downloads::maybe_inspect_epub(&path);
    Ok(DownloadResult { path })
}

fn ext_from_href(href: &str) -> Option<String> {
    let stripped = href.split(&['?', '#'][..]).next().unwrap_or(href);
    let last = stripped.rsplit('/').next().unwrap_or("");
    let ext = last.rsplit('.').next()?;
    if ext.len() >= 2 && ext.len() <= 5 && ext.chars().all(|c| c.is_ascii_alphanumeric()) {
        Some(ext.to_ascii_lowercase())
    } else {
        None
    }
}

#[tauri::command]
pub async fn list_downloads(state: State<'_, AppState>) -> CmdResult<Vec<DownloadedFile>> {
    downloads::list(&state).await.map_err(err)
}

#[tauri::command]
pub fn inspect_download(path: String) -> CmdResult<crate::epub::EpubMetadata> {
    let p = std::path::PathBuf::from(&path);
    let ext = p
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_default();
    if ext != "epub" {
        return Err("not an EPUB".into());
    }
    crate::epub::inspect_path(&p).map_err(err)
}

#[tauri::command]
pub fn reveal_download(path: String) -> CmdResult<()> {
    #[cfg(any(target_os = "linux", target_os = "freebsd"))]
    let p = std::path::PathBuf::from(&path);
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-R", &path])
            .spawn()
            .map_err(err)?;
        return Ok(());
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .args(["/select,", &path])
            .spawn()
            .map_err(err)?;
        return Ok(());
    }
    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    {
        let dir = p.parent().ok_or_else(|| "no parent".to_string())?;
        std::process::Command::new("xdg-open")
            .arg(dir)
            .spawn()
            .map_err(err)?;
        Ok(())
    }
}

#[tauri::command]
pub fn delete_download(path: String) -> CmdResult<()> {
    downloads::delete(std::path::Path::new(&path)).map_err(err)
}

#[tauri::command]
pub fn rename_download(path: String, new_name: String) -> CmdResult<PathBuf> {
    downloads::rename(std::path::Path::new(&path), &new_name).map_err(err)
}

#[tauri::command]
pub async fn get_download_dir(state: State<'_, AppState>) -> CmdResult<PathBuf> {
    let cfg = state.config.read().await;
    Ok(crate::config::resolved_download_dir(&cfg))
}

#[tauri::command]
pub async fn set_download_dir(state: State<'_, AppState>, path: String) -> CmdResult<()> {
    {
        let mut cfg = state.config.write().await;
        cfg.preferences.download_dir = Some(PathBuf::from(path));
    }
    state.save().await.map_err(err)
}

#[tauri::command]
pub async fn export_config(state: State<'_, AppState>) -> CmdResult<String> {
    let cfg: Config = state.config.read().await.clone();
    serde_json::to_string_pretty(&cfg).map_err(err)
}

// ============================================================================
// Plugin commands
// ============================================================================

#[derive(serde::Serialize)]
pub struct InstalledPlugin {
    pub category: &'static str, // "metadata" | "send" | "transformer"
    pub descriptor: PluginDescriptor,
    pub source: &'static str, // "builtin" — reserved for future "user" plugins
}

#[tauri::command]
pub async fn list_plugins(state: State<'_, AppState>) -> CmdResult<Vec<InstalledPlugin>> {
    let mut out = Vec::new();
    for p in state.plugins.enrichers() {
        out.push(InstalledPlugin {
            category: "metadata",
            descriptor: p.descriptor(),
            source: "builtin",
        });
    }
    for p in state.plugins.send_targets() {
        out.push(InstalledPlugin {
            category: "send",
            descriptor: p.descriptor(),
            source: "builtin",
        });
    }
    for p in state.plugins.transformers() {
        out.push(InstalledPlugin {
            category: "transformer",
            descriptor: p.descriptor(),
            source: "builtin",
        });
    }
    Ok(out)
}

#[derive(serde::Serialize)]
pub struct SendTargetInfo {
    pub descriptor: PluginDescriptor,
    pub schema: Vec<SettingField>,
    pub configured: bool,
    pub enabled: bool,
}

#[tauri::command]
pub async fn list_enrichers(state: State<'_, AppState>) -> CmdResult<Vec<PluginDescriptor>> {
    Ok(state
        .plugins
        .enrichers()
        .iter()
        .map(|e| e.descriptor())
        .collect())
}

#[tauri::command]
pub async fn enrich_book(
    state: State<'_, AppState>,
    enricher_id: String,
    query: EnrichQuery,
) -> CmdResult<Option<EnrichedMetadata>> {
    let enricher = state
        .plugins
        .find_enricher(&enricher_id)
        .ok_or_else(|| format!("unknown enricher: {}", enricher_id))?;
    enricher.enrich(&query).await.map_err(err)
}

#[tauri::command]
pub async fn list_send_targets(state: State<'_, AppState>) -> CmdResult<Vec<SendTargetInfo>> {
    let cfg = state.config.read().await;
    Ok(state
        .plugins
        .send_targets()
        .iter()
        .map(|t| {
            let d = t.descriptor();
            let configured = cfg.send_targets.get(&d.id).map_or(false, |m| !m.is_empty());
            let enabled = cfg.send_target_enabled.get(&d.id).copied().unwrap_or(false);
            SendTargetInfo {
                descriptor: d,
                schema: t.settings_schema(),
                configured,
                enabled,
            }
        })
        .collect())
}

#[tauri::command]
pub async fn get_send_target_settings(
    state: State<'_, AppState>,
    target_id: String,
) -> CmdResult<std::collections::HashMap<String, String>> {
    let cfg = state.config.read().await;
    Ok(cfg.send_targets.get(&target_id).cloned().unwrap_or_default())
}

#[tauri::command]
pub async fn save_send_target_settings(
    state: State<'_, AppState>,
    target_id: String,
    fields: std::collections::HashMap<String, String>,
) -> CmdResult<()> {
    {
        let mut cfg = state.config.write().await;
        cfg.send_targets.insert(target_id, fields);
    }
    state.save().await.map_err(err)
}

#[tauri::command]
pub async fn set_send_target_enabled(
    state: State<'_, AppState>,
    target_id: String,
    enabled: bool,
) -> CmdResult<()> {
    {
        let mut cfg = state.config.write().await;
        cfg.send_target_enabled.insert(target_id, enabled);
    }
    state.save().await.map_err(err)
}

#[tauri::command]
pub async fn send_book(
    state: State<'_, AppState>,
    request: SendRequest,
    on_progress: tauri::ipc::Channel<SendProgress>,
) -> CmdResult<SendResult> {
    let target = state
        .plugins
        .find_send_target(&request.target_id)
        .ok_or_else(|| format!("unknown send target: {}", request.target_id))?;
    let fields = {
        let cfg = state.config.read().await;
        cfg.send_targets
            .get(&request.target_id)
            .cloned()
            .unwrap_or_default()
    };
    let settings = SendTargetSettings { fields };
    let ctx = SendContext {
        progress: on_progress,
    };
    target.send(&request, &settings, &ctx).await.map_err(err)
}

#[tauri::command]
pub async fn import_config(state: State<'_, AppState>, json: String) -> CmdResult<()> {
    let incoming: Config = serde_json::from_str(&json).map_err(err)?;
    {
        let mut cfg = state.config.write().await;
        *cfg = incoming;
    }
    state.save().await.map_err(err)
}

fn slugify(s: &str) -> String {
    let mut out = String::new();
    let mut prev_dash = true;
    for ch in s.chars() {
        if ch.is_alphanumeric() {
            for c in ch.to_lowercase() {
                out.push(c);
            }
            prev_dash = false;
        } else if !prev_dash {
            out.push('-');
            prev_dash = true;
        }
    }
    let trimmed = out.trim_matches('-').to_string();
    if trimmed.is_empty() {
        format!("src-{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0))
    } else {
        trimmed
    }
}
