# Upload Windows artifacts to R2 and merge the windows-x86_64 entry into
# latest.json so the Tauri updater picks it up. Run after build-windows.ps1.
#
# Required env (loaded from .env.local if present):
#   CLOUDFLARE_ACCOUNT_ID
#   CLOUDFLARE_R2_ACCESS_KEY  (or AWS_ACCESS_KEY_ID)
#   CLOUDFLARE_R2_SECRET_KEY  (or AWS_SECRET_ACCESS_KEY)
#
# Optional:
#   CLOUDFLARE_R2_BUCKET   defaults to "commonstacks-releases"

$ErrorActionPreference = "Stop"
$RepoRoot = Resolve-Path "$PSScriptRoot\.."
Set-Location $RepoRoot

if (Test-Path .env.local) {
    Get-Content .env.local | ForEach-Object {
        if ($_ -match '^([^#][^=]+)=(.*)$') {
            $name = $matches[1].Trim()
            $value = $matches[2].Trim('"')
            Set-Item -Path "env:$name" -Value $value
        }
    }
}

if (-not $env:CLOUDFLARE_R2_ACCESS_KEY) { $env:CLOUDFLARE_R2_ACCESS_KEY = $env:AWS_ACCESS_KEY_ID }
if (-not $env:CLOUDFLARE_R2_SECRET_KEY) { $env:CLOUDFLARE_R2_SECRET_KEY = $env:AWS_SECRET_ACCESS_KEY }

if (-not $env:CLOUDFLARE_ACCOUNT_ID -or -not $env:CLOUDFLARE_R2_ACCESS_KEY -or -not $env:CLOUDFLARE_R2_SECRET_KEY) {
    Write-Error "Missing CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_R2_ACCESS_KEY / CLOUDFLARE_R2_SECRET_KEY in .env.local"
    exit 1
}

if (-not $env:CLOUDFLARE_R2_BUCKET) { $env:CLOUDFLARE_R2_BUCKET = "commonstacks-releases" }

$env:AWS_ACCESS_KEY_ID = $env:CLOUDFLARE_R2_ACCESS_KEY
$env:AWS_SECRET_ACCESS_KEY = $env:CLOUDFLARE_R2_SECRET_KEY
$R2_ENDPOINT = "https://$($env:CLOUDFLARE_ACCOUNT_ID).r2.cloudflarestorage.com"
$APP = "CommonStacks"
$PUBLIC_BASE = "https://releases.commonstacks.com"

# ── Read version ────────────────────────────────────────────────────────────
$configContent = Get-Content "src-tauri\tauri.conf.json" -Raw
if ($configContent -notmatch '"version":\s*"([^"]+)"') {
    Write-Error "Could not read version from tauri.conf.json"; exit 1
}
$VERSION = $matches[1]
Write-Host "Uploading $APP $VERSION" -ForegroundColor Cyan

function Upload-File {
    param([string]$LocalPath, [string]$RemoteKey)
    if (Test-Path $LocalPath) {
        Write-Host "  -> $RemoteKey"
        & aws s3 cp $LocalPath "s3://$($env:CLOUDFLARE_R2_BUCKET)/$RemoteKey" `
            --endpoint-url $R2_ENDPOINT --no-progress
        if ($LASTEXITCODE -ne 0) { Write-Warning "Upload failed: $RemoteKey" }
    } else {
        Write-Host "  (skip, missing) $LocalPath" -ForegroundColor Yellow
    }
}

# Extract CHANGELOG notes for this version (best-effort).
function Get-ReleaseNotes {
    $file = "CHANGELOG.md"
    if (-not (Test-Path $file)) { return "Update to version $VERSION" }
    $lines = Get-Content $file
    $found = $false
    $notes = New-Object System.Collections.Generic.List[string]
    foreach ($line in $lines) {
        if ($line -match '^## \[') {
            if ($found) { break }
            if ($line -match "\[$([regex]::Escape($VERSION))\]") { $found = $true }
            continue
        }
        if ($found -and $line.Trim().Length -gt 0) {
            $notes.Add(($line -replace '^- ', '• '))
        }
    }
    if ($notes.Count -eq 0) { return "Update to version $VERSION" }
    return ($notes -join "`n")
}
$NOTES = Get-ReleaseNotes

Write-Host ""
Write-Host "=== Uploading Windows artifacts ===" -ForegroundColor Green

$bundleRoot = "src-tauri\target\release\bundle"

# NSIS .exe is what the Tauri updater consumes on Windows. Filter by $VERSION
# so a stale installer from a previous build can't be picked up by accident.
$nsisFile = Get-ChildItem -Path "$bundleRoot\nsis\*${VERSION}*-setup.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
if ($nsisFile) {
    Upload-File $nsisFile.FullName "v$VERSION/${APP}_${VERSION}_x64-setup.exe"
    if (Test-Path "$($nsisFile.FullName).sig") {
        Upload-File "$($nsisFile.FullName).sig" "v$VERSION/${APP}_${VERSION}_x64-setup.exe.sig"
    }
}

# Optional MSI mirror + its updater sig (Tauri produces .msi.sig when createUpdaterArtifacts=true).
$msiFile = Get-ChildItem -Path "$bundleRoot\msi\*${VERSION}*.msi" -ErrorAction SilentlyContinue | Select-Object -First 1
if ($msiFile) {
    Upload-File $msiFile.FullName "v$VERSION/${APP}_${VERSION}_x64-setup.msi"
    if (Test-Path "$($msiFile.FullName).sig") {
        Upload-File "$($msiFile.FullName).sig" "v$VERSION/${APP}_${VERSION}_x64-setup.msi.sig"
    }
}

Write-Host ""
Write-Host "=== Merging latest.json ===" -ForegroundColor Green

# Prefer NSIS sig for the updater entry (matches macOS-side convention of
# pointing the updater at the NSIS .exe). Fall back to MSI sig if absent.
$winSig = ""
$winUrl = ""
if ($nsisFile -and (Test-Path "$($nsisFile.FullName).sig")) {
    $winSig = (Get-Content "$($nsisFile.FullName).sig" -Raw).Trim()
    $winUrl = "$PUBLIC_BASE/v$VERSION/${APP}_${VERSION}_x64-setup.exe"
} elseif ($msiFile -and (Test-Path "$($msiFile.FullName).sig")) {
    $winSig = (Get-Content "$($msiFile.FullName).sig" -Raw).Trim()
    $winUrl = "$PUBLIC_BASE/v$VERSION/${APP}_${VERSION}_x64-setup.msi"
}

if (-not $winSig) {
    Write-Warning "No Windows .sig found — skipping latest.json merge"
    Write-Host "=== Upload complete (artifacts only) ===" -ForegroundColor Green
    exit 0
}

$latestJsonPath = Join-Path $RepoRoot "$bundleRoot\latest.json"
New-Item -ItemType Directory -Force -Path (Split-Path $latestJsonPath) | Out-Null

# Pull current latest.json so we preserve macOS/Linux entries.
& aws s3 cp "s3://$($env:CLOUDFLARE_R2_BUCKET)/latest.json" $latestJsonPath `
    --endpoint-url $R2_ENDPOINT --no-progress 2>$null
if (-not (Test-Path $latestJsonPath)) {
    '{"platforms":{}}' | Set-Content $latestJsonPath -NoNewline
}

$latest = Get-Content $latestJsonPath -Raw | ConvertFrom-Json
if (-not $latest.platforms) {
    $latest | Add-Member -NotePropertyName platforms -NotePropertyValue ([PSCustomObject]@{}) -Force
}

$latest | Add-Member -NotePropertyName version  -NotePropertyValue $VERSION -Force
$latest | Add-Member -NotePropertyName notes    -NotePropertyValue $NOTES -Force
$latest | Add-Member -NotePropertyName pub_date -NotePropertyValue ((Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")) -Force

$winEntry = [PSCustomObject]@{
    signature = $winSig
    url       = $winUrl
}
$latest.platforms | Add-Member -NotePropertyName "windows-x86_64" -NotePropertyValue $winEntry -Force

$json = $latest | ConvertTo-Json -Depth 10
[System.IO.File]::WriteAllText($latestJsonPath, $json, [System.Text.UTF8Encoding]::new($false))

Upload-File $latestJsonPath "latest.json"

Write-Host ""
Write-Host "=== Upload complete ===" -ForegroundColor Green
Write-Host "Update endpoint: $PUBLIC_BASE/latest.json"
