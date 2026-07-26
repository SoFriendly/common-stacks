use crate::config::{self, Config, Source};
use crate::libby::LibbyContext;
use crate::opds::OpdsClient;
use crate::plugins::PluginRegistry;
use std::sync::{Arc, Mutex};
use tokio::sync::RwLock;

pub struct AppState {
    pub config: Arc<RwLock<Config>>,
    pub client: Arc<OpdsClient>,
    pub plugins: Arc<PluginRegistry>,
    /// Book the Libby webview is currently showing (reported by the injected
    /// script) — used to name and decorate files downloaded from Libby.
    pub libby_context: Mutex<Option<LibbyContext>>,
}

impl AppState {
    pub fn new() -> Self {
        let config = config::load_or_seed();
        Self {
            config: Arc::new(RwLock::new(config)),
            client: Arc::new(OpdsClient::new()),
            plugins: Arc::new(PluginRegistry::new()),
            libby_context: Mutex::new(None),
        }
    }

    pub async fn sources(&self) -> Vec<Source> {
        self.config.read().await.sources.clone()
    }

    pub async fn save(&self) -> anyhow::Result<()> {
        let cfg = self.config.read().await.clone();
        config::save(&cfg)
    }
}
