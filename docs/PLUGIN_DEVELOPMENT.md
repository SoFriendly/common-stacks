# CommonStacks Plugin Development Guide

CommonStacks is extensible. Built-in plugins ship with the binary; user plugins
are native dynamic libraries dropped into a per-user plugins directory and
loaded at startup.

This guide covers the **v1 plugin ABI**. The protocol is intentionally small,
language-agnostic, and stable across Rust toolchain versions — plugins exchange
UTF-8 JSON across a C-ABI surface, never Rust trait objects.

## Plugin categories

| Category | Trait | Available in v1 |
| --- | --- | --- |
| **Metadata enricher** | augments a book's metadata (title/author/description/cover/subjects/etc.) | ✅ |
| **Send-to target** | delivers downloaded files (Kindle, WebDAV, Crosspoint Reader, …) | reserved |
| **Transformer** | byte-level file transform run before sending (e.g. EPUB image optimizer) | reserved |

This guide focuses on **metadata enrichers**. Send-to and Transformer support
will follow once the metadata path has shaken out; the protocol is designed to
extend without breaking v1 plugins.

---

## Anatomy of a plugin

A plugin is a folder placed inside the CommonStacks plugins directory:

```
<plugins-dir>/
└── my-plugin/
    ├── manifest.json
    └── libmy_plugin.dylib   (or .so on Linux, .dll on Windows)
```

CommonStacks discovers each subfolder, reads its `manifest.json`, dynamically
loads the named library, calls a small set of exported C functions, and
registers the plugin with the appropriate registry.

### Plugins directory

| Platform | Path |
| --- | --- |
| macOS | `~/Library/Application Support/CommonStacks/plugins/` |
| Linux | `~/.config/CommonStacks/plugins/` |
| Windows | `%APPDATA%\CommonStacks\plugins\` |

Open it from inside the app via **Settings → Plugins → Open plugins folder**.

---

## Manifest

`manifest.json` describes the plugin and points at its library file.

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "description": "Looks up books on…",
  "version": "0.1.0",
  "api_version": 1,
  "library": "libmy_plugin.dylib",
  "capabilities": ["metadata"]
}
```

| Field | Required | Notes |
| --- | --- | --- |
| `id` | yes | Globally-unique identifier. Reverse-DNS or kebab-case. Must not collide with built-in plugin ids (`openlibrary`, `crosspoint`, `kindle-email`, `webdav`, `epub-image-optimizer`). |
| `name` | yes | Display name shown in the UI. |
| `description` | no | One-line description shown under the name. |
| `version` | yes | Plugin version, free-form (SemVer recommended). |
| `api_version` | yes | Must equal the host's `PLUGIN_ABI_VERSION` (currently `1`). |
| `library` | yes | Library filename, relative to the plugin folder. Adjust per platform. |
| `capabilities` | yes | Subset of `["metadata", "send", "transformer"]`. Only `"metadata"` is wired up in v1. |

---

## The v1 ABI

Plugins export three C functions. All values are passed by raw pointers and
explicit lengths — there are no Rust types crossing the boundary.

### Common rules

- **All input/output bodies are UTF-8 JSON.**
- **Plugin allocates outputs.** When the host needs to free a buffer it got
  from the plugin, it calls back into `commonstacks_plugin_free`. Plugins
  must never free pointers handed to them by the host.
- **Reentrancy.** The host may call the plugin concurrently from multiple
  threads. Plugin functions must be thread-safe. If you keep state, guard it
  with a `Mutex`/`RwLock`.
- **No panics across the boundary.** Catch `panic` inside your plugin and
  return an error string instead — a panic unwinding into Rust host code is
  undefined behavior.

### Required exports

```c
// Returns the ABI version this plugin was built against.
// MUST equal the host's PLUGIN_ABI_VERSION (currently 1).
uint32_t commonstacks_plugin_api_version(void);

// Free a buffer previously returned by this plugin.
// `ptr` and `len` are exactly what the plugin wrote into *out_ptr / *out_len.
void commonstacks_plugin_free(uint8_t* ptr, size_t len);

// Enrich a book. The input is a JSON `EnrichQuery`.
// On return:
//    0   ->  success: *out_ptr/*out_len hold a JSON `EnrichedMetadata`.
//    1   ->  no result for this query: *out_ptr=NULL, *out_len=0.
//   -1   ->  error: *out_ptr/*out_len hold a UTF-8 error message.
int32_t commonstacks_plugin_enrich(
    const uint8_t* input_ptr,
    size_t          input_len,
    uint8_t**       out_ptr,
    size_t*         out_len
);
```

### JSON shapes

`EnrichQuery`:

```jsonc
{
  "isbn":   "9780861402038",   // optional, ISBN-13 (digits only)
  "title":  "The Light Fantastic",
  "authors": ["Terry Pratchett"]
}
```

`EnrichedMetadata` (omit fields you don't have; only `source` is required):

```jsonc
{
  "source":      "my-plugin",                  // required, must match manifest.id
  "title":       "The Light Fantastic",
  "authors":     ["Terry Pratchett"],
  "description": "Two-time best-seller…",
  "subjects":    ["Fantasy", "Humor"],
  "publisher":   "Colin Smythe",
  "published":   "1986",
  "language":    "en",
  "cover_url":   "https://example.com/cover.jpg",
  "identifiers": ["urn:isbn:9780861402038"]
}
```

### Merge policy

CommonStacks merges enriched data on top of the OPDS source data with **OPDS
fields winning**. A plugin will only fill in gaps — it can't overwrite a cover
or summary the source already provided. The host applies the result *after*
fetching from OPDS, so plugins don't need to know anything about how books
arrive.

---

## Worked example (Rust)

A complete, buildable plugin lives in `examples/plugins/example-metadata/`.
Highlights:

```rust
// Cargo.toml
// [lib]
// crate-type = ["cdylib"]

#[no_mangle]
pub extern "C" fn commonstacks_plugin_api_version() -> u32 { 1 }

#[no_mangle]
pub unsafe extern "C" fn commonstacks_plugin_free(ptr: *mut u8, len: usize) {
    if ptr.is_null() || len == 0 { return; }
    drop(Vec::from_raw_parts(ptr, len, len));
}

#[no_mangle]
pub unsafe extern "C" fn commonstacks_plugin_enrich(
    input_ptr: *const u8,
    input_len: usize,
    out_ptr:   *mut *mut u8,
    out_len:   *mut usize,
) -> i32 {
    let input = std::slice::from_raw_parts(input_ptr, input_len);
    let query: serde_json::Value = match serde_json::from_slice(input) {
        Ok(v) => v,
        Err(_) => return -1,
    };
    let title = match query.get("title").and_then(|v| v.as_str()) {
        Some(t) => t.to_string(),
        None    => { *out_ptr = std::ptr::null_mut(); *out_len = 0; return 1; }
    };
    let meta = serde_json::json!({
        "source": "my-plugin",
        "title":  title,
        "authors": [],
        "subjects": [],
        "identifiers": [],
    });
    let bytes = serde_json::to_vec(&meta).unwrap();
    let len = bytes.len();
    let mut boxed = bytes.into_boxed_slice();
    let ptr = boxed.as_mut_ptr();
    std::mem::forget(boxed);
    *out_ptr = ptr;
    *out_len = len;
    0
}
```

Build:

```bash
cargo build --release
```

Install: copy the produced library + `manifest.json` into a new subfolder of
your plugins directory, then restart CommonStacks.

---

## Worked example (C / C++ / Go / Zig / …)

The protocol uses nothing Rust-specific. As long as your language can:

1. Export C functions with the exact symbols and signatures above,
2. Read/write JSON,
3. Allocate a buffer the caller will later free via your `commonstacks_plugin_free`,

it works. Go, C, C++, and Zig have all been demonstrated externally. We
recommend Rust because the host shares the same JSON shape definitions, but
nothing in the protocol depends on it.

---

## Versioning

The host's `PLUGIN_ABI_VERSION` constant is bumped only when the protocol
changes in a backwards-incompatible way. Adding new optional JSON fields,
new categories, or new exported symbols is **not** breaking — old plugins
will keep loading. The host checks `api_version` in your manifest **and** the
value returned by your `commonstacks_plugin_api_version` symbol against its
own constant; mismatches log a warning and skip the plugin.

When you bump your plugin's logic but the ABI is unchanged, only bump
`manifest.version`. Leave `api_version` at the host value you targeted.

---

## Debugging

Plugin load errors are logged to the CommonStacks log:

```bash
RUST_LOG=common_stacks_lib=info bun run tauri dev
```

Look for lines like:

```
loaded user metadata enricher plugin: my-plugin
skipping plugin /…/my-plugin: incompatible plugin API version 2 (host supports 1)
```

If your plugin loads but seems inactive, open a book in the app — auto-
enrichment fires on book-page open. The footer of the book page reads
"Enriched via …" when a plugin's data was applied.

---

## Roadmap

- **v2**: Send-to and Transformer plugin categories.
- **Sandboxed plugins** via WebAssembly Components, alongside the current
  native ABI.
- **Plugin manifests advertise settings**: same schema model the built-in
  Crosspoint/Kindle/etc. plugins already use, exposed to user plugins so they
  can collect API keys and preferences.
- **Hot reload**: drop a new library in the folder and refresh without
  restarting the app.

If your use case isn't covered, open an issue describing what you'd need from
the protocol and we'll fold it in.
