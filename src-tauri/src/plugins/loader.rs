//! Dynamic plugin loader.
//!
//! Plugins are native dynamic libraries (`.dylib` / `.so` / `.dll`) accompanied
//! by a `manifest.json`. They communicate with the host across a small, stable
//! C-ABI surface that exchanges UTF-8 JSON bytes — so plugins can be built in
//! any language and stay compatible across Rust toolchain versions.
//!
//! See `docs/PLUGIN_DEVELOPMENT.md` for the developer guide.

use crate::plugins::{
    EnrichQuery, EnrichedMetadata, MetadataEnricher, PluginDescriptor,
};
use anyhow::{anyhow, Context, Result};
use async_trait::async_trait;
use libloading::Library;
use serde::{Deserialize, Serialize};
use std::ffi::c_int;
use std::path::{Path, PathBuf};
use std::sync::Arc;

/// Current plugin ABI version. Plugins MUST report this exact value via the
/// `commonstacks_plugin_api_version` symbol. Increment when the protocol
/// changes incompatibly.
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
    /// Filename of the library inside the plugin directory.
    pub library: String,
    /// Plugin categories declared by this library. Currently only "metadata"
    /// is honored; "send" and "transformer" are reserved for future expansion.
    #[serde(default)]
    pub capabilities: Vec<String>,
}

pub fn plugins_dir() -> PathBuf {
    crate::config::config_dir().join("plugins")
}

/// Scan the plugins directory and return every loadable metadata enricher
/// found. Best-effort: malformed plugins log a warning and are skipped, never
/// aborting the load of others.
pub fn load_metadata_enrichers() -> Vec<Arc<dyn MetadataEnricher>> {
    let dir = plugins_dir();
    let entries = match std::fs::read_dir(&dir) {
        Ok(e) => e,
        Err(_) => {
            // Directory simply doesn't exist yet — nothing to load.
            let _ = std::fs::create_dir_all(&dir);
            return Vec::new();
        }
    };

    let mut out: Vec<Arc<dyn MetadataEnricher>> = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        match load_one(&path) {
            Ok(plugins) => out.extend(plugins),
            Err(e) => tracing::warn!("skipping plugin {}: {}", path.display(), e),
        }
    }
    out
}

fn load_one(plugin_dir: &Path) -> Result<Vec<Arc<dyn MetadataEnricher>>> {
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

    let lib_path = plugin_dir.join(&manifest.library);
    if !lib_path.exists() {
        return Err(anyhow!("library file {} not found", lib_path.display()));
    }

    // SAFETY: Loading arbitrary native code is intrinsically unsafe. The user
    // dropped this file into their plugin dir; that's the same trust level as
    // running any binary they install on their machine.
    let library = unsafe {
        Library::new(&lib_path).with_context(|| format!("dlopen {}", lib_path.display()))?
    };

    // Probe the API version symbol to guard against manifest/library skew.
    type ApiVersionFn = unsafe extern "C" fn() -> u32;
    let version: ApiVersionFn = unsafe {
        *library
            .get(b"commonstacks_plugin_api_version\0")
            .context("plugin missing `commonstacks_plugin_api_version` symbol")?
    };
    let reported = unsafe { version() };
    if reported != PLUGIN_ABI_VERSION {
        return Err(anyhow!(
            "plugin reports API version {} but manifest claims {}",
            reported,
            manifest.api_version
        ));
    }

    let library = Arc::new(library);
    let mut out: Vec<Arc<dyn MetadataEnricher>> = Vec::new();

    if manifest.capabilities.iter().any(|c| c == "metadata") {
        match DynEnricher::new(library.clone(), &manifest) {
            Ok(e) => out.push(Arc::new(e)),
            Err(e) => tracing::warn!("plugin {} metadata: {}", manifest.id, e),
        }
    }

    Ok(out)
}

// -------------------------------------------------------------------------
// Metadata enricher adapter
// -------------------------------------------------------------------------

type EnrichFn = unsafe extern "C" fn(
    input_ptr: *const u8,
    input_len: usize,
    out_ptr: *mut *mut u8,
    out_len: *mut usize,
) -> c_int;

type FreeFn = unsafe extern "C" fn(ptr: *mut u8, len: usize);

struct DynEnricher {
    // Keep the library alive for as long as the enricher exists. Trait objects
    // produced from the library would dangle if the dylib unloaded first.
    _library: Arc<Library>,
    descriptor: PluginDescriptor,
    enrich: EnrichFn,
    free: FreeFn,
}

impl DynEnricher {
    fn new(library: Arc<Library>, manifest: &PluginManifest) -> Result<Self> {
        let enrich: EnrichFn = unsafe {
            *library
                .get(b"commonstacks_plugin_enrich\0")
                .context("missing `commonstacks_plugin_enrich`")?
        };
        let free: FreeFn = unsafe {
            *library
                .get(b"commonstacks_plugin_free\0")
                .context("missing `commonstacks_plugin_free`")?
        };
        Ok(Self {
            descriptor: PluginDescriptor {
                id: manifest.id.clone(),
                name: manifest.name.clone(),
                description: manifest.description.clone(),
            },
            _library: library,
            enrich,
            free,
        })
    }
}

#[async_trait]
impl MetadataEnricher for DynEnricher {
    fn descriptor(&self) -> PluginDescriptor {
        self.descriptor.clone()
    }

    async fn enrich(&self, q: &EnrichQuery) -> Result<Option<EnrichedMetadata>> {
        let payload = serde_json::to_vec(q)?;
        let enrich = self.enrich;
        let free = self.free;
        // Run the FFI call on a blocking thread so a slow plugin can't stall
        // the async runtime.
        let result = tokio::task::spawn_blocking(move || -> Result<Option<EnrichedMetadata>> {
            let mut out_ptr: *mut u8 = std::ptr::null_mut();
            let mut out_len: usize = 0;
            let status = unsafe {
                enrich(payload.as_ptr(), payload.len(), &mut out_ptr, &mut out_len)
            };
            match status {
                0 => {
                    if out_ptr.is_null() || out_len == 0 {
                        return Ok(None);
                    }
                    let bytes = unsafe { std::slice::from_raw_parts(out_ptr, out_len).to_vec() };
                    unsafe { free(out_ptr, out_len) };
                    let meta: EnrichedMetadata = serde_json::from_slice(&bytes)?;
                    Ok(Some(meta))
                }
                1 => Ok(None),
                _ => {
                    // Plugin reported an error. If it wrote a UTF-8 message
                    // into out_ptr/out_len, surface it.
                    let msg = if !out_ptr.is_null() && out_len > 0 {
                        let bytes =
                            unsafe { std::slice::from_raw_parts(out_ptr, out_len).to_vec() };
                        unsafe { free(out_ptr, out_len) };
                        String::from_utf8_lossy(&bytes).into_owned()
                    } else {
                        format!("plugin returned status {}", status)
                    };
                    Err(anyhow!(msg))
                }
            }
        })
        .await??;
        Ok(result)
    }
}
