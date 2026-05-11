use crate::config::AuthConfig;
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use reqwest::RequestBuilder;

pub fn apply(req: RequestBuilder, auth: &AuthConfig) -> RequestBuilder {
    match auth {
        AuthConfig::None => req,
        AuthConfig::Basic { username, password } => {
            let token = B64.encode(format!("{}:{}", username, password));
            req.header("Authorization", format!("Basic {}", token))
        }
        AuthConfig::Bearer { token } => {
            req.header("Authorization", format!("Bearer {}", token))
        }
        AuthConfig::Cookie { cookie } => req.header("Cookie", cookie.clone()),
    }
}
