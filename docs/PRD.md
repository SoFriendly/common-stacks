# CommonStacks PRD

## Overview

CommonStacks is a local-first desktop application for browsing and downloading books from multiple OPDS libraries through a unified storefront-style interface.

The application is intentionally focused on:

- discovery
- browsing
- downloading
- lightweight library aggregation

CommonStacks is not an ebook reader, ebook manager, metadata editor, or Calibre replacement.

The experience should feel closer to:

- Kindle Store
- Apple Books
- Plex/Jellyfin browsing

than:

- librarian software
- database management tools
- ebook archival systems

---

## Core Product Philosophy

### What CommonStacks IS

- A browser for OPDS libraries
- A unified discovery interface for books
- A lightweight download utility
- A local-first desktop app
- A storefront-style browsing experience

### What CommonStacks IS NOT

The app must explicitly avoid becoming:

- an ebook reader
- a metadata management system
- a personal library organizer
- a syncing platform
- a Calibre clone
- a DRM removal tool
- a conversion utility
- a reading tracker
- a note/highlight system

---

## Supported Platforms

### Desktop Platforms

- macOS Universal Build
  - Apple Silicon
  - Intel
- Windows
- Linux

### Framework Stack

**Backend**

- Rust
- Tauri v2
- Tokio async runtime

**Frontend**

- React
- TailwindCSS
- shadcn/ui

---

## OPDS Support

### Supported Standards

- OPDS 1
- OPDS 2

### Authentication Support

Support any authentication mechanisms commonly supported by OPDS servers, including:

- Basic Auth
- Bearer Token
- Session/Cookie Auth
- Other standards-compatible methods where feasible

Authentication should be handled per-library.

---

## Included Default Libraries

The app should ship with:

- https://mayberry.pub
- Project Gutenberg OPDS source

Users can:

- disable
- remove
- edit
- reorder

default sources.

---

## Library Model

### Unified Browsing

By default, all configured libraries are merged into a unified browsing experience.

Users should still be able to:

- browse individual libraries
- filter by source
- search specific libraries

---

## Deduplication

### Goal

Books appearing across multiple OPDS libraries should merge into a single logical entry.

### Deduplication Priority

Use:

1. ISBN
2. EPUB metadata normalization
3. Title normalization
4. Author normalization

Reference implementation logic and metadata handling patterns from:

`/Users/jmitch/GitHub/Mayberry`

### Merged Book Behavior

Merged books should display:

- one primary cover
- one primary metadata block
- "Available from X libraries"
- alternate source list
- alternate format list

---

## Browsing Experience

### Visual Direction

The UI should feel:

- beautiful
- immersive
- cover-focused
- storefront-like

Primary inspiration:

- Kindle Store
- Apple Books

NOT:

- Calibre
- librarian tools
- enterprise dashboards

---

## Navigation Structure

### Sidebar Navigation

- Library
- Search
- Downloads
- Settings

---

## Home / Library UI

### Layout Style

Hybrid browsing model:

**Home**

- Kindle-style horizontal rails
- Large covers
- Discovery-focused

**Search / Categories**

- Responsive grid layouts

---

## Discovery Rails

Examples:

- Recently Added
- Popular
- Science Fiction
- Fantasy
- Public Domain
- Recently Updated
- By Source
- By Author
- By Series

---

## Metadata Interaction

The following should be clickable browse surfaces:

- Authors
- Series
- Categories
- Tags

Clicking one should transition into a filtered browse view.

---

## Search

### Search Model

Hybrid search model:

- local cached search
- live federated OPDS search

### Behavior

When searching:

- queries execute against active OPDS sources
- results stream progressively per-library
- results merge into unified display

The app should never require full library syncing before search works.

---

## Caching Strategy

### Philosophy

The app is cache-based, not sync-based.

CommonStacks should:

- fetch on demand
- cache lightly
- avoid persistent mirroring

### Cache Model

Use stale-while-revalidate behavior:

- instantly display cached content
- refresh in background
- progressively update UI

### Cover Caching

Use lightweight local caching for:

- covers
- thumbnails

Aggressive permanent asset mirroring is unnecessary.

---

## Download System

### Scope

Downloads are core functionality.

"Send to device" is deferred to a later phase.

---

## Download Folder

### Default Location

`~/Books/CommonStacks/`

Users may configure a custom folder.

---

## Download Flow

### If Multiple Formats Exist

User selects preferred format at download time.

Examples:

- EPUB
- PDF
- MOBI
- AZW3
- CBZ
- CBR
- Any OPDS-supported format

---

## File Naming

### Naming Convention

`Title - Author.ext`

Requirements:

- sanitize invalid filesystem characters
- automatic collision handling
- preserve extension

Example:

```
Dune - Frank Herbert.epub
Dune - Frank Herbert (1).epub
```

---

## EPUB Metadata Inspection

After download:

- lightly inspect EPUB metadata
- normalize identifiers
- improve deduplication consistency

This is NOT intended to become a metadata editor.

---

## Downloads Screen

### Purpose

Downloads act as a lightweight history view.

The Downloads screen should:

- read directly from configured download directory
- reflect real filesystem state

### Supported Actions

- Open file
- Reveal in Finder/Explorer
- Rename
- Delete

### Views

**Default**

Compact cover grid

**Optional**

List/table toggle

---

## Source Management

### Add Source Flow

Adding a source should:

1. Validate URL immediately
2. Detect OPDS compatibility
3. Prompt for auth if required
4. Save only if valid

---

## Library Status

Libraries should remain visible even when offline.

Offline libraries should show:

- degraded status
- connection issue indicator

They should not disappear from the UI.

---

## Import / Export

### Export Format

JSON

Used for:

- migration
- backup
- sharing source lists

Export should include:

- source URLs
- auth configuration where appropriate
- user preferences

---

## Performance Expectations

The UI should:

- feel instant
- progressively load
- stream covers incrementally
- avoid blocking states

Large libraries should remain usable without full indexing.

---

## Non-Goals

The following are explicitly out of scope:

**Reading**

- EPUB reading
- PDF reading
- annotations
- highlights

**Library Management**

- collections
- tagging
- metadata editing
- duplicate cleanup workflows
- large personal library management

**Conversion**

- EPUB conversion
- MOBI conversion
- format pipelines

**Syncing**

- cloud accounts
- cloud sync
- reading progress sync

**DRM**

- DRM removal
- DRM bypass systems

---

## Future Phase Ideas (NOT v1)

Potential later additions:

- Send-to-device system
- Calibre device plugin compatibility
- Kindle email delivery
- WebDAV targets
- SMB/network destinations
- KOReader integration
- Syncthing export helpers
- OPDS publishing
- Shared library discovery

These are intentionally excluded from the initial release scope.

---

## Design Keywords

The UI should feel:

- calm
- modern
- literary
- discovery-oriented
- tactile
- shelf-like
- inviting

Avoid:

- enterprise UI
- dense tables
- filesystem-manager aesthetics
- "power user" clutter

The experience should feel like:

> wandering interconnected digital library stacks.
