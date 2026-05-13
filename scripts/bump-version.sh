#!/bin/bash
set -e

# Usage: ./scripts/bump-version.sh [major|minor|patch|<explicit version>]
# Bumps version in src-tauri/tauri.conf.json, src-tauri/Cargo.toml, and package.json.

BUMP=${1:-patch}

current=$(grep '"version"' src-tauri/tauri.conf.json | head -1 | sed 's/.*"version": "\(.*\)".*/\1/')
IFS='.' read -r MAJ MIN PAT <<< "$current"

case "$BUMP" in
  major) MAJ=$((MAJ + 1)); MIN=0; PAT=0 ;;
  minor) MIN=$((MIN + 1)); PAT=0 ;;
  patch) PAT=$((PAT + 1)) ;;
  *)
    if [[ "$BUMP" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
      MAJ=${BUMP%%.*}; rest=${BUMP#*.}; MIN=${rest%%.*}; PAT=${rest#*.}
    else
      echo "Invalid bump type: $BUMP"
      exit 1
    fi
    ;;
esac

new="${MAJ}.${MIN}.${PAT}"
echo "Bumping $current -> $new"

# tauri.conf.json — single root-level "version" key
sed -i.bak "s/\"version\": \"$current\"/\"version\": \"$new\"/" src-tauri/tauri.conf.json
rm -f src-tauri/tauri.conf.json.bak

# Cargo.toml — anchored on start-of-line to skip dependency versions
sed -i.bak "s/^version = \"$current\"/version = \"$new\"/" src-tauri/Cargo.toml
rm -f src-tauri/Cargo.toml.bak

# package.json — single root-level "version" key
sed -i.bak "s/\"version\": \"$current\"/\"version\": \"$new\"/" package.json
rm -f package.json.bak

# Refresh Cargo.lock entry so it doesn't lag
(cd src-tauri && cargo update -p common-stacks --offline >/dev/null 2>&1 || true)

echo "$new"
