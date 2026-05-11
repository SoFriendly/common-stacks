use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Feed {
    pub title: String,
    pub id: String,
    pub entries: Vec<Entry>,
    /// Navigation links (subsections) that are themselves feeds.
    pub navigation: Vec<Link>,
    pub next: Option<String>,
    pub prev: Option<String>,
    pub self_link: Option<String>,
    pub search_template: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Entry {
    pub id: String,
    pub title: String,
    pub authors: Vec<String>,
    pub summary: Option<String>,
    pub published: Option<String>,
    pub updated: Option<String>,
    pub language: Option<String>,
    pub identifiers: Vec<String>,
    pub categories: Vec<String>,
    pub series: Option<String>,
    /// Cover/thumbnail URLs, absolute.
    pub cover: Option<String>,
    pub thumbnail: Option<String>,
    /// Acquisition links (downloadable formats).
    pub acquisitions: Vec<Acquisition>,
    /// Sub-feed navigation links (e.g., grouped subsection entries).
    pub navigation: Vec<Link>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Acquisition {
    pub href: String,
    pub mime: Option<String>,
    pub rel: Option<String>,
    pub title: Option<String>,
    pub size: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Link {
    pub href: String,
    pub rel: Option<String>,
    pub title: Option<String>,
    pub mime: Option<String>,
}
