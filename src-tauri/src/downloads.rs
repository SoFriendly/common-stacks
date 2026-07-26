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
    /// Loan metadata captured when the file was downloaded from the Libby tab
    /// (see `libby::write_loan_sidecar`). None for ordinary downloads.
    pub loan_title: Option<String>,
    pub loan_author: Option<String>,
    pub loan_cover_data_url: Option<String>,
}

/// Hidden per-folder directory holding loan metadata sidecars
/// (`<stem>.json` + `<stem>.cover`) for files downloaded via the Libby tab.
pub fn loan_meta_dir(dir: &Path) -> PathBuf {
    dir.join(".cs-meta")
}

#[derive(Deserialize)]
struct LoanSidecar {
    title: Option<String>,
    author: Option<String>,
    cover_file: Option<String>,
    cover_mime: Option<String>,
}

fn read_loan_meta(path: &Path) -> (Option<String>, Option<String>, Option<String>) {
    let none = (None, None, None);
    let (Some(dir), Some(stem)) = (path.parent(), path.file_stem()) else {
        return none;
    };
    let meta_dir = loan_meta_dir(dir);
    let json_path = meta_dir.join(format!("{}.json", stem.to_string_lossy()));
    let Ok(bytes) = fs::read(&json_path) else {
        return none;
    };
    let Ok(sidecar) = serde_json::from_slice::<LoanSidecar>(&bytes) else {
        return none;
    };
    let cover = sidecar.cover_file.as_ref().and_then(|name| {
        let bytes = fs::read(meta_dir.join(name)).ok()?;
        use base64::Engine;
        let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
        let mime = sidecar.cover_mime.as_deref().unwrap_or("image/jpeg");
        Some(format!("data:{};base64,{}", mime, b64))
    });
    (sidecar.title, sidecar.author, cover)
}

/// Move or remove the loan sidecars alongside their file. `new_path: None`
/// deletes them.
fn relocate_loan_meta(path: &Path, new_path: Option<&Path>) {
    let (Some(dir), Some(stem)) = (path.parent(), path.file_stem()) else {
        return;
    };
    let meta_dir = loan_meta_dir(dir);
    let stem = stem.to_string_lossy();
    for ext in ["json", "cover"] {
        let old = meta_dir.join(format!("{}.{}", stem, ext));
        if !old.exists() {
            continue;
        }
        match new_path.and_then(|p| p.file_stem()) {
            Some(new_stem) => {
                let new = meta_dir.join(format!("{}.{}", new_stem.to_string_lossy(), ext));
                let _ = fs::rename(&old, &new);
            }
            None => {
                let _ = fs::remove_file(&old);
            }
        }
    }
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
        // Hidden files (.DS_Store, .localized, dotfiles in general) aren't
        // downloads the user made — keep them out of the shelf.
        if entry.file_name().to_string_lossy().starts_with('.') {
            continue;
        }
        let meta = entry.metadata()?;
        let modified_ms = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        let (loan_title, loan_author, loan_cover_data_url) = read_loan_meta(&path);
        out.push(DownloadedFile {
            name: entry.file_name().to_string_lossy().to_string(),
            extension: path.extension().map(|s| s.to_string_lossy().to_string()),
            size: meta.len(),
            modified_ms,
            loan_title,
            loan_author,
            loan_cover_data_url,
            path,
        });
    }
    out.sort_by(|a, b| b.modified_ms.cmp(&a.modified_ms));
    Ok(out)
}

/// Locate an already-downloaded copy of a book, if one exists. Mirrors the
/// naming used by `download_book` (build_filename), so a hit means the exact
/// file a fresh download would have produced is already on disk.
pub async fn find_existing(
    state: &AppState,
    title: &str,
    author: Option<&str>,
    ext: &str,
) -> Result<Option<PathBuf>> {
    let dir = {
        let cfg = state.config.read().await;
        resolved_download_dir(&cfg)
    };
    let path = dir.join(build_filename(title, author, ext));
    if path.is_file() {
        Ok(Some(path))
    } else {
        Ok(None)
    }
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
        "application/vnd.adobe.adept+xml" => Some("acsm"),
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
    relocate_loan_meta(path, None);
    Ok(())
}

pub fn rename(path: &Path, new_name: &str) -> Result<PathBuf> {
    let parent = path.parent().ok_or_else(|| anyhow!("no parent"))?;
    let cleaned = sanitize_filename::sanitize(new_name);
    let target = unique_path(parent, &cleaned);
    fs::rename(path, &target)?;
    relocate_loan_meta(path, Some(&target));
    Ok(target)
}
