#!/bin/bash
set -e

# Usage: ./scripts/release.sh [major|minor|patch|<version>]
# Convenience wrapper: bump + build + commit + tag + push + upload, in that order.
# Equivalent to: ./scripts/build-macos.sh <bump> --upload
# (Linux/Windows builds run in CI once the tag is pushed.)

BUMP=${1:?Usage: ./scripts/release.sh [major|minor|patch|<version>]}

CURRENT_BRANCH=$(git branch --show-current)
if [ "$CURRENT_BRANCH" != "main" ]; then
  read -p "On branch '$CURRENT_BRANCH' (not main). Continue? (y/n) " -n 1 -r; echo
  [[ ! $REPLY =~ ^[Yy]$ ]] && exit 1
fi

if ! git diff --quiet --exit-code -- ':!src-tauri/tauri.conf.json' ':!src-tauri/Cargo.toml' ':!src-tauri/Cargo.lock' ':!package.json'; then
  echo "Error: uncommitted changes outside version files."
  echo "Commit or stash them, then re-run."
  exit 1
fi

./scripts/build-macos.sh "$BUMP" --upload

VERSION=$(grep '"version"' src-tauri/tauri.conf.json | head -1 | sed 's/.*"version": "\(.*\)".*/\1/')

cat <<EOF

=== Release v$VERSION pushed ===
macOS uploaded. GitHub Actions is building Linux/Windows.
Once CI finishes, re-run ./scripts/upload-to-cloudflare.sh from the repo root
with the artifacts/ folder populated, to merge those platforms into latest.json.
EOF
