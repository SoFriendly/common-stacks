use crate::opds::feed::{Acquisition, Entry};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MergedBook {
    pub key: String,
    pub title: String,
    pub authors: Vec<String>,
    pub cover: Option<String>,
    pub thumbnail: Option<String>,
    pub summary: Option<String>,
    pub categories: Vec<String>,
    pub series: Option<String>,
    pub language: Option<String>,
    pub identifiers: Vec<String>,
    pub sources: Vec<SourceRef>,
    pub acquisitions: Vec<Acquisition>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SourceRef {
    pub source_id: String,
    pub source_name: String,
    pub entry_id: String,
}

pub fn merge(per_source: &[(String, String, Vec<Entry>)]) -> Vec<MergedBook> {
    let mut index: HashMap<String, MergedBook> = HashMap::new();
    let mut order: Vec<String> = Vec::new();

    for (src_id, src_name, entries) in per_source {
        for e in entries {
            let key = dedup_key(e);
            let sref = SourceRef {
                source_id: src_id.clone(),
                source_name: src_name.clone(),
                entry_id: e.id.clone(),
            };
            match index.get_mut(&key) {
                Some(book) => {
                    book.sources.push(sref);
                    book.acquisitions.extend(e.acquisitions.clone());
                    if book.cover.is_none() {
                        book.cover = e.cover.clone();
                    }
                    if book.thumbnail.is_none() {
                        book.thumbnail = e.thumbnail.clone();
                    }
                    for id in &e.identifiers {
                        if !book.identifiers.contains(id) {
                            book.identifiers.push(id.clone());
                        }
                    }
                    for c in &e.categories {
                        if !book.categories.contains(c) {
                            book.categories.push(c.clone());
                        }
                    }
                }
                None => {
                    order.push(key.clone());
                    index.insert(
                        key.clone(),
                        MergedBook {
                            key,
                            title: e.title.clone(),
                            authors: e.authors.clone(),
                            cover: e.cover.clone(),
                            thumbnail: e.thumbnail.clone(),
                            summary: e.summary.clone(),
                            categories: e.categories.clone(),
                            series: e.series.clone(),
                            language: e.language.clone(),
                            identifiers: e.identifiers.clone(),
                            sources: vec![sref],
                            acquisitions: e.acquisitions.clone(),
                        },
                    );
                }
            }
        }
    }

    order.into_iter().filter_map(|k| index.remove(&k)).collect()
}

fn dedup_key(e: &Entry) -> String {
    // 1. ISBN-13. Mirror Mayberry's extraction: strip hyphens/spaces, then
    // pull a 13-digit run starting with 978/979.
    let mut candidates: Vec<&str> = Vec::with_capacity(e.identifiers.len() + 1);
    candidates.extend(e.identifiers.iter().map(|s| s.as_str()));
    candidates.push(&e.id);
    for c in candidates {
        if let Some(isbn) = extract_isbn13(c) {
            return format!("isbn:{}", isbn);
        }
    }
    // 2/3. Title + first author normalized.
    let t = normalize(&e.title);
    let a = e.authors.first().map(|s| normalize(s)).unwrap_or_default();
    format!("ta:{}|{}", t, a)
}

fn extract_isbn13(s: &str) -> Option<String> {
    let cleaned: String = s
        .chars()
        .filter(|c| *c != '-' && *c != ' ')
        .collect();
    let bytes = cleaned.as_bytes();
    for i in 0..bytes.len().saturating_sub(12) {
        if bytes[i] == b'9'
            && bytes.get(i + 1) == Some(&b'7')
            && matches!(bytes.get(i + 2), Some(b'8') | Some(b'9'))
        {
            let window = &bytes[i..i + 13];
            if window.iter().all(|b| b.is_ascii_digit()) {
                let before_ok = i == 0 || !bytes[i - 1].is_ascii_digit();
                let after_ok = bytes.get(i + 13).map_or(true, |b| !b.is_ascii_digit());
                if before_ok && after_ok {
                    return Some(std::str::from_utf8(window).ok()?.to_string());
                }
            }
        }
    }
    None
}

fn normalize(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut prev_space = true;
    for ch in s.chars() {
        if ch.is_alphanumeric() {
            for c in ch.to_lowercase() {
                out.push(c);
            }
            prev_space = false;
        } else if !prev_space {
            out.push(' ');
            prev_space = true;
        }
    }
    let trimmed = out.trim();
    let stripped = ["the ", "a ", "an "]
        .iter()
        .find_map(|p| trimmed.strip_prefix(p))
        .unwrap_or(trimmed);
    stripped.to_string()
}
