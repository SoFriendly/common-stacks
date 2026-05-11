use super::feed::{Acquisition, Entry, Feed, Link};
use anyhow::Result;
use quick_xml::events::Event;
use quick_xml::name::QName;
use quick_xml::Reader;
use url::Url;

pub fn parse(bytes: &[u8], base_url: &str) -> Result<Feed> {
    let base = Url::parse(base_url).ok();
    let mut reader = Reader::from_reader(bytes);
    reader.config_mut().trim_text(true);

    let mut feed = Feed::default();
    let mut depth: i32 = 0;
    let mut entry_depth: Option<i32> = None;
    let mut current_entry: Option<Entry> = None;
    let mut text_buf = String::new();
    let mut capture_text = false;
    // current element path (top of stack inside entry)
    let mut elem_stack: Vec<String> = Vec::new();

    let mut buf = Vec::new();
    loop {
        match reader.read_event_into(&mut buf)? {
            Event::Eof => break,
            Event::Start(e) => {
                depth += 1;
                let name = local_name(e.name());
                let attrs = collect_attrs(&e);
                elem_stack.push(name.clone());

                if entry_depth.is_some() {
                    if let Some(ent) = current_entry.as_mut() {
                        handle_entry_start(ent, &name, &attrs, &base);
                    }
                    capture_text = matches!(
                        name.as_str(),
                        "title"
                            | "id"
                            | "summary"
                            | "content"
                            | "name"
                            | "creator"
                            | "published"
                            | "updated"
                            | "language"
                            | "identifier"
                            | "series"
                    );
                    text_buf.clear();
                } else {
                    match name.as_str() {
                        "entry" => {
                            entry_depth = Some(depth);
                            current_entry = Some(Entry::default());
                        }
                        "title" | "id" | "subtitle" => {
                            capture_text = true;
                            text_buf.clear();
                        }
                        "link" => {
                            handle_feed_link(&mut feed, &attrs, &base);
                        }
                        _ => {}
                    }
                }
            }
            Event::Empty(e) => {
                let name = local_name(e.name());
                let attrs = collect_attrs(&e);
                if entry_depth.is_some() {
                    if let Some(ent) = current_entry.as_mut() {
                        handle_entry_start(ent, &name, &attrs, &base);
                    }
                } else if name == "link" {
                    handle_feed_link(&mut feed, &attrs, &base);
                }
            }
            Event::Text(t) => {
                if capture_text {
                    text_buf.push_str(&t.xml_content().unwrap_or_default());
                }
            }
            Event::CData(t) => {
                if capture_text {
                    text_buf.push_str(&String::from_utf8_lossy(t.as_ref()));
                }
            }
            Event::End(e) => {
                let name = local_name(e.name());
                let in_entry = entry_depth.is_some();

                if in_entry {
                    if let Some(ent) = current_entry.as_mut() {
                        handle_entry_end(ent, &name, &text_buf, &elem_stack);
                    }
                    if Some(depth) == entry_depth && name == "entry" {
                        let mut ent = current_entry.take().unwrap_or_default();
                        // Author fallback: some catalogs (notably Project
                        // Gutenberg) stuff the author into <content type="text">
                        // when no <author> element exists. If the summary is
                        // short, single-line, and doesn't read like prose,
                        // promote it to the author field.
                        if ent.authors.is_empty() {
                            if let Some(s) = ent.summary.as_deref() {
                                let s = s.trim();
                                let looks_like_name = !s.is_empty()
                                    && s.len() <= 100
                                    && !s.contains('\n')
                                    && !matches!(s.chars().last(), Some('.') | Some('!') | Some('?'));
                                if looks_like_name {
                                    ent.authors.push(s.to_string());
                                    ent.summary = None;
                                }
                            }
                        }
                        if ent.acquisitions.is_empty() && !ent.navigation.is_empty() {
                            // navigation-only entry: treat as feed.navigation, but
                            // preserve the entry title (and summary→title fallback)
                            // since OPDS catalogs commonly express subsections as
                            // <entry><title>Category</title><link rel="subsection" ...></entry>.
                            let entry_title = if !ent.title.is_empty() {
                                Some(ent.title.clone())
                            } else {
                                None
                            };
                            for mut nav in ent.navigation.drain(..) {
                                if nav.title.is_none() {
                                    nav.title = entry_title.clone();
                                }
                                feed.navigation.push(nav);
                            }
                        } else {
                            feed.entries.push(ent);
                        }
                        entry_depth = None;
                    }
                } else {
                    match name.as_str() {
                        "title" => feed.title = std::mem::take(&mut text_buf),
                        "id" => feed.id = std::mem::take(&mut text_buf),
                        _ => {}
                    }
                }
                capture_text = false;
                elem_stack.pop();
                depth -= 1;
            }
            _ => {}
        }
        buf.clear();
    }
    Ok(feed)
}

fn local_name(n: QName<'_>) -> String {
    let raw = String::from_utf8_lossy(n.as_ref());
    raw.rsplit_once(':').map(|(_, l)| l.to_string()).unwrap_or_else(|| raw.into_owned())
}

fn collect_attrs(e: &quick_xml::events::BytesStart<'_>) -> Vec<(String, String)> {
    let mut out = Vec::new();
    for a in e.attributes().flatten() {
        let k = local_name(a.key);
        // XML-unescape attribute values (&#34; → ", &amp; → &, etc.).
        let v = a
            .unescape_value()
            .map(|c| c.into_owned())
            .unwrap_or_else(|_| String::from_utf8_lossy(&a.value).into_owned());
        out.push((k, v));
    }
    out
}

fn attr<'a>(attrs: &'a [(String, String)], key: &str) -> Option<&'a str> {
    attrs.iter().find(|(k, _)| k == key).map(|(_, v)| v.as_str())
}

fn resolve(base: &Option<Url>, href: &str) -> String {
    if let Some(b) = base {
        if let Ok(u) = b.join(href) {
            return u.to_string();
        }
    }
    href.to_string()
}

fn handle_feed_link(feed: &mut Feed, attrs: &[(String, String)], base: &Option<Url>) {
    let href = match attr(attrs, "href") {
        Some(h) => resolve(base, h),
        None => return,
    };
    let rel = attr(attrs, "rel").map(|s| s.to_string());
    let mime = attr(attrs, "type").map(|s| s.to_string());
    let title = attr(attrs, "title").map(|s| s.to_string());

    match rel.as_deref() {
        Some("self") => feed.self_link = Some(href),
        Some("next") => feed.next = Some(href),
        Some("previous") | Some("prev") => feed.prev = Some(href),
        Some("search") => {
            // We'll re-resolve the template after fetching the OpenSearch description.
            // For inline OPDS search links with type opensearchdescription, defer; for
            // direct search hrefs containing {searchTerms}, use as-is.
            if href.contains("{searchTerms}") {
                feed.search_template = Some(href);
            } else if mime.as_deref() == Some("application/opensearchdescription+xml") {
                // We mark this; a real-world client would fetch and parse the OSDD.
                feed.search_template = Some(href);
            }
        }
        _ => {
            feed.navigation.push(Link { href, rel, title, mime });
        }
    }
}

fn handle_entry_start(
    ent: &mut Entry,
    name: &str,
    attrs: &[(String, String)],
    base: &Option<Url>,
) {
    if name == "link" {
        let href = match attr(attrs, "href") {
            Some(h) => resolve(base, h),
            None => return,
        };
        let rel = attr(attrs, "rel").map(|s| s.to_string());
        let mime = attr(attrs, "type").map(|s| s.to_string());
        let title = attr(attrs, "title").map(|s| s.to_string());

        let rel_s = rel.as_deref().unwrap_or("");
        if rel_s.starts_with("http://opds-spec.org/acquisition") {
            ent.acquisitions.push(Acquisition {
                href,
                mime,
                rel,
                title,
                size: None,
            });
        } else if rel_s == "http://opds-spec.org/image" {
            ent.cover = Some(href);
        } else if rel_s == "http://opds-spec.org/image/thumbnail"
            || rel_s == "http://opds-spec.org/thumbnail"
        {
            ent.thumbnail = Some(href);
        } else if rel_s == "subsection" || rel_s.is_empty() || rel_s == "alternate" {
            ent.navigation.push(Link { href, rel, title, mime });
        } else {
            ent.navigation.push(Link { href, rel, title, mime });
        }
    } else if name == "category" {
        if let Some(term) = attr(attrs, "term") {
            ent.categories.push(term.to_string());
        } else if let Some(label) = attr(attrs, "label") {
            ent.categories.push(label.to_string());
        }
    }
}

fn handle_entry_end(ent: &mut Entry, name: &str, text: &str, stack: &[String]) {
    let parent = stack.iter().rev().nth(1).map(|s| s.as_str()).unwrap_or("");
    let txt = text.trim();
    if txt.is_empty() {
        return;
    }
    match name {
        "title" if parent == "entry" => ent.title = txt.to_string(),
        "id" if parent == "entry" => ent.id = txt.to_string(),
        "summary" | "content" if parent == "entry" => ent.summary = Some(txt.to_string()),
        "name" if parent == "author" => ent.authors.push(txt.to_string()),
        "creator" if parent == "entry" => ent.authors.push(txt.to_string()),
        "published" if parent == "entry" => ent.published = Some(txt.to_string()),
        "updated" if parent == "entry" => ent.updated = Some(txt.to_string()),
        "language" => ent.language = Some(txt.to_string()),
        "identifier" => ent.identifiers.push(txt.to_string()),
        "series" => ent.series = Some(txt.to_string()),
        _ => {}
    }
}
