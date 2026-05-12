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

# tauri build (with bundle.createUpdaterArtifacts: true) already produces
# the updater tarball + minisign .sig in $BUNDLE_DIR/macos. Mirror everything
# the uploader looks for under the canonical no-space CommonStacks_* names.
mkdir -p src-tauri/target/release/bundle/dmg
cp "$DMG" "src-tauri/target/release/bundle/dmg/CommonStacks_${VERSION}_aarch64.dmg"

SRC_TAR=$(find "$BUNDLE_DIR/macos" -maxdepth 1 -name "*.app.tar.gz" | head -1)
SRC_SIG=$(find "$BUNDLE_DIR/macos" -maxdepth 1 -name "*.app.tar.gz.sig" | head -1)
if [ -z "$SRC_TAR" ] || [ -z "$SRC_SIG" ]; then
  echo "Error: tauri did not produce an updater tarball + .sig in $BUNDLE_DIR/macos"
  echo "Check that bundle.createUpdaterArtifacts is true in tauri.conf.json and that"
  echo "TAURI_SIGNING_PRIVATE_KEY was set during the build."
  exit 1
fi
TAR="src-tauri/target/release/bundle/CommonStacks_${VERSION}_darwin-aarch64.app.tar.gz"
cp "$SRC_TAR" "$TAR"
cp "$SRC_SIG" "${TAR}.sig"

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
