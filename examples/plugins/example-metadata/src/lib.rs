//! Example CommonStacks metadata enricher plugin.
//!
//! This plugin demonstrates the v1 C-ABI surface. It doesn't talk to any real
//! service — it just echoes the query back with a fake description so you can
//! see the plugin loaded and called.
//!
//! Build for release with:
//!     cargo build --release
//! then copy `target/release/libexample_metadata.{dylib,so,dll}` plus this
//! crate's `manifest.json` into:
//!     macOS:  ~/Library/Application Support/CommonStacks/plugins/<your-id>/
//!     Linux:  ~/.config/CommonStacks/plugins/<your-id>/
//!     Win:    %APPDATA%/CommonStacks/plugins/<your-id>/
//! Restart CommonStacks.

use serde::{Deserialize, Serialize};
use std::os::raw::c_int;

// ---- Protocol types (mirror the host's `EnrichQuery` / `EnrichedMetadata` ----

#[derive(Deserialize)]
struct EnrichQuery {
    #[serde(default)]
    isbn: Option<String>,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    authors: Vec<String>,
}

#[derive(Serialize)]
struct EnrichedMetadata {
    source: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    title: Option<String>,
    authors: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    description: Option<String>,
    subjects: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    publisher: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    published: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    language: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    cover_url: Option<String>,
    identifiers: Vec<String>,
}

// ---- Required ABI surface ---------------------------------------------------

/// Must return the same value as the host's `PLUGIN_ABI_VERSION`.
#[no_mangle]
pub extern "C" fn commonstacks_plugin_api_version() -> u32 {
    1
}

/// Free a buffer previously returned from this plugin. The host calls this
/// after copying the bytes; the plugin owns the allocation.
#[no_mangle]
pub unsafe extern "C" fn commonstacks_plugin_free(ptr: *mut u8, len: usize) {
    if ptr.is_null() || len == 0 {
        return;
    }
    // Reconstruct the Vec<u8> and let it drop normally.
    drop(Vec::from_raw_parts(ptr, len, len));
}

/// Enrich a book.
/// Return value:
///   0  = success, `out_ptr`/`out_len` point at a UTF-8 JSON `EnrichedMetadata`
///   1  = no result for this query (out left empty)
///  -1  = error, `out_ptr`/`out_len` point at a UTF-8 error message
///
/// The host transfers ownership of the returned buffer back to the plugin
/// via `commonstacks_plugin_free`.
#[no_mangle]
pub unsafe extern "C" fn commonstacks_plugin_enrich(
    input_ptr: *const u8,
    input_len: usize,
    out_ptr: *mut *mut u8,
    out_len: *mut usize,
) -> c_int {
    if input_ptr.is_null() {
        return write_err(out_ptr, out_len, "null input");
    }
    let input = std::slice::from_raw_parts(input_ptr, input_len);
    let query: EnrichQuery = match serde_json::from_slice(input) {
        Ok(q) => q,
        Err(e) => return write_err(out_ptr, out_len, &format!("bad query json: {}", e)),
    };

    // Example logic: if we have a title, fabricate a description.
    let Some(title) = query.title else {
        // Signal "no result".
        *out_ptr = std::ptr::null_mut();
        *out_len = 0;
        return 1;
    };

    let meta = EnrichedMetadata {
        source: "example-metadata".to_string(),
        title: Some(title.clone()),
        authors: query.authors.clone(),
        description: Some(format!("A book titled \"{}\".", title)),
        subjects: vec!["Example".to_string()],
        publisher: None,
        published: None,
        language: None,
        cover_url: None,
        identifiers: query.isbn.map(|i| vec![format!("urn:isbn:{}", i)]).unwrap_or_default(),
    };

    match serde_json::to_vec(&meta) {
        Ok(bytes) => write_ok(out_ptr, out_len, bytes),
        Err(e) => write_err(out_ptr, out_len, &format!("serialize failed: {}", e)),
    }
}

// ---- Helpers ----------------------------------------------------------------

unsafe fn write_ok(out_ptr: *mut *mut u8, out_len: *mut usize, bytes: Vec<u8>) -> c_int {
    let len = bytes.len();
    let mut boxed = bytes.into_boxed_slice();
    let ptr = boxed.as_mut_ptr();
    std::mem::forget(boxed);
    *out_ptr = ptr;
    *out_len = len;
    0
}

unsafe fn write_err(out_ptr: *mut *mut u8, out_len: *mut usize, msg: &str) -> c_int {
    let bytes = msg.as_bytes().to_vec();
    let len = bytes.len();
    let mut boxed = bytes.into_boxed_slice();
    let ptr = boxed.as_mut_ptr();
    std::mem::forget(boxed);
    *out_ptr = ptr;
    *out_len = len;
    -1
}
