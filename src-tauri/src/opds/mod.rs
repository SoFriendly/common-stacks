pub mod auth;
pub mod feed;
pub mod parse_v1;
pub mod parse_v2;

use crate::config::{AuthConfig, Source};
use anyhow::{anyhow, Result};
use feed::Feed;
use reqwest::header::{HeaderMap, HeaderValue, ACCEPT, USER_AGENT};
use std::time::Duration;

const OPDS_ACCEPT: &str = "application/opds+json, application/atom+xml;profile=opds-catalog, application/atom+xml, application/xml;q=0.8, */*;q=0.5";

pub struct OpdsClient {
    http: reqwest::Client,
}

impl OpdsClient {
    pub fn new() -> Self {
        let mut headers = HeaderMap::new();
        headers.insert(ACCEPT, HeaderValue::from_static(OPDS_ACCEPT));
        headers.insert(
            USER_AGENT,
            HeaderValue::from_static("CommonStacks/0.1 (+https://github.com/jmitch)"),
        );
        let http = reqwest::Client::builder()
            .default_headers(headers)
            .timeout(Duration::from_secs(60))
            .connect_timeout(Duration::from_secs(15))
            .build()
            .expect("reqwest client");
        Self { http }
    }

    pub async fn fetch_feed(&self, source: &Source, url: &str) -> Result<Feed> {
        let mut req = self.http.get(url);
        req = auth::apply(req, &source.auth);
        let resp = req.send().await?.error_for_status()?;
        let ct = resp
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_ascii_lowercase();
        let bytes = resp.bytes().await?;

        if ct.contains("json") {
            parse_v2::parse(&bytes, url)
        } else if ct.contains("xml") || ct.contains("atom") {
            parse_v1::parse(&bytes, url)
        } else {
            // Best-effort sniff
            let head = std::str::from_utf8(&bytes[..bytes.len().min(256)]).unwrap_or("");
            if head.trim_start().starts_with('{') {
                parse_v2::parse(&bytes, url)
            } else if head.trim_start().starts_with('<') {
                parse_v1::parse(&bytes, url)
            } else {
                Err(anyhow!("unknown OPDS content-type: {}", ct))
            }
        }
    }

    pub async fn search(&self, source: &Source, query: &str) -> Result<Feed> {
        // Best-effort: discover the search template from the source root.
        let root = self.fetch_feed(source, &source.url).await?;
        let template = root.search_template.clone().ok_or_else(|| {
            anyhow!("source `{}` does not advertise an OpenSearch endpoint", source.name)
        })?;
        let url = template.replace("{searchTerms}", &urlencoding(query));
        self.fetch_feed(source, &url).await
    }

    pub async fn download(
        &self,
        source: &Source,
        url: &str,
    ) -> Result<(Vec<u8>, Option<String>)> {
        // Downloads can be large (multi-MB EPUBs) and often involve cross-host
        // redirects (e.g. Mayberry → faraway.branch.pub). Use a per-request
        // client with a generous total timeout but a tight connect timeout so
        // we fail fast on unreachable hosts.
        let client = reqwest::Client::builder()
            .default_headers({
                let mut h = reqwest::header::HeaderMap::new();
                h.insert(
                    reqwest::header::USER_AGENT,
                    reqwest::header::HeaderValue::from_static(
                        "CommonStacks/0.1 (+https://github.com/jmitch)",
                    ),
                );
                h
            })
            .timeout(Duration::from_secs(600))
            .connect_timeout(Duration::from_secs(15))
            .build()?;
        let mut req = client.get(url);
        req = auth::apply(req, &source.auth);
        let resp = req.send().await?.error_for_status()?;
        let ct = resp
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string());
        let bytes = resp.bytes().await?;
        Ok((bytes.to_vec(), ct))
    }
}

fn urlencoding(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            b' ' => out.push('+'),
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

#[allow(dead_code)]
pub fn auth_supported(_a: &AuthConfig) -> bool {
    true
}
