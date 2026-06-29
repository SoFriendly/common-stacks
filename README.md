# Common Stacks

A local-first desktop app for browsing and downloading books from OPDS
libraries. Think Kindle Store / Apple Books for your federated catalogs —
not a Calibre clone, not a reader, not a metadata editor. Just discovery,
download, and (optionally) send-to-device.

Built with **Tauri 2 + Rust** on the backend and **React + Tailwind 4** on
the frontend.

---

## Features

- **Browse multiple OPDS libraries** as a unified, storefront-style home.
  Each source becomes its own section with horizontal rails fanned out from
  the catalog's navigation.
- **OPDS 1 (Atom) and OPDS 2 (JSON)** parsers, with HTTP Basic / Bearer /
  Cookie authentication.
- **Federated search** across every enabled library, with results
  de-duplicated by ISBN-13.
- **Auto metadata enrichment** from [Open Library] — fills in covers,
  descriptions, subjects, language, and publisher when the OPDS source
  doesn't supply them. Cached locally so the enrichment persists across
  sessions and decorates the library home too, not just the book detail.
- **Downloads** to `~/Books/Common Stacks/` with `Title - Author.ext`
  naming and collision handling. The Downloads view reads from disk
  directly, displays real EPUB covers/titles/authors extracted from each
  file, and offers a hover/right-click menu to reveal, rename, delete, or
  send a book.
- **Send-to-device targets** as plugins:
  - **Crosspoint Reader** — reverse-engineered HTTP upload over mDNS, with
    an optional EPUB image optimizer that recompresses inline images as
    JPEG before upload. Live per-image progress in the send modal.
  - **Send to Kindle (email)** via SMTP.
  - **WebDAV** (Nextcloud, ownCloud, KOReader, anything that speaks PUT).
- **EPUB image optimizer** transformer plugin (used by Crosspoint, available
  to any future send target).
- **Local stale-while-revalidate cache** so tabbing back into the Library
  is instant.

[Open Library]: https://openlibrary.org/

## Default libraries

Common Stacks ships pre-configured with three OPDS sources:

| Source | Notes |
| --- | --- |
| **Mayberry** (<https://mayberry.pub>) | Public; no auth required. |
| **Project Gutenberg** (<https://m.gutenberg.org/ebooks.opds/>) | Public; no auth required. |
| **Standard Ebooks** (<https://standardebooks.org/feeds/opds/all>) | Shipped *disabled*. Enable in Settings → Libraries and add HTTP Basic auth (your Patrons Circle email as username, blank password). |

You can add your own from Settings → Add a library.

---

## Running locally

```bash
# one-time
bun install

# develop (auto-rebuilds Rust on change, HMRs the React side)
bun run tauri dev

# build a release bundle
bun run tauri build
```

Prereqs: Rust toolchain, Bun (or Node + npm), and the platform Tauri
requirements (Xcode CLT on macOS, etc.).

## Releases

Android updates are released independently from the desktop Tauri updater.
Use the Android release script instead of manually editing versions, building,
uploading, or installing the APK:

```bash
# bump patch version, build signed arm64 APK, upload to R2, update latest.json,
# commit, and push the release metadata
bun run release:android

# or choose the bump explicitly
bun run release:android -- minor
bun run release:android -- 0.1.10
```

The script updates the tracked app versions, writes Android's generated
`tauri.android.versionName` and `tauri.android.versionCode`, builds
`app-arm64-release.apk`, uploads it to Cloudflare R2, and updates
`latest.json` at `platforms["android-arm64"]`. It does not install the APK to a
device and does not create a git tag, so it can be used to test Android updates
without publishing a desktop update.

Desktop releases still use the Tauri updater flow:

```bash
bun run release:macos -- patch
```

### Tip: app file locations

| | macOS | Linux | Windows |
| --- | --- | --- | --- |
| Config + plugins | `~/Library/Application Support/Common Stacks/` | `~/.config/Common Stacks/` | `%APPDATA%\Common Stacks\` |
| Downloads (default) | `~/Books/Common Stacks/` | `~/Books/Common Stacks/` | `%USERPROFILE%\Books\Common Stacks\` |

---

## Plugin system

Common Stacks is extensible by dropping a folder into the plugins directory.
Plugins are **regular executables or scripts** (Python, Node, Go, Bash,
anything with stdin/stdout) — no compile step, no FFI, no ABI fragility.

Three plugin categories:

- **Metadata enricher** — augments a book's metadata.
- **Send-to target** — delivers a downloaded file somewhere.
- **Transformer** — byte-level transform run before sending.

See [`docs/PLUGIN_DEVELOPMENT.md`](docs/PLUGIN_DEVELOPMENT.md) for the full
protocol, and [`examples/plugins/example-metadata/`](examples/plugins/example-metadata)
for a complete Python plugin you can drop in to verify the loader.

---

## Architecture

```
common-stacks/
├── src/                   ← React + Tailwind UI
│   ├── routes/            ← Library, Browse, Book, Downloads, Settings
│   ├── components/        ← CoverCard, DefaultCover, SendProgressModal, …
│   └── lib/               ← Typed Tauri command surface, caches
├── src-tauri/
│   ├── src/
│   │   ├── opds/          ← OPDS 1 + 2 parsers, OpenSearch resolver, auth
│   │   ├── dedup.rs       ← ISBN-13 dedup, title/author fallback
│   │   ├── epub.rs        ← EPUB metadata + cover extraction
│   │   ├── plugins/       ← Plugin SDK + built-ins + subprocess loader
│   │   │   ├── metadata/  ← Open Library enricher
│   │   │   ├── send/      ← Crosspoint, Kindle email, WebDAV
│   │   │   └── transform/ ← EPUB image optimizer
│   │   ├── commands.rs    ← Tauri command handlers
│   │   └── state.rs       ← Shared app state
│   └── tauri.conf.json
├── docs/
│   ├── PRD.md             ← Product requirements / scope
│   └── PLUGIN_DEVELOPMENT.md
└── examples/plugins/
    └── example-metadata/  ← Drop-in Python plugin demo
```

---

## What Common Stacks is NOT

Some things Common Stacks intentionally **isn't** trying to be:

- An ebook reader (no in-app reading).
- A metadata management system (we enrich; we don't let you edit fields).
- A personal library organizer (no collections, no tagging).
- A Calibre clone or device driver framework.
- A DRM removal or conversion tool.
- A reading-progress tracker or note/highlight system.

Discovery → download → optional send. That's it.

---

## License

See [LICENSE](LICENSE).
