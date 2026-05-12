use crate::plugins::{
    EnrichQuery, EnrichedMetadata, MetadataEnricher, PluginDescriptor,
};
use anyhow::Result;
use async_trait::async_trait;
use serde_json::Value;

pub struct OpenLibraryEnricher {
    http: reqwest::Client,
}

impl OpenLibraryEnricher {
    pub fn new() -> Self {
        let http = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(20))
            .user_agent("Common Stacks/0.1 (+https://github.com/jmitch)")
            .build()
            .expect("openlibrary client");
        Self { http }
    }

    async fn lookup_by_isbn(&self, isbn: &str) -> Result<Option<EnrichedMetadata>> {
        // Open Library: /api/books?bibkeys=ISBN:{isbn}&format=json&jscmd=data
        let url = format!(
            "https://openlibrary.org/api/books?bibkeys=ISBN:{}&format=json&jscmd=data",
            isbn
        );
        let resp = self.http.get(&url).send().await?;
        if !resp.status().is_success() {
            return Ok(None);
        }
        let v: Value = resp.json().await?;
        let key = format!("ISBN:{}", isbn);
        let Some(book) = v.get(&key) else {
            return Ok(None);
        };
        Ok(Some(from_jscmd_data(book, isbn)))
    }

    async fn lookup_by_title(
        &self,
        title: &str,
        authors: &[String],
    ) -> Result<Option<EnrichedMetadata>> {
        let mut url = format!(
            "https://openlibrary.org/search.json?title={}",
            urlencoding(title)
        );
        if let Some(a) = authors.first() {
            url.push_str(&format!("&author={}", urlencoding(a)));
        }
        url.push_str("&limit=1");
        let resp = self.http.get(&url).send().await?;
        if !resp.status().is_success() {
            return Ok(None);
        }
        let v: Value = resp.json().await?;
        let Some(doc) = v
            .get("docs")
            .and_then(|d| d.as_array())
            .and_then(|a| a.first())
        else {
            return Ok(None);
        };
        Ok(Some(from_search_doc(doc)))
    }
}

#[async_trait]
impl MetadataEnricher for OpenLibraryEnricher {
    fn descriptor(&self) -> PluginDescriptor {
        PluginDescriptor {
            id: "openlibrary".into(),
            name: "Open Library".into(),
            description: "Enrich a book's metadata from openlibrary.org.".into(),
        }
    }

    async fn enrich(&self, q: &EnrichQuery) -> Result<Option<EnrichedMetadata>> {
        if let Some(isbn) = q.isbn.as_deref() {
            let isbn = isbn.chars().filter(|c| c.is_ascii_digit() || *c == 'X').collect::<String>();
            if isbn.len() >= 10 {
                if let Some(m) = self.lookup_by_isbn(&isbn).await? {
                    return Ok(Some(m));
                }
            }
        }
        if let Some(title) = q.title.as_deref() {
            return self.lookup_by_title(title, &q.authors).await;
        }
        Ok(None)
    }
}

fn from_jscmd_data(v: &Value, isbn: &str) -> EnrichedMetadata {
    EnrichedMetadata {
        source: "openlibrary".into(),
        title: v.get("title").and_then(|x| x.as_str()).map(|s| s.to_string()),
        authors: v
            .get("authors")
            .and_then(|a| a.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|x| x.get("name").and_then(|n| n.as_str()).map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default(),
        description: v.get("notes").and_then(|x| x.as_str()).map(|s| s.to_string()),
        subjects: v
            .get("subjects")
            .and_then(|s| s.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|x| x.get("name").and_then(|n| n.as_str()).map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default(),
        publisher: v
            .get("publishers")
            .and_then(|p| p.as_array())
            .and_then(|a| a.first())
            .and_then(|p| p.get("name").and_then(|n| n.as_str()))
            .map(|s| s.to_string()),
        published: v
            .get("publish_date")
            .and_then(|x| x.as_str())
            .map(|s| s.to_string()),
        language: None,
        cover_url: v
            .get("cover")
            .and_then(|c| c.get("large").or_else(|| c.get("medium")).or_else(|| c.get("small")))
            .and_then(|x| x.as_str())
            .map(|s| s.to_string()),
        identifiers: vec![format!("urn:isbn:{}", isbn)],
    }
}

fn from_search_doc(v: &Value) -> EnrichedMetadata {
    let isbns = v
        .get("isbn")
        .and_then(|x| x.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|x| x.as_str().map(|s| s.to_string()))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let cover_id = v.get("cover_i").and_then(|x| x.as_i64());
    let cover_url = cover_id
        .map(|id| format!("https://covers.openlibrary.org/b/id/{}-L.jpg", id));
    EnrichedMetadata {
        source: "openlibrary".into(),
        title: v.get("title").and_then(|x| x.as_str()).map(|s| s.to_string()),
        authors: v
            .get("author_name")
            .and_then(|a| a.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|x| x.as_str().map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default(),
        description: None,
        subjects: v
            .get("subject")
            .and_then(|s| s.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|x| x.as_str().map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default(),
        publisher: v
            .get("publisher")
            .and_then(|p| p.as_array())
            .and_then(|a| a.first())
            .and_then(|x| x.as_str())
            .map(|s| s.to_string()),
        published: v
            .get("first_publish_year")
            .and_then(|x| x.as_i64())
            .map(|y| y.to_string()),
        language: v
            .get("language")
            .and_then(|l| l.as_array())
            .and_then(|a| a.first())
            .and_then(|x| x.as_str())
            .map(|s| s.to_string()),
        cover_url,
        identifiers: isbns.into_iter().map(|i| format!("urn:isbn:{}", i)).collect(),
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
