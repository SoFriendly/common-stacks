//! Dynamic plugin loader (subprocess protocol).
//!
//! A plugin is a folder in the user's plugins directory containing:
//!   * `manifest.json` — describes the plugin and points at an executable.
//!   * an executable file (script or binary) that speaks our subprocess
//!     protocol.
//!
//! The protocol is intentionally tiny:
//!   * The host invokes `<plugin-executable> <command>` with a JSON payload on
//!     stdin and reads a JSON or raw-bytes response from stdout.
//!   * Exit code 0 = success, 1 = no result (only meaningful for enrich),
//!     any other value = error, stderr contains a human-readable message.
//!
//! See `docs/PLUGIN_DEVELOPMENT.md` for the full developer guide.

use crate::plugins::{
    EnrichQuery, EnrichedMetadata, MetadataEnricher, PluginDescriptor, SendContext, SendRequest,
    SendResult, SendTarget, SendTargetSettings, SettingField, Transformer,
};
use anyhow::{anyhow, Context, Result};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Arc;

/// Current plugin ABI version. Plugins must echo this in their manifest.
pub const PLUGIN_ABI_VERSION: u32 = 1;

/// Layout of `<plugin-dir>/manifest.json`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginManifest {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    pub version: String,
    pub api_version: u32,
    /// Executable filename, relative to the plugin folder. The host runs this
    /// for every plugin call. On macOS/Linux it must have execute permission;
    /// on Windows it's typically `<id>.exe`.
    pub executable: String,
    /// Plugin categories declared by this plugin. Any subset of
    /// `"metadata"`, `"send"`, `"transformer"`.
    #[serde(default)]
    pub capabilities: Vec<String>,
}

pub fn plugins_dir() -> PathBuf {
    crate::config::config_dir().join("plugins")
}

#[derive(Default)]
pub struct LoadedPlugins {
    pub enrichers: Vec<Arc<dyn MetadataEnricher>>,
    pub send_targets: Vec<Arc<dyn SendTarget>>,
    pub transformers: Vec<Arc<dyn Transformer>>,
}

pub fn load_all() -> LoadedPlugins {
    let dir = plugins_dir();
    let entries = match std::fs::read_dir(&dir) {
        Ok(e) => e,
        Err(_) => {
            let _ = std::fs::create_dir_all(&dir);
            return LoadedPlugins::default();
        }
    };

    let mut out = LoadedPlugins::default();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        match load_one(&path) {
            Ok(loaded) => {
                out.enrichers.extend(loaded.enrichers);
                out.send_targets.extend(loaded.send_targets);
                out.transformers.extend(loaded.transformers);
            }
            Err(e) => tracing::warn!("skipping plugin {}: {}", path.display(), e),
        }
    }
    out
}

#[allow(dead_code)]
pub fn load_metadata_enrichers() -> Vec<Arc<dyn MetadataEnricher>> {
    load_all().enrichers
}

fn load_one(plugin_dir: &Path) -> Result<LoadedPlugins> {
    let manifest_path = plugin_dir.join("manifest.json");
    let manifest_bytes = std::fs::read(&manifest_path)
        .with_context(|| format!("reading {}", manifest_path.display()))?;
    let manifest: PluginManifest =
        serde_json::from_slice(&manifest_bytes).context("parsing manifest.json")?;

    if manifest.api_version != PLUGIN_ABI_VERSION {
        return Err(anyhow!(
            "incompatible plugin API version {} (host supports {})",
            manifest.api_version,
            PLUGIN_ABI_VERSION
        ));
    }

    let exe_path = plugin_dir.join(&manifest.executable);
    if !exe_path.exists() {
        return Err(anyhow!("executable {} not found", exe_path.display()));
    }

    let manifest = Arc::new(manifest);
    let mut out = LoadedPlugins::default();
    let cap = |name: &str| manifest.capabilities.iter().any(|c| c == name);

    if cap("metadata") {
        out.enrichers.push(Arc::new(SubprocessEnricher {
            manifest: manifest.clone(),
            exe_path: exe_path.clone(),
        }));
    }
    if cap("send") {
        match SubprocessSendTarget::probe(manifest.clone(), exe_path.clone()) {
            Ok(t) => out.send_targets.push(Arc::new(t)),
            Err(e) => tracing::warn!("plugin {} send: {}", manifest.id, e),
        }
    }
    if cap("transformer") {
        match SubprocessTransformer::probe(manifest.clone(), exe_path.clone()) {
            Ok(t) => out.transformers.push(Arc::new(t)),
            Err(e) => tracing::warn!("plugin {} transformer: {}", manifest.id, e),
        }
    }

    Ok(out)
}

// -------------------------------------------------------------------------
// Shared helpers
// -------------------------------------------------------------------------

/// Spawn the plugin, pipe `stdin` if non-empty, capture stdout/stderr.
fn run_plugin(
    exe: &Path,
    command: &str,
    args: &[&str],
    stdin_bytes: &[u8],
) -> Result<RawResult> {
    let mut child = Command::new(exe)
        .arg(command)
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .with_context(|| format!("spawning plugin {}", exe.display()))?;

    if !stdin_bytes.is_empty() {
        let mut child_stdin = child
            .stdin
            .take()
            .ok_or_else(|| anyhow!("failed to open plugin stdin"))?;
        child_stdin.write_all(stdin_bytes)?;
        // Closing stdin signals EOF to the plugin.
        drop(child_stdin);
    } else {
        drop(child.stdin.take());
    }

    let output = child
        .wait_with_output()
        .with_context(|| format!("waiting on plugin {}", exe.display()))?;
    Ok(RawResult {
        exit_code: output.status.code().unwrap_or(-1),
        stdout: output.stdout,
        stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
    })
}

struct RawResult {
    exit_code: i32,
    stdout: Vec<u8>,
    stderr: String,
}

fn descriptor_from(manifest: &PluginManifest) -> PluginDescriptor {
    PluginDescriptor {
        id: manifest.id.clone(),
        name: manifest.name.clone(),
        description: manifest.description.clone(),
    }
}

// -------------------------------------------------------------------------
// Metadata enricher
// -------------------------------------------------------------------------

struct SubprocessEnricher {
    manifest: Arc<PluginManifest>,
    exe_path: PathBuf,
}

#[async_trait]
impl MetadataEnricher for SubprocessEnricher {
    fn descriptor(&self) -> PluginDescriptor {
        descriptor_from(&self.manifest)
    }

    async fn enrich(&self, q: &EnrichQuery) -> Result<Option<EnrichedMetadata>> {
        let payload = serde_json::to_vec(q)?;
        let exe = self.exe_path.clone();
        let result = tokio::task::spawn_blocking(move || {
            run_plugin(&exe, "enrich", &[], &payload)
        })
        .await??;
        match result.exit_code {
            0 => Ok(Some(
                serde_json::from_slice(&result.stdout).context("parsing enrich result")?,
            )),
            1 => Ok(None),
            _ => Err(anyhow!(
                if result.stderr.is_empty() {
                    format!("plugin exited with status {}", result.exit_code)
                } else {
                    result.stderr
                }
            )),
        }
    }
}

// -------------------------------------------------------------------------
// Send target
// -------------------------------------------------------------------------

struct SubprocessSendTarget {
    manifest: Arc<PluginManifest>,
    exe_path: PathBuf,
    schema: Vec<SettingField>,
}

impl SubprocessSendTarget {
    fn probe(manifest: Arc<PluginManifest>, exe_path: PathBuf) -> Result<Self> {
        let result = run_plugin(&exe_path, "schema", &["send"], &[])?;
        if result.exit_code != 0 {
            return Err(anyhow!("schema send failed: {}", result.stderr));
        }
        let schema: Vec<SettingField> = if result.stdout.is_empty() {
            Vec::new()
        } else {
            serde_json::from_slice(&result.stdout).context("parsing send schema")?
        };
        Ok(Self {
            manifest,
            exe_path,
            schema,
        })
    }
}

#[derive(Serialize)]
struct SendInvocation<'a> {
    request: &'a SendRequest,
    settings: &'a HashMap<String, String>,
}

#[async_trait]
impl SendTarget for SubprocessSendTarget {
    fn descriptor(&self) -> PluginDescriptor {
        descriptor_from(&self.manifest)
    }

    fn settings_schema(&self) -> Vec<SettingField> {
        self.schema.clone()
    }

    async fn send(
        &self,
        req: &SendRequest,
        settings: &SendTargetSettings,
        _ctx: &SendContext,
    ) -> Result<SendResult> {
        let payload = serde_json::to_vec(&SendInvocation {
            request: req,
            settings: &settings.fields,
        })?;
        let exe = self.exe_path.clone();
        let result = tokio::task::spawn_blocking(move || {
            run_plugin(&exe, "send", &[], &payload)
        })
        .await??;
        match result.exit_code {
            0 => Ok(serde_json::from_slice(&result.stdout).context("parsing send result")?),
            _ => Err(anyhow!(
                if result.stderr.is_empty() {
                    format!("plugin exited with status {}", result.exit_code)
                } else {
                    result.stderr
                }
            )),
        }
    }
}

// -------------------------------------------------------------------------
// Transformer
// -------------------------------------------------------------------------

#[allow(dead_code)]
struct SubprocessTransformer {
    manifest: Arc<PluginManifest>,
    exe_path: PathBuf,
    schema: Vec<SettingField>,
    applies_to: Vec<String>,
    applies_to_static: Vec<&'static str>,
}

impl SubprocessTransformer {
    fn probe(manifest: Arc<PluginManifest>, exe_path: PathBuf) -> Result<Self> {
        let schema_res = run_plugin(&exe_path, "schema", &["transform"], &[])?;
        if schema_res.exit_code != 0 {
            return Err(anyhow!("schema transform failed: {}", schema_res.stderr));
        }
        let schema: Vec<SettingField> = if schema_res.stdout.is_empty() {
            Vec::new()
        } else {
            serde_json::from_slice(&schema_res.stdout)?
        };

        let applies_res = run_plugin(&exe_path, "applies_to", &[], &[])?;
        if applies_res.exit_code != 0 {
            return Err(anyhow!("applies_to failed: {}", applies_res.stderr));
        }
        let applies_to: Vec<String> = if applies_res.stdout.is_empty() {
            Vec::new()
        } else {
            serde_json::from_slice(&applies_res.stdout)?
        };
        let applies_to_static: Vec<&'static str> = applies_to
            .iter()
            .map(|s| Box::leak(s.clone().into_boxed_str()) as &'static str)
            .collect();

        Ok(Self {
            manifest,
            exe_path,
            schema,
            applies_to,
            applies_to_static,
        })
    }
}

#[derive(Serialize)]
#[allow(dead_code)]
struct TransformInvocation<'a> {
    settings: &'a HashMap<String, String>,
    input_path: &'a str,
    output_path: &'a str,
}

#[async_trait]
impl Transformer for SubprocessTransformer {
    fn descriptor(&self) -> PluginDescriptor {
        descriptor_from(&self.manifest)
    }

    fn settings_schema(&self) -> Vec<SettingField> {
        self.schema.clone()
    }

    fn applies_to(&self) -> &[&'static str] {
        &self.applies_to_static
    }

    async fn transform(
        &self,
        input: Vec<u8>,
        settings: &SendTargetSettings,
    ) -> Result<Vec<u8>> {
        let exe = self.exe_path.clone();
        let settings_fields = settings.fields.clone();
        tokio::task::spawn_blocking(move || -> Result<Vec<u8>> {
            // Write the input bytes to a temp file, ask the plugin to write
            // the transformed output to another temp file. Keeps plugin
            // authors out of the binary-framing business.
            let tmp_dir = std::env::temp_dir();
            let stamp = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0);
            let in_path = tmp_dir.join(format!("cs-plugin-{}-in", stamp));
            let out_path = tmp_dir.join(format!("cs-plugin-{}-out", stamp));
            std::fs::write(&in_path, &input)?;

            let payload = serde_json::to_vec(&TransformInvocation {
                settings: &settings_fields,
                input_path: in_path.to_str().unwrap_or(""),
                output_path: out_path.to_str().unwrap_or(""),
            })?;

            let result = run_plugin(&exe, "transform", &[], &payload);
            let _ = std::fs::remove_file(&in_path);

            let result = result?;
            if result.exit_code != 0 {
                let _ = std::fs::remove_file(&out_path);
                return Err(anyhow!(
                    if result.stderr.is_empty() {
                        format!("plugin exited with status {}", result.exit_code)
                    } else {
                        result.stderr
                    }
                ));
            }
            let bytes = std::fs::read(&out_path)
                .with_context(|| format!("reading plugin output {}", out_path.display()))?;
            let _ = std::fs::remove_file(&out_path);
            Ok(bytes)
        })
        .await?
    }
}
