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
        let root = self.fetch_feed(source, &source.url).await?;
        let template_url = root.search_template.clone().ok_or_else(|| {
            anyhow!("source `{}` does not advertise a search endpoint", source.name)
        })?;
        let template = self
            .resolve_search_template(source, &template_url)
            .await?;
        let url = template.replace("{searchTerms}", &urlencoding(query));
        self.fetch_feed(source, &url).await
    }

    /// Many catalogs advertise search via an OpenSearch Description Document
    /// (OSDD) at `rel="search"` rather than a direct templated URL. If the
    /// pointed-to URL contains "{searchTerms}" we use it directly; otherwise
    /// we fetch it, parse the OSDD, and pull out the atom+xml Url template.
    async fn resolve_search_template(
        &self,
        source: &Source,
        template_or_osdd: &str,
    ) -> Result<String> {
        if template_or_osdd.contains("{searchTerms}") {
            return Ok(template_or_osdd.to_string());
        }
        let mut req = self.http.get(template_or_osdd);
        req = auth::apply(req, &source.auth);
        let resp = req.send().await?.error_for_status()?;
        let body = resp.text().await?;
        let resolved = parse_osdd(&body, template_or_osdd)
            .ok_or_else(|| anyhow!("could not parse OpenSearch description from {}", template_or_osdd))?;
        Ok(resolved)
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

/// Parse an OpenSearch Description Document and return the best atom/opds
/// search URL template. Returns None if no usable template is found.
fn parse_osdd(xml: &str, base_url: &str) -> Option<String> {
    use quick_xml::events::Event;
    use quick_xml::Reader;

    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);

    // (priority, template)
    let mut best: Option<(u8, String)> = None;
    let mut buf = Vec::new();
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Eof) | Err(_) => break,
            Ok(Event::Start(e)) | Ok(Event::Empty(e)) => {
                let name = e.name();
                let local = name
                    .as_ref()
                    .rsplit(|b| *b == b':')
                    .next()
                    .unwrap_or(name.as_ref());
                if local != b"Url" {
                    continue;
                }
                let mut tpl: Option<String> = None;
                let mut ty = String::new();
                let mut rel = String::new();
                for a in e.attributes().flatten() {
                    let k = a.key.as_ref();
                    let key = k
                        .rsplit(|b| *b == b':')
                        .next()
                        .unwrap_or(k);
                    let v = a
                        .unescape_value()
                        .map(|c| c.into_owned())
                        .unwrap_or_else(|_| String::from_utf8_lossy(&a.value).into_owned());
                    match key {
                        b"template" => tpl = Some(v),
                        b"type" => ty = v,
                        b"rel" => rel = v,
                        _ => {}
                    }
                }
                let Some(tpl) = tpl else { continue };
                if rel.eq_ignore_ascii_case("suggestions") || rel.eq_ignore_ascii_case("self") {
                    continue;
                }
                // Prefer OPDS-flavored atom feeds; then plain atom; then anything.
                let prio = if ty.contains("opds-catalog") {
                    0
                } else if ty.contains("atom+xml") {
                    1
                } else if ty.is_empty() {
                    2
                } else if ty.contains("html") {
                    9 // last resort — we can't parse HTML results
                } else {
                    3
                };
                let absolute = resolve_url(base_url, &tpl);
                if best.as_ref().map_or(true, |(p, _)| prio < *p) {
                    best = Some((prio, absolute));
                }
            }
            _ => {}
        }
        buf.clear();
    }
    best.map(|(_, t)| t)
}

fn resolve_url(base: &str, href: &str) -> String {
    if let Ok(b) = url::Url::parse(base) {
        if let Ok(joined) = b.join(href) {
            return joined.to_string();
        }
    }
    href.to_string()
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
