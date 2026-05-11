use crate::config::resolved_download_dir;
use crate::epub::EpubMetadata;
use crate::state::AppState;
use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadedFile {
    pub path: PathBuf,
    pub name: String,
    pub size: u64,
    pub modified_ms: u64,
    pub extension: Option<String>,
}

pub async fn list(state: &AppState) -> Result<Vec<DownloadedFile>> {
    let dir = {
        let cfg = state.config.read().await;
        resolved_download_dir(&cfg)
    };
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    for entry in fs::read_dir(&dir)? {
        let entry = entry?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let meta = entry.metadata()?;
        let modified_ms = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        out.push(DownloadedFile {
            name: entry.file_name().to_string_lossy().to_string(),
            extension: path.extension().map(|s| s.to_string_lossy().to_string()),
            size: meta.len(),
            modified_ms,
            path,
        });
    }
    out.sort_by(|a, b| b.modified_ms.cmp(&a.modified_ms));
    Ok(out)
}

pub fn build_filename(title: &str, author: Option<&str>, ext: &str) -> String {
    let base = match author {
        Some(a) if !a.is_empty() => format!("{} - {}", title, a),
        _ => title.to_string(),
    };
    let cleaned = sanitize_filename::sanitize(&base);
    let ext = ext.trim_start_matches('.');
    if ext.is_empty() {
        cleaned
    } else {
        format!("{}.{}", cleaned, ext)
    }
}

pub fn unique_path(dir: &Path, filename: &str) -> PathBuf {
    let path = dir.join(filename);
    if !path.exists() {
        return path;
    }
    let (stem, ext) = split_filename(filename);
    let mut n = 1;
    loop {
        let candidate = if ext.is_empty() {
            format!("{} ({})", stem, n)
        } else {
            format!("{} ({}).{}", stem, n, ext)
        };
        let candidate_path = dir.join(&candidate);
        if !candidate_path.exists() {
            return candidate_path;
        }
        n += 1;
    }
}

fn split_filename(name: &str) -> (String, String) {
    match name.rfind('.') {
        Some(i) if i > 0 => (name[..i].to_string(), name[i + 1..].to_string()),
        _ => (name.to_string(), String::new()),
    }
}

pub fn ext_from_mime(mime: &str) -> Option<&'static str> {
    match mime.split(';').next().unwrap_or("").trim() {
        "application/epub+zip" => Some("epub"),
        "application/pdf" => Some("pdf"),
        "application/x-mobipocket-ebook" => Some("mobi"),
        "application/vnd.amazon.ebook" => Some("azw3"),
        "application/x-cbz" | "application/vnd.comicbook+zip" => Some("cbz"),
        "application/x-cbr" | "application/vnd.comicbook-rar" => Some("cbr"),
        "application/zip" => Some("zip"),
        "text/plain" => Some("txt"),
        _ => None,
    }
}

pub fn write_file(dir: &Path, filename: &str, bytes: &[u8]) -> Result<PathBuf> {
    fs::create_dir_all(dir)?;
    let path = unique_path(dir, filename);
    fs::write(&path, bytes)?;
    Ok(path)
}

pub fn maybe_inspect_epub(path: &Path) -> Option<EpubMetadata> {
    if path.extension().and_then(|s| s.to_str()).map(|s| s.eq_ignore_ascii_case("epub"))
        != Some(true)
    {
        return None;
    }
    crate::epub::inspect_path(path).ok()
}

pub fn delete(path: &Path) -> Result<()> {
    if !path.exists() {
        return Err(anyhow!("file does not exist"));
    }
    fs::remove_file(path)?;
    Ok(())
}

pub fn rename(path: &Path, new_name: &str) -> Result<PathBuf> {
    let parent = path.parent().ok_or_else(|| anyhow!("no parent"))?;
    let cleaned = sanitize_filename::sanitize(new_name);
    let target = unique_path(parent, &cleaned);
    fs::rename(path, &target)?;
    Ok(target)
}
