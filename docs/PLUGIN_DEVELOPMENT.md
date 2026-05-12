# CommonStacks Plugin Development Guide

CommonStacks is extensible. Built-in plugins ship with the app; user plugins
are **regular executables or scripts** dropped into a per-user plugins
directory and discovered at startup.

This guide covers the **v1 plugin protocol**. The protocol is intentionally
small and language-agnostic: plugins are subprocesses, the host sends a
command and (usually) a JSON payload on stdin, the plugin writes a response
to stdout. No FFI, no shared types, no ABI versioning hell. If your tool can
read stdin and write stdout, it can be a plugin — Python, Node, Go, Rust,
Bash, anything.

## Plugin categories

| Category | What it does | Available |
| --- | --- | --- |
| **Metadata enricher** | Augments a book's metadata (title/author/description/cover/subjects/etc.) | ✅ |
| **Send-to target** | Delivers a downloaded file to a destination (a device, a server, a cloud) | ✅ |
| **Transformer** | Byte-level file transform run before sending (e.g. EPUB image optimizer) | ✅ |

You can implement any subset; declare which in your `manifest.json`.

---

## Anatomy of a plugin

A plugin is a folder placed inside the CommonStacks plugins directory:

```
<plugins-dir>/
└── my-plugin/
    ├── manifest.json
    └── plugin.py        (or plugin, plugin.exe, plugin.js, …)
```

CommonStacks discovers each subfolder, reads its `manifest.json`, runs the
named executable for every call, and registers the plugin with the
appropriate registry.

### Plugins directory

| Platform | Path |
| --- | --- |
| macOS | `~/Library/Application Support/CommonStacks/plugins/` |
| Linux | `~/.config/CommonStacks/plugins/` |
| Windows | `%APPDATA%\CommonStacks\plugins\` |

Open it from inside the app via **Settings → Plugins → Open plugins folder**.

---

## Manifest

`manifest.json` describes the plugin and points at the executable.

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "description": "Looks up books on…",
  "version": "0.1.0",
  "api_version": 1,
  "executable": "plugin.py",
  "capabilities": ["metadata"]
}
```

| Field | Required | Notes |
| --- | --- | --- |
| `id` | yes | Globally-unique identifier. Reverse-DNS or kebab-case. Avoid colliding with built-in ids (`openlibrary`, `crosspoint`, `kindle-email`, `webdav`, `epub-image-optimizer`). |
| `name` | yes | Display name shown in the UI. |
| `description` | no | One-line description shown under the name. |
| `version` | yes | Plugin version (SemVer recommended). |
| `api_version` | yes | Must equal the host's `PLUGIN_ABI_VERSION` (currently `1`). |
| `executable` | yes | Relative path to the executable. Must have execute permission on macOS/Linux. On Windows, use `plugin.exe` or similar. Scripts with a shebang line (`#!/usr/bin/env python3`) work directly. |
| `capabilities` | yes | Any subset of `["metadata", "send", "transformer"]`. |

---

## The v1 subprocess protocol

For every operation, CommonStacks invokes:

```bash
./<executable> <command> [args...]
```

with an optional JSON payload on **stdin**, and reads the response from
**stdout**. Stderr is captured and surfaced to the user on errors.

Exit codes:

| Code | Meaning |
| --- | --- |
| `0` | Success — stdout holds the response. |
| `1` | No result — only meaningful for `enrich`. |
| anything else | Error — stderr holds a human-readable message. |

### Common rules

- **All JSON is UTF-8.**
- **Each command is a fresh process.** You can't keep in-process state. If
  you need to cache, write to a file inside your plugin folder (or anywhere
  on disk) and re-read it on each call. CommonStacks may invoke your plugin
  many times in quick succession — keep startup fast.
- **The host can run multiple plugin invocations in parallel.** If your
  caching writes to disk, guard against concurrent writes.
- **Stderr is for diagnostics.** Anything you write to stderr will be shown
  in the CommonStacks log; on errors it's surfaced in the UI.

### Commands

#### `enrich` *(metadata enrichers)*

- **stdin**: `EnrichQuery` JSON.
- **stdout**: `EnrichedMetadata` JSON on success.
- **exit 0**: success.
- **exit 1**: no result for this query.

```jsonc
// EnrichQuery (input)
{
  "isbn":    "9780861402038",
  "title":   "The Light Fantastic",
  "authors": ["Terry Pratchett"]
}

// EnrichedMetadata (output — omit fields you don't have; only `source` is required)
{
  "source":      "my-plugin",
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

#### `send` *(send-to targets)*

- **stdin**: `{ request: SendRequest, settings: { key: value } }` JSON.
- **stdout**: `SendResult` JSON.

```jsonc
// SendRequest (part of the input)
{
  "target_id": "my-plugin",
  "file_path": "/Users/me/Books/CommonStacks/Foo.epub",
  "title":     "Foo",
  "author":    "Jane Doe"
}

// SendResult (output)
{
  "ok":      true,
  "message": "uploaded to https://my-server/Foo.epub"
}
```

#### `transform` *(transformers)*

Transformers exchange raw bytes via files (no need to worry about binary
framing on stdin/stdout).

- **stdin**:
  ```json
  {
    "settings":    { "key": "value", ... },
    "input_path":  "/tmp/cs-plugin-12345-in",
    "output_path": "/tmp/cs-plugin-12345-out"
  }
  ```
- **Your job**: read `input_path`, transform it, write the result to
  `output_path`.
- **stdout**: ignored.
- **exit 0**: success.

#### `schema send` and `schema transform`

If your plugin declares the `send` or `transformer` capability, the host
queries these on load:

- **stdin**: empty.
- **stdout**: JSON array of `SettingField` describing the form CommonStacks
  should render in Settings.

```jsonc
// Vec<SettingField>
[
  {
    "key":         "api_key",
    "label":       "API key",
    "help":        "Get one at example.com/settings.",
    "required":    true,
    "kind":        { "kind": "secret" },
    "placeholder": null,
    "default":     null
  }
]
```

`kind` is one of `"text"`, `"secret"`, `"email"`, `"url"`, `"number"`,
`"boolean"`. Boolean fields render as a toggle and store the literal
strings `"true"` / `"false"`.

#### `applies_to` *(transformers)*

- **stdin**: empty.
- **stdout**: JSON array of lowercase, no-dot extensions this transformer
  handles, e.g. `["epub", "pdf"]`.

### Settings storage

User-entered settings are persisted by CommonStacks in `config.json` under
the plugin's id. Your plugin receives them as the `settings` field of the
relevant `send` / `transform` invocation; you never write to the file
yourself.

### Merge policy *(metadata enrichers)*

CommonStacks merges enriched data on top of the OPDS source data with **OPDS
fields winning**. A plugin only fills in gaps — it can't overwrite a cover
or summary the source already provided.

---

## Worked example (Python)

The complete example lives in `examples/plugins/example-metadata/`. Here's
the gist:

```python
#!/usr/bin/env python3
import json, sys

def main() -> int:
    command = sys.argv[1]
    if command == "enrich":
        q = json.load(sys.stdin)
        if not q.get("title"):
            return 1                                # no result
        json.dump({
            "source": "my-plugin",
            "title":  q["title"],
            "authors": q.get("authors", []),
            "description": f'A book titled "{q["title"]}".',
            "subjects": ["Example"],
            "identifiers": [],
        }, sys.stdout)
        return 0
    print(f"unknown command: {command}", file=sys.stderr)
    return 2

sys.exit(main())
```

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "0.1.0",
  "api_version": 1,
  "executable": "plugin.py",
  "capabilities": ["metadata"]
}
```

That's the whole plugin. `chmod +x plugin.py`, drop the folder into your
plugins directory, restart CommonStacks.

---

## Worked example: transformer (Node)

A trivial EPUB-to-EPUB passthrough that prints to stderr how many bytes it
processed:

```js
#!/usr/bin/env node
const fs = require("fs");

const cmd = process.argv[2];
let stdin = "";
process.stdin.on("data", (d) => (stdin += d));
process.stdin.on("end", () => {
  try {
    if (cmd === "schema") {
      process.stdout.write("[]");                            // no settings
      process.exit(0);
    }
    if (cmd === "applies_to") {
      process.stdout.write(JSON.stringify(["epub"]));
      process.exit(0);
    }
    if (cmd === "transform") {
      const { settings, input_path, output_path } = JSON.parse(stdin);
      const data = fs.readFileSync(input_path);
      console.error(`processing ${data.length} bytes`);
      fs.writeFileSync(output_path, data);                   // passthrough
      process.exit(0);
    }
    console.error("unknown command:", cmd);
    process.exit(2);
  } catch (e) {
    console.error("plugin error:", e.message);
    process.exit(2);
  }
});
```

```json
{
  "id": "passthrough-transformer",
  "name": "EPUB Passthrough",
  "version": "0.1.0",
  "api_version": 1,
  "executable": "plugin.js",
  "capabilities": ["transformer"]
}
```

---

## Worked example: send target (Bash)

```bash
#!/usr/bin/env bash
set -e

cmd="$1"
payload="$(cat)"

case "$cmd" in
  schema)
    case "$2" in
      send)
        cat <<'JSON'
[
  { "key": "url", "label": "Target URL", "required": true,
    "kind": { "kind": "url" }, "help": null,
    "placeholder": "https://example.com/upload", "default": null }
]
JSON
        ;;
    esac
    ;;
  send)
    url=$(echo "$payload" | jq -r '.settings.url')
    file=$(echo "$payload" | jq -r '.request.file_path')
    if curl -sSf -X POST --data-binary "@$file" "$url" >/dev/null; then
      echo '{"ok": true, "message": "uploaded"}'
    else
      echo "curl failed" >&2
      exit 2
    fi
    ;;
esac
```

```json
{
  "id": "curl-upload",
  "name": "POST to URL",
  "version": "0.1.0",
  "api_version": 1,
  "executable": "plugin.sh",
  "capabilities": ["send"]
}
```

---

## Performance

Each call spawns a fresh process — typically 5–50 ms of overhead. That's
negligible compared to OPDS network calls (hundreds of ms) or EPUB
optimization (seconds). If you need to pre-warm an expensive thing (a model,
a remote API session), keep a cache file inside your plugin folder and load
it lazily on each call.

For truly latency-critical paths, future versions of CommonStacks may add a
long-running server protocol (one process, many calls over a socket). v1
keeps it spawn-per-call for simplicity.

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

Per-call stderr from a plugin is forwarded into the error path. If your
plugin exits non-zero, anything you wrote to stderr becomes the error
message shown in the CommonStacks UI — use that to surface diagnostics.

Test your plugin outside CommonStacks by piping JSON yourself:

```bash
echo '{"title": "Dune"}' | ./plugin.py enrich
```

---

## Versioning

`PLUGIN_ABI_VERSION` is bumped only on incompatible protocol changes. Adding
new optional JSON fields, new categories, or new commands is **not**
breaking — old plugins keep working. The host checks `api_version` in your
manifest against its own constant; mismatches log a warning and skip.

When you bump only your plugin's logic, bump `manifest.version` and leave
`api_version` alone.

---

## Roadmap

- **Streaming progress** from plugins (especially Transformers and Send
  targets) so the UI can render "Image 47 of 100" the way the built-in
  Crosspoint plugin does today.
- **Long-running plugin protocol** for cases where spawn-per-call is too
  expensive (e.g. plugins that load large models).
- **Sandboxed plugins** via WebAssembly Components, alongside the current
  subprocess path.
- **Plugin manifest in Marketplace** for one-click install.

If your use case isn't covered, open an issue describing what you need.
