# Example Metadata Plugin

A minimal CommonStacks plugin written as a Python script. No compilation, no
toolchain — copy the folder, restart, done.

## Install

1. In CommonStacks, open **Settings → Plugins → Open plugins folder**.
2. Copy this entire folder (`example-metadata/`) into it.
3. Make sure the script is executable (it should already be):
   ```bash
   chmod +x example-metadata/plugin.py
   ```
4. Restart CommonStacks.

Open any book detail page — the description chip should mention
"A book titled …".

## How it works

The whole thing is two files: `manifest.json` describing what the plugin
provides, and `plugin.py` implementing it. CommonStacks calls
`./plugin.py enrich` per book, pipes a JSON query on stdin, and reads the
enriched metadata back from stdout. No FFI, no shared types, no ABI risk.

See `docs/PLUGIN_DEVELOPMENT.md` for the full protocol.
