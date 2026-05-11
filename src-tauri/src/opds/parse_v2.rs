use super::feed::{Acquisition, Entry, Feed, Link};
use anyhow::Result;
use serde_json::Value;
use url::Url;

pub fn parse(bytes: &[u8], base_url: &str) -> Result<Feed> {
    let base = Url::parse(base_url).ok();
    let v: Value = serde_json::from_slice(bytes)?;
    let mut feed = Feed::default();

    if let Some(meta) = v.get("metadata") {
        feed.title = meta.get("title").and_then(|x| x.as_str()).unwrap_or("").to_string();
        feed.id = meta
            .get("identifier")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string();
    }

    if let Some(links) = v.get("links").and_then(|x| x.as_array()) {
        for l in links {
            let (href, rel, mime, title) = link_parts(l, &base);
            let rel_s = rel.as_deref().unwrap_or("");
            match rel_s {
                "self" => feed.self_link = Some(href),
                "next" => feed.next = Some(href),
                "previous" | "prev" => feed.prev = Some(href),
                "search" => {
                    if href.contains("{searchTerms}") {
                        feed.search_template = Some(href);
                    } else {
                        feed.search_template = Some(href);
                    }
                }
                _ => feed.navigation.push(Link { href, rel, title, mime }),
            }
        }
    }

    if let Some(nav) = v.get("navigation").and_then(|x| x.as_array()) {
        for l in nav {
            let (href, rel, mime, title) = link_parts(l, &base);
            feed.navigation.push(Link { href, rel, title, mime });
        }
    }

    let groups = v.get("groups").and_then(|x| x.as_array());
    let mut pubs_collected: Vec<&Value> = Vec::new();
    if let Some(p) = v.get("publications").and_then(|x| x.as_array()) {
        pubs_collected.extend(p.iter());
    }
    if let Some(gs) = groups {
        for g in gs {
            if let Some(p) = g.get("publications").and_then(|x| x.as_array()) {
                pubs_collected.extend(p.iter());
            }
        }
    }

    for p in pubs_collected {
        feed.entries.push(parse_publication(p, &base));
    }

    Ok(feed)
}

fn parse_publication(p: &Value, base: &Option<Url>) -> Entry {
    let mut ent = Entry::default();
    if let Some(meta) = p.get("metadata") {
        ent.title = meta.get("title").and_then(|x| x.as_str()).unwrap_or("").to_string();
        ent.id = meta.get("identifier").and_then(|x| x.as_str()).unwrap_or("").to_string();
        ent.summary = meta.get("description").and_then(|x| x.as_str()).map(|s| s.to_string());
        ent.language = meta.get("language").and_then(|x| x.as_str()).map(|s| s.to_string());
        ent.published = meta.get("published").and_then(|x| x.as_str()).map(|s| s.to_string());
        ent.updated = meta.get("modified").and_then(|x| x.as_str()).map(|s| s.to_string());

        if let Some(author) = meta.get("author") {
            collect_names(author, &mut ent.authors);
        }
        if let Some(subj) = meta.get("subject").and_then(|x| x.as_array()) {
            for s in subj {
                if let Some(name) = s.as_str() {
                    ent.categories.push(name.to_string());
                } else if let Some(name) = s.get("name").and_then(|x| x.as_str()) {
                    ent.categories.push(name.to_string());
                }
            }
        }
        if let Some(series) = meta.get("belongsTo").and_then(|x| x.get("series")) {
            if let Some(name) = series.get("name").and_then(|x| x.as_str()) {
                ent.series = Some(name.to_string());
            }
        }
    }
    if let Some(images) = p.get("images").and_then(|x| x.as_array()) {
        for img in images {
            if let Some(href) = img.get("href").and_then(|x| x.as_str()) {
                let resolved = resolve(base, href);
                if ent.cover.is_none() {
                    ent.cover = Some(resolved.clone());
                }
                ent.thumbnail = Some(resolved);
            }
        }
    }
    if let Some(links) = p.get("links").and_then(|x| x.as_array()) {
        for l in links {
            let (href, rel, mime, title) = link_parts(l, base);
            let rel_s = rel.as_deref().unwrap_or("");
            if rel_s.contains("acquisition") {
                ent.acquisitions.push(Acquisition {
                    href,
                    mime,
                    rel,
                    title,
                    size: None,
                });
            } else {
                ent.navigation.push(Link { href, rel, title, mime });
            }
        }
    }
    ent
}

fn link_parts(
    l: &Value,
    base: &Option<Url>,
) -> (String, Option<String>, Option<String>, Option<String>) {
    let href = l
        .get("href")
        .and_then(|x| x.as_str())
        .map(|h| resolve(base, h))
        .unwrap_or_default();
    let rel = match l.get("rel") {
        Some(Value::String(s)) => Some(s.clone()),
        Some(Value::Array(a)) => a.first().and_then(|x| x.as_str()).map(|s| s.to_string()),
        _ => None,
    };
    let mime = l.get("type").and_then(|x| x.as_str()).map(|s| s.to_string());
    let title = l.get("title").and_then(|x| x.as_str()).map(|s| s.to_string());
    (href, rel, mime, title)
}

fn collect_names(v: &Value, out: &mut Vec<String>) {
    match v {
        Value::String(s) => out.push(s.clone()),
        Value::Object(_) => {
            if let Some(name) = v.get("name").and_then(|x| x.as_str()) {
                out.push(name.to_string());
            }
        }
        Value::Array(arr) => {
            for x in arr {
                collect_names(x, out);
            }
        }
        _ => {}
    }
}

fn resolve(base: &Option<Url>, href: &str) -> String {
    if let Some(b) = base {
        if let Ok(u) = b.join(href) {
            return u.to_string();
        }
    }
    href.to_string()
}
