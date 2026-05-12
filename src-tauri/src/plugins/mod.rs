//! CommonStacks plugin SDK.
//!
//! Two extension points are defined here as Rust traits. They're internally
//! satisfied by built-in implementations for v1, but the trait surface is
//! designed so future versions can load plugins dynamically (Rust dylibs or
//! WASM modules) without changing call sites.
//!
//! * `MetadataEnricher` — looks up extra metadata (covers, descriptions,
//!   subjects, identifiers) for a given book.
//! * `SendTarget` — delivers a downloaded file to an external destination
//!   (e.g. a Kindle email, a WebDAV server, eventually KOReader).

pub mod loader;
pub mod metadata;
pub mod send;
pub mod transform;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct EnrichQuery {
    pub isbn: Option<String>,
    pub title: Option<String>,
    pub authors: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct EnrichedMetadata {
    pub source: String,
    pub title: Option<String>,
    pub authors: Vec<String>,
    pub description: Option<String>,
    pub subjects: Vec<String>,
    pub publisher: Option<String>,
    pub published: Option<String>,
    pub language: Option<String>,
    pub cover_url: Option<String>,
    pub identifiers: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginDescriptor {
    pub id: String,
    pub name: String,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SettingKind {
    Text,
    Secret,
    Email,
    Url,
    Number,
    /// Renders as a toggle. Stored as the string "true" or "false".
    Boolean,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SettingField {
    pub key: String,
    pub label: String,
    #[serde(default)]
    pub help: Option<String>,
    #[serde(default)]
    pub required: bool,
    pub kind: SettingKind,
    #[serde(default)]
    pub placeholder: Option<String>,
    #[serde(default)]
    pub default: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SendTargetSettings {
    pub fields: std::collections::HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SendRequest {
    pub target_id: String,
    pub file_path: PathBuf,
    pub title: Option<String>,
    pub author: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SendResult {
    pub ok: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SendProgress {
    pub stage: String,
    pub message: String,
    #[serde(default)]
    pub current: Option<u64>,
    #[serde(default)]
    pub total: Option<u64>,
}

impl SendProgress {
    pub fn stage(stage: &str, message: impl Into<String>) -> Self {
        Self {
            stage: stage.into(),
            message: message.into(),
            current: None,
            total: None,
        }
    }
    pub fn ratio(stage: &str, message: impl Into<String>, current: u64, total: u64) -> Self {
        Self {
            stage: stage.into(),
            message: message.into(),
            current: Some(current),
            total: Some(total),
        }
    }
}

/// Context passed to `SendTarget::send` so plugins can stream progress back to
/// the UI. Cheap to clone — wraps a Tauri Channel internally.
#[derive(Clone)]
pub struct SendContext {
    pub progress: tauri::ipc::Channel<SendProgress>,
}

impl SendContext {
    pub fn emit(&self, p: SendProgress) {
        let _ = self.progress.send(p);
    }
}

#[async_trait]
pub trait MetadataEnricher: Send + Sync {
    fn descriptor(&self) -> PluginDescriptor;
    async fn enrich(&self, q: &EnrichQuery) -> anyhow::Result<Option<EnrichedMetadata>>;
}

#[async_trait]
pub trait SendTarget: Send + Sync {
    fn descriptor(&self) -> PluginDescriptor;
    fn settings_schema(&self) -> Vec<SettingField>;
    async fn send(
        &self,
        req: &SendRequest,
        settings: &SendTargetSettings,
        ctx: &SendContext,
    ) -> anyhow::Result<SendResult>;
}

/// A pre-upload byte transformer. Transformers can declare which file
/// extensions they apply to so the registry can wire them into send targets
/// conditionally (e.g. EPUB image optimizer only runs for .epub files).
#[allow(dead_code)] // Surface used by future plugin loader; currently invoked directly.
#[async_trait]
pub trait Transformer: Send + Sync {
    fn descriptor(&self) -> PluginDescriptor;
    fn settings_schema(&self) -> Vec<SettingField>;
    /// Lowercase, no-dot file extensions this transformer handles.
    fn applies_to(&self) -> &[&'static str];
    async fn transform(
        &self,
        input: Vec<u8>,
        settings: &SendTargetSettings,
    ) -> anyhow::Result<Vec<u8>>;
}

/// Where a plugin came from. Used by the UI to label rows.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PluginSource {
    Builtin,
    User,
}

pub struct PluginRegistry {
    enrichers: Vec<Arc<dyn MetadataEnricher>>,
    send_targets: Vec<Arc<dyn SendTarget>>,
    transformers: Vec<Arc<dyn Transformer>>,
    /// Plugin id → its source. Populated for both built-in plugins and any
    /// loaded from the user's plugins directory.
    sources: std::collections::HashMap<String, PluginSource>,
}

impl PluginRegistry {
    pub fn new() -> Self {
        let mut reg = Self {
            enrichers: Vec::new(),
            send_targets: Vec::new(),
            transformers: Vec::new(),
            sources: std::collections::HashMap::new(),
        };
        reg.register_builtins();
        reg.register_user_plugins();
        reg
    }

    fn register_builtins(&mut self) {
        let openlibrary = Arc::new(metadata::openlibrary::OpenLibraryEnricher::new());
        let crosspoint = Arc::new(send::crosspoint::CrosspointTarget);
        let kindle = Arc::new(send::kindle_email::KindleEmailTarget);
        let webdav = Arc::new(send::webdav::WebDavTarget);
        let optimizer = Arc::new(transform::epub_optimizer::EpubOptimizer);

        self.sources
            .insert(openlibrary.descriptor().id, PluginSource::Builtin);
        self.sources
            .insert(crosspoint.descriptor().id, PluginSource::Builtin);
        self.sources
            .insert(kindle.descriptor().id, PluginSource::Builtin);
        self.sources
            .insert(webdav.descriptor().id, PluginSource::Builtin);
        self.sources
            .insert(optimizer.descriptor().id, PluginSource::Builtin);

        self.enrichers.push(openlibrary);
        self.send_targets.push(crosspoint);
        self.send_targets.push(kindle);
        self.send_targets.push(webdav);
        self.transformers.push(optimizer);
    }

    fn register_user_plugins(&mut self) {
        for enricher in loader::load_metadata_enrichers() {
            let id = enricher.descriptor().id;
            tracing::info!("loaded user metadata enricher plugin: {}", id);
            self.sources.insert(id, PluginSource::User);
            self.enrichers.push(enricher);
        }
    }

    pub fn source_for(&self, id: &str) -> PluginSource {
        self.sources.get(id).copied().unwrap_or(PluginSource::Builtin)
    }

    pub fn enrichers(&self) -> &[Arc<dyn MetadataEnricher>] {
        &self.enrichers
    }

    pub fn send_targets(&self) -> &[Arc<dyn SendTarget>] {
        &self.send_targets
    }

    #[allow(dead_code)]
    pub fn transformers(&self) -> &[Arc<dyn Transformer>] {
        &self.transformers
    }

    pub fn find_enricher(&self, id: &str) -> Option<Arc<dyn MetadataEnricher>> {
        self.enrichers
            .iter()
            .find(|e| e.descriptor().id == id)
            .cloned()
    }

    pub fn find_send_target(&self, id: &str) -> Option<Arc<dyn SendTarget>> {
        self.send_targets
            .iter()
            .find(|t| t.descriptor().id == id)
            .cloned()
    }

    #[allow(dead_code)]
    pub fn find_transformer(&self, id: &str) -> Option<Arc<dyn Transformer>> {
        self.transformers
            .iter()
            .find(|t| t.descriptor().id == id)
            .cloned()
    }
}
