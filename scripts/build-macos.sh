#!/bin/bash
set -e

# Usage: ./scripts/build-macos.sh [major|minor|patch|<version>|--no-bump] [--upload]
#
# Builds a signed + notarized macOS bundle and the updater .app.tar.gz + .sig.
# Pass --upload to also push artifacts to R2 + merge latest.json when the build
# finishes.
#
# Requires the following env (place them in .env.local):
#   TAURI_SIGNING_PRIVATE_KEY        (or _PATH)   minisign private key for updater
#   TAURI_SIGNING_PRIVATE_KEY_PASSWORD
#   APPLE_SIGNING_IDENTITY            "Developer ID Application: ..." (codesign)
#   APPLE_ID, APPLE_PASSWORD, APPLE_TEAM_ID       (notarytool)
#   CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_R2_ACCESS_KEY, CLOUDFLARE_R2_SECRET_KEY  (only if --upload)
#
# Notarization is skipped automatically if Apple creds are unset.

if [ -f .env.local ]; then
  set -a; . ./.env.local; set +a
fi

UPLOAD=0
BUMP=--no-bump
for arg in "$@"; do
  case "$arg" in
    --upload) UPLOAD=1 ;;
    major|minor|patch|--no-bump) BUMP=$arg ;;
    *)
      if [[ "$arg" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
        BUMP=$arg
      else
        echo "Unknown argument: $arg"
        echo "Usage: ./scripts/build-macos.sh [major|minor|patch|<version>|--no-bump] [--upload]"
        exit 1
      fi
      ;;
  esac
done

if [ "$BUMP" != "--no-bump" ]; then
  ./scripts/bump-version.sh "$BUMP" >/dev/null
fi

VERSION=$(grep '"version"' src-tauri/tauri.conf.json | head -1 | sed 's/.*"version": "\(.*\)".*/\1/')
echo "Building CommonStacks $VERSION (macOS universal — arm64 + x86_64)"

if [ -z "$TAURI_SIGNING_PRIVATE_KEY" ] && [ -n "$TAURI_SIGNING_PRIVATE_KEY_PATH" ]; then
  export TAURI_SIGNING_PRIVATE_KEY=$(cat "$TAURI_SIGNING_PRIVATE_KEY_PATH")
fi
if [ -z "$TAURI_SIGNING_PRIVATE_KEY" ]; then
  echo "Error: TAURI_SIGNING_PRIVATE_KEY (or _PATH) is not set"
  exit 1
fi

bun install >/dev/null
bun run build

bunx @tauri-apps/cli build --target universal-apple-darwin

BUNDLE_DIR="src-tauri/target/universal-apple-darwin/release/bundle"
DMG=$(find "$BUNDLE_DIR/dmg" -name "*.dmg" | head -1)
APP=$(find "$BUNDLE_DIR/macos" -maxdepth 1 -name "*.app" | head -1)

# tauri build (with bundle.createUpdaterArtifacts: true) already produces
# the updater tarball + minisign .sig in $BUNDLE_DIR/macos. Mirror everything
# the uploader looks for under the canonical no-space CommonStacks_* names.
mkdir -p src-tauri/target/release/bundle/dmg
cp "$DMG" "src-tauri/target/release/bundle/dmg/CommonStacks_${VERSION}_universal.dmg"

SRC_TAR=$(find "$BUNDLE_DIR/macos" -maxdepth 1 -name "*.app.tar.gz" | head -1)
SRC_SIG=$(find "$BUNDLE_DIR/macos" -maxdepth 1 -name "*.app.tar.gz.sig" | head -1)
if [ -z "$SRC_TAR" ] || [ -z "$SRC_SIG" ]; then
  echo "Error: tauri did not produce an updater tarball + .sig in $BUNDLE_DIR/macos"
  echo "Check that bundle.createUpdaterArtifacts is true in tauri.conf.json and that"
  echo "TAURI_SIGNING_PRIVATE_KEY was set during the build."
  exit 1
fi
TAR="src-tauri/target/release/bundle/CommonStacks_${VERSION}_darwin-universal.app.tar.gz"
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

# Auto-commit + tag when this run included a version bump. Only the version
# files are staged so any unrelated WIP stays untouched.
if [ "$BUMP" != "--no-bump" ]; then
  if git rev-parse "v$VERSION" >/dev/null 2>&1; then
    echo "(tag v$VERSION already exists — skipping commit + tag)"
  else
    echo ""
    echo "=== Committing version bump ==="
    git add src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock package.json
    git commit -m "Release v$VERSION"
    git tag -a "v$VERSION" -m "Release v$VERSION"
    if [ "$UPLOAD" = "1" ]; then
      CURRENT_BRANCH=$(git branch --show-current)
      git push origin "$CURRENT_BRANCH"
      git push origin "v$VERSION"
    else
      echo "(skipped git push — pass --upload to push commit + tag)"
    fi
  fi
fi

if [ "$UPLOAD" = "1" ]; then
  echo ""
  echo "=== Uploading to Cloudflare R2 ==="
  ./scripts/upload-to-cloudflare.sh
fi
