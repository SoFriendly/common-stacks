# Example Metadata Plugin

A minimal CommonStacks plugin that demonstrates the v1 plugin ABI. It echoes
the search query back with a fake description and one subject ("Example").

## Build

```bash
cd examples/plugins/example-metadata
cargo build --release
```

This produces the platform library:
- macOS: `target/release/libexample_metadata.dylib`
- Linux: `target/release/libexample_metadata.so`
- Windows: `target/release/example_metadata.dll`

## Install

1. Find your CommonStacks plugins directory (Settings → Plugins → **Open plugins folder**).
2. Create a subfolder named `example-metadata`.
3. Copy the built library *and* this folder's `manifest.json` into it.
   - **Important on Windows:** rename `library` in `manifest.json` to `example_metadata.dll`.
4. Restart CommonStacks.

Open any book detail page — the description chip should mention "A book titled …".

See `docs/PLUGIN_DEVELOPMENT.md` for the full protocol.
