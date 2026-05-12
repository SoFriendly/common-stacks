use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AuthConfig {
    None,
    Basic { username: String, password: String },
    Bearer { token: String },
    Cookie { cookie: String },
}

impl Default for AuthConfig {
    fn default() -> Self {
        AuthConfig::None
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Source {
    pub id: String,
    pub name: String,
    pub url: String,
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub auth: AuthConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Preferences {
    pub download_dir: Option<PathBuf>,
    #[serde(default = "default_preferred_formats")]
    pub preferred_formats: Vec<String>,
}

fn default_preferred_formats() -> Vec<String> {
    vec![
        "epub".into(),
        "azw3".into(),
        "mobi".into(),
        "pdf".into(),
        "cbz".into(),
        "cbr".into(),
    ]
}

impl Default for Preferences {
    fn default() -> Self {
        Self {
            download_dir: None,
            preferred_formats: default_preferred_formats(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Config {
    #[serde(default)]
    pub sources: Vec<Source>,
    #[serde(default)]
    pub preferences: Preferences,
    /// Per-send-target settings, keyed by target id (e.g. "kindle-email").
    #[serde(default)]
    pub send_targets: std::collections::HashMap<String, std::collections::HashMap<String, String>>,
    /// Whether each send target is currently enabled (visible on books).
    /// Missing entries default to `false` so new targets are opt-in.
    #[serde(default)]
    pub send_target_enabled: std::collections::HashMap<String, bool>,
}

pub fn config_dir() -> PathBuf {
    let base = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));
    base.join("CommonStacks")
}

pub fn config_path() -> PathBuf {
    config_dir().join("config.json")
}

pub fn default_download_dir() -> PathBuf {
    if let Some(home) = dirs::home_dir() {
        home.join("Books").join("CommonStacks")
    } else {
        PathBuf::from("CommonStacks")
    }
}

pub fn load_or_seed() -> Config {
    let path = config_path();
    if path.exists() {
        if let Ok(bytes) = fs::read(&path) {
            if let Ok(cfg) = serde_json::from_slice::<Config>(&bytes) {
                return cfg;
            }
        }
    }
    let seeded = Config {
        sources: vec![
            Source {
                id: "mayberry".into(),
                name: "Mayberry".into(),
                url: "https://mayberry.pub".into(),
                enabled: true,
                auth: AuthConfig::None,
            },
            Source {
                id: "gutenberg".into(),
                name: "Project Gutenberg".into(),
                url: "https://m.gutenberg.org/ebooks.opds/".into(),
                enabled: true,
                auth: AuthConfig::None,
            },
            // Standard Ebooks ships disabled — the catalog requires Patrons
            // Circle authentication (HTTP Basic, your email as the username,
            // password left blank). Enable it in Settings → Libraries and
            // add the auth there.
            Source {
                id: "standard-ebooks".into(),
                name: "Standard Ebooks".into(),
                url: "https://standardebooks.org/feeds/opds/all".into(),
                enabled: false,
                auth: AuthConfig::None,
            },
        ],
        preferences: Preferences::default(),
        send_targets: Default::default(),
        send_target_enabled: Default::default(),
    };
    let _ = save(&seeded);
    seeded
}

pub fn save(cfg: &Config) -> anyhow::Result<()> {
    let dir = config_dir();
    fs::create_dir_all(&dir)?;
    let bytes = serde_json::to_vec_pretty(cfg)?;
    fs::write(config_path(), bytes)?;
    Ok(())
}

pub fn resolved_download_dir(cfg: &Config) -> PathBuf {
    cfg.preferences
        .download_dir
        .clone()
        .unwrap_or_else(default_download_dir)
}
