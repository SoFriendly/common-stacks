#!/bin/bash
set -e

# Uploads built artifacts to Cloudflare R2 and merges latest.json.
# Required env (load from .env.local):
#   CLOUDFLARE_ACCOUNT_ID
#   CLOUDFLARE_R2_ACCESS_KEY (or AWS_ACCESS_KEY_ID)
#   CLOUDFLARE_R2_SECRET_KEY (or AWS_SECRET_ACCESS_KEY)
#   CLOUDFLARE_R2_BUCKET     (default: commonstacks-releases)

if [ -f .env.local ]; then
  set -a; . ./.env.local; set +a
fi

[ -z "$CLOUDFLARE_R2_ACCESS_KEY" ] && CLOUDFLARE_R2_ACCESS_KEY="$AWS_ACCESS_KEY_ID"
[ -z "$CLOUDFLARE_R2_SECRET_KEY" ] && CLOUDFLARE_R2_SECRET_KEY="$AWS_SECRET_ACCESS_KEY"

if [ -z "$CLOUDFLARE_ACCOUNT_ID" ] || [ -z "$CLOUDFLARE_R2_ACCESS_KEY" ] || [ -z "$CLOUDFLARE_R2_SECRET_KEY" ]; then
  echo "Error: Missing Cloudflare R2 credentials"
  exit 1
fi

CLOUDFLARE_R2_BUCKET=${CLOUDFLARE_R2_BUCKET:-commonstacks-releases}
APP=CommonStacks
VERSION=$(grep '"version"' src-tauri/tauri.conf.json | head -1 | sed 's/.*"version": "\(.*\)".*/\1/')
PUBLIC_BASE="https://releases.commonstacks.com"
R2_ENDPOINT="https://${CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com"

echo "Uploading $APP $VERSION to $CLOUDFLARE_R2_BUCKET"

extract_changelog() {
  local file=CHANGELOG.md
  [ -f "$file" ] || { echo "Update to version ${VERSION}"; return; }
  local notes
  notes=$(awk -v ver="$VERSION" '
    /^## \[/ { if (found) exit; if ($0 ~ "\\[" ver "\\]") found=1; next }
    found && !/^## / { print }
  ' "$file" | sed '/^$/d' | sed 's/^- /• /' )
  if [ -z "$notes" ]; then
    notes=$(awk '
      /^## \[/ { if (found) exit; found=1; next }
      found && !/^## / { print }
    ' "$file" | sed '/^$/d' | sed 's/^- /• /' )
  fi
  [ -z "$notes" ] && notes="Update to version ${VERSION}"
  echo "$notes"
}
NOTES=$(extract_changelog)

s3() {
  AWS_ACCESS_KEY_ID=$CLOUDFLARE_R2_ACCESS_KEY \
  AWS_SECRET_ACCESS_KEY=$CLOUDFLARE_R2_SECRET_KEY \
  aws --endpoint-url "$R2_ENDPOINT" "$@"
}

upload() {
  local file=$1 key=$2
  if [ -f "$file" ]; then
    echo "  -> $key"
    s3 s3 cp "$file" "s3://${CLOUDFLARE_R2_BUCKET}/${key}" --no-progress
  fi
}

# --- macOS ---
DMG="src-tauri/target/release/bundle/dmg/${APP}_${VERSION}_aarch64.dmg"
[ ! -f "$DMG" ] && DMG=$(find src-tauri/target/aarch64-apple-darwin/release/bundle/dmg -name "*.dmg" 2>/dev/null | head -1)
[ -n "$DMG" ] && upload "$DMG" "v${VERSION}/${APP}_${VERSION}_aarch64.dmg"

MAC_TAR="src-tauri/target/release/bundle/${APP}_${VERSION}_darwin-aarch64.app.tar.gz"
upload "$MAC_TAR" "v${VERSION}/${APP}_${VERSION}_darwin-aarch64.app.tar.gz"
upload "${MAC_TAR}.sig" "v${VERSION}/${APP}_${VERSION}_darwin-aarch64.app.tar.gz.sig"

# --- Linux (CI artifacts) ---
for arch in x86_64 aarch64; do
  case $arch in x86_64) suffix=amd64;; aarch64) suffix=arm64;; esac
  APPIMG=$(find "artifacts/linux-appimage-${arch}" -name "*.AppImage" 2>/dev/null | head -1)
  [ -n "$APPIMG" ] && upload "$APPIMG" "v${VERSION}/${APP}_${VERSION}_${suffix}.AppImage"
  SIG=$(find "artifacts/linux-appimage-${arch}" -name "*.AppImage.sig" 2>/dev/null | head -1)
  [ -n "$SIG" ] && upload "$SIG" "v${VERSION}/${APP}_${VERSION}_${suffix}.AppImage.sig"
  DEB=$(find "artifacts/linux-deb-${arch}" -name "*.deb" 2>/dev/null | head -1)
  [ -n "$DEB" ] && upload "$DEB" "v${VERSION}/${APP}_${VERSION}_${suffix}.deb"
done

# --- Windows (CI artifacts) ---
MSI=$(find artifacts/windows-msi -name "*.msi" 2>/dev/null | head -1)
[ -n "$MSI" ] && upload "$MSI" "v${VERSION}/${APP}_${VERSION}_x64-setup.msi"
MSI_SIG=$(find artifacts/windows-msi -name "*.msi.sig" 2>/dev/null | head -1)
[ -n "$MSI_SIG" ] && upload "$MSI_SIG" "v${VERSION}/${APP}_${VERSION}_x64-setup.msi.sig"
NSIS=$(find artifacts/windows-nsis -name "*.exe" 2>/dev/null | head -1)
[ -n "$NSIS" ] && upload "$NSIS" "v${VERSION}/${APP}_${VERSION}_x64-setup.exe"
NSIS_SIG=$(find artifacts/windows-nsis -name "*.exe.sig" 2>/dev/null | head -1)
[ -n "$NSIS_SIG" ] && upload "$NSIS_SIG" "v${VERSION}/${APP}_${VERSION}_x64-setup.exe.sig"

# --- latest.json merge ---
read_sig() { [ -f "$1" ] && cat "$1" || true; }
MAC_SIG=$(read_sig "${MAC_TAR}.sig")
LINUX_X64_SIG=$(read_sig "$(find artifacts/linux-appimage-x86_64 -name "*.AppImage.sig" 2>/dev/null | head -1)")
LINUX_ARM_SIG=$(read_sig "$(find artifacts/linux-appimage-aarch64 -name "*.AppImage.sig" 2>/dev/null | head -1)")
WIN_SIG=$(read_sig "$(find artifacts/windows-msi -name "*.msi.sig" 2>/dev/null | head -1)")

LATEST=src-tauri/target/release/bundle/latest.json
mkdir -p "$(dirname "$LATEST")"
s3 s3 cp "s3://${CLOUDFLARE_R2_BUCKET}/latest.json" "$LATEST" --no-progress 2>/dev/null \
  || echo '{"platforms":{}}' > "$LATEST"

FILTER=""
if [ -n "$MAC_SIG" ]; then
  FILTER="$FILTER | .platforms[\"darwin-aarch64\"] = {\"signature\": \$mac, \"url\": \"$PUBLIC_BASE/v\(\$ver)/${APP}_\(\$ver)_darwin-aarch64.app.tar.gz\"}"
  FILTER="$FILTER | .platforms[\"darwin-x86_64\"] = {\"signature\": \$mac, \"url\": \"$PUBLIC_BASE/v\(\$ver)/${APP}_\(\$ver)_darwin-aarch64.app.tar.gz\"}"
fi
[ -n "$LINUX_X64_SIG" ] && FILTER="$FILTER | .platforms[\"linux-x86_64\"] = {\"signature\": \$linx, \"url\": \"$PUBLIC_BASE/v\(\$ver)/${APP}_\(\$ver)_amd64.AppImage\"}"
[ -n "$LINUX_ARM_SIG" ] && FILTER="$FILTER | .platforms[\"linux-aarch64\"] = {\"signature\": \$linarm, \"url\": \"$PUBLIC_BASE/v\(\$ver)/${APP}_\(\$ver)_arm64.AppImage\"}"
[ -n "$WIN_SIG" ] && FILTER="$FILTER | .platforms[\"windows-x86_64\"] = {\"signature\": \$win, \"url\": \"$PUBLIC_BASE/v\(\$ver)/${APP}_\(\$ver)_x64-setup.msi\"}"

if [ -n "$FILTER" ]; then
  FILTER="${FILTER# | }"
  PUB_DATE=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  FILTER=".version = \$ver | .notes = \$notes | .pub_date = \$pub_date | $FILTER"
  jq --arg ver "$VERSION" --arg notes "$NOTES" --arg pub_date "$PUB_DATE" \
     --arg mac "$MAC_SIG" --arg linx "$LINUX_X64_SIG" --arg linarm "$LINUX_ARM_SIG" --arg win "$WIN_SIG" \
     "$FILTER" "$LATEST" > "${LATEST}.tmp" && mv "${LATEST}.tmp" "$LATEST"
  upload "$LATEST" "latest.json"
else
  echo "No signatures found; not updating latest.json"
fi

echo "Done. https://releases.commonstacks.com/latest.json"
