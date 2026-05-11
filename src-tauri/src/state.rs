use crate::config::{self, Config, Source};
use crate::opds::OpdsClient;
use std::sync::Arc;
use tokio::sync::RwLock;

pub struct AppState {
    pub config: Arc<RwLock<Config>>,
    pub client: Arc<OpdsClient>,
}

impl AppState {
    pub fn new() -> Self {
        let config = config::load_or_seed();
        Self {
            config: Arc::new(RwLock::new(config)),
            client: Arc::new(OpdsClient::new()),
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
