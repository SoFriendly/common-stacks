#!/bin/bash
set -e

# Usage: ./scripts/build-macos.sh [major|minor|patch|<version>|--no-bump]
#
# Builds a signed + notarized macOS bundle and the updater .app.tar.gz + .sig.
# Requires the following env (place them in .env.local):
#   TAURI_SIGNING_PRIVATE_KEY        (or _PATH)   minisign private key for updater
#   TAURI_SIGNING_PRIVATE_KEY_PASSWORD
#   APPLE_SIGNING_IDENTITY            "Developer ID Application: ..." (codesign)
#   APPLE_ID, APPLE_PASSWORD, APPLE_TEAM_ID       (notarytool)
#
# Notarization is skipped automatically if Apple creds are unset.

if [ -f .env.local ]; then
  set -a; . ./.env.local; set +a
fi

BUMP=${1:---no-bump}
if [ "$BUMP" != "--no-bump" ]; then
  ./scripts/bump-version.sh "$BUMP" >/dev/null
fi

VERSION=$(grep '"version"' src-tauri/tauri.conf.json | head -1 | sed 's/.*"version": "\(.*\)".*/\1/')
echo "Building CommonStacks $VERSION (macOS arm64)"

if [ -z "$TAURI_SIGNING_PRIVATE_KEY" ] && [ -n "$TAURI_SIGNING_PRIVATE_KEY_PATH" ]; then
  export TAURI_SIGNING_PRIVATE_KEY=$(cat "$TAURI_SIGNING_PRIVATE_KEY_PATH")
fi
if [ -z "$TAURI_SIGNING_PRIVATE_KEY" ]; then
  echo "Error: TAURI_SIGNING_PRIVATE_KEY (or _PATH) is not set"
  exit 1
fi

bun install >/dev/null
bun run build

bunx @tauri-apps/cli build --target aarch64-apple-darwin

BUNDLE_DIR="src-tauri/target/aarch64-apple-darwin/release/bundle"
DMG=$(find "$BUNDLE_DIR/dmg" -name "*.dmg" | head -1)
APP=$(find "$BUNDLE_DIR/macos" -maxdepth 1 -name "*.app" | head -1)

# Mirror artifacts under release/bundle paths the uploader expects.
mkdir -p src-tauri/target/release/bundle/dmg
cp "$DMG" "src-tauri/target/release/bundle/dmg/CommonStacks_${VERSION}_aarch64.dmg"

# Updater tarball + signature
TAR="src-tauri/target/release/bundle/CommonStacks_${VERSION}_darwin-aarch64.app.tar.gz"
tar -C "$(dirname "$APP")" -czf "$TAR" "$(basename "$APP")"
echo "$TAURI_SIGNING_PRIVATE_KEY" > /tmp/cs-sign.key
bunx @tauri-apps/cli signer sign \
  --private-key-path /tmp/cs-sign.key \
  --password "${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}" \
  "$TAR" > /tmp/cs-sign.out
rm -f /tmp/cs-sign.key
# tauri signer writes <file>.sig alongside the artifact
if [ ! -f "${TAR}.sig" ]; then
  echo "Error: expected ${TAR}.sig from signer"
  cat /tmp/cs-sign.out
  exit 1
fi

# Notarize the .dmg if Apple credentials exist.
if [ -n "$APPLE_ID" ] && [ -n "$APPLE_PASSWORD" ] && [ -n "$APPLE_TEAM_ID" ]; then
  echo "Submitting $DMG to Apple notarytool…"
  xcrun notarytool submit "$DMG" \
    --apple-id "$APPLE_ID" \
    --password "$APPLE_PASSWORD" \
    --team-id "$APPLE_TEAM_ID" \
    --wait
  xcrun stapler staple "$DMG" || true
else
  echo "(skipping notarization — APPLE_ID/APPLE_PASSWORD/APPLE_TEAM_ID not set)"
fi

echo "macOS build complete: $DMG"
