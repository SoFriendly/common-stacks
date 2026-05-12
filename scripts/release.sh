#!/bin/bash
set -e

# Usage: ./scripts/release.sh [major|minor|patch|<version>]
# Bumps version, builds macOS locally, commits & tags, pushes (triggers Linux/Windows CI),
# and uploads macOS artifacts to R2.

BUMP=${1:?Usage: ./scripts/release.sh [major|minor|patch|<version>]}

CURRENT_BRANCH=$(git branch --show-current)
if [ "$CURRENT_BRANCH" != "main" ]; then
  read -p "On branch '$CURRENT_BRANCH' (not main). Continue? (y/n) " -n 1 -r; echo
  [[ ! $REPLY =~ ^[Yy]$ ]] && exit 1
fi

if ! git diff --quiet --exit-code -- ':!src-tauri/tauri.conf.json' ':!src-tauri/Cargo.toml' ':!src-tauri/Cargo.lock' ':!package.json'; then
  echo "Error: uncommitted changes outside version files."
  exit 1
fi

OLD=$(grep '"version"' src-tauri/tauri.conf.json | head -1 | sed 's/.*"version": "\(.*\)".*/\1/')
echo "Current version: $OLD"

./scripts/build-macos.sh "$BUMP"

NEW=$(grep '"version"' src-tauri/tauri.conf.json | head -1 | sed 's/.*"version": "\(.*\)".*/\1/')
echo "New version: $NEW"

if git rev-parse "v$NEW" >/dev/null 2>&1; then
  echo "Error: tag v$NEW already exists"
  exit 1
fi

git add src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock package.json
git commit -m "Release v$NEW"
git tag -a "v$NEW" -m "Release v$NEW"
git push origin "$CURRENT_BRANCH"
git push origin "v$NEW"

./scripts/upload-to-cloudflare.sh

cat <<EOF

=== Release v$NEW pushed ===
macOS uploaded. GitHub Actions is building Linux/Windows.
Once CI finishes, re-run ./scripts/upload-to-cloudflare.sh from the repo root
with the artifacts/ folder populated, to merge those platforms into latest.json.
EOF
