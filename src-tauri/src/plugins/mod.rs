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

pub mod metadata;
pub mod send;

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
    ) -> anyhow::Result<SendResult>;
}

pub struct PluginRegistry {
    enrichers: Vec<Arc<dyn MetadataEnricher>>,
    send_targets: Vec<Arc<dyn SendTarget>>,
}

impl PluginRegistry {
    pub fn new() -> Self {
        let mut reg = Self {
            enrichers: Vec::new(),
            send_targets: Vec::new(),
        };
        reg.register_builtins();
        reg
    }

    fn register_builtins(&mut self) {
        self.enrichers
            .push(Arc::new(metadata::openlibrary::OpenLibraryEnricher::new()));
        self.send_targets
            .push(Arc::new(send::kindle_email::KindleEmailTarget));
        self.send_targets
            .push(Arc::new(send::webdav::WebDavTarget));
    }

    pub fn enrichers(&self) -> &[Arc<dyn MetadataEnricher>] {
        &self.enrichers
    }

    pub fn send_targets(&self) -> &[Arc<dyn SendTarget>] {
        &self.send_targets
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
}
