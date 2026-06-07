# Build script for Windows.
# Usage:  .\scripts\build-windows.ps1 [major|minor|patch|<x.y.z>|--no-bump] [-Upload]
#
# Pipeline:
#   1. Optionally bump version in src-tauri/tauri.conf.json, src-tauri/Cargo.toml, package.json
#   2. bun install + bun run build (frontend)
#   3. bunx @tauri-apps/cli build  (NSIS + MSI)
#   4. signtool sign  (if a SoFriendly code-signing cert is in CurrentUser\My)
#   5. Optionally invoke scripts/upload-to-cloudflare.ps1

param(
    [string]$Bump = "--no-bump",
    [switch]$Upload
)

$ErrorActionPreference = "Stop"
$RepoRoot = Resolve-Path "$PSScriptRoot\.."
Set-Location $RepoRoot

# ── Find Windows SDK signtool ───────────────────────────────────────────────
$sdkBase = "C:\Program Files (x86)\Windows Kits\10\bin"
$sdkPath = Get-ChildItem $sdkBase -Directory -Filter "10.*" -ErrorAction SilentlyContinue |
    Sort-Object Name -Descending | Select-Object -First 1
if ($sdkPath) {
    $sdkBin = Join-Path $sdkPath.FullName "x64"
    $env:PATH = "$sdkBin;$env:PATH"
    $env:TAURI_WINDOWS_SIGNTOOL_PATH = Join-Path $sdkBin "signtool.exe"
    Write-Host "Added Windows SDK to PATH: $sdkBin"
} else {
    Write-Warning "Windows SDK not found at $sdkBase — signtool unavailable"
}

# ── Load .env.local ─────────────────────────────────────────────────────────
if (Test-Path .env.local) {
    Get-Content .env.local | ForEach-Object {
        if ($_ -match '^([^#][^=]+)=(.*)$') {
            $name = $matches[1].Trim()
            $value = $matches[2].Trim('"')
            Set-Item -Path "env:$name" -Value $value
        }
    }
}

# ── Version bump ────────────────────────────────────────────────────────────
function Bump-Version {
    param([string]$BumpArg)
    $configPath = "src-tauri\tauri.conf.json"
    $configContent = Get-Content $configPath -Raw
    if ($configContent -notmatch '"version":\s*"(\d+)\.(\d+)\.(\d+)"') {
        Write-Error "Could not read version from $configPath"; exit 1
    }
    $major = [int]$matches[1]; $minor = [int]$matches[2]; $patch = [int]$matches[3]
    $currentVersion = "$major.$minor.$patch"

    switch -Regex ($BumpArg) {
        '^major$' { $major++; $minor = 0; $patch = 0 }
        '^minor$' { $minor++; $patch = 0 }
        '^patch$' { $patch++ }
        '^\d+\.\d+\.\d+$' {
            $parts = $BumpArg.Split('.')
            $major = [int]$parts[0]; $minor = [int]$parts[1]; $patch = [int]$parts[2]
        }
        default { Write-Error "Invalid bump: $BumpArg (use major|minor|patch|x.y.z)"; exit 1 }
    }

    $newVersion = "$major.$minor.$patch"
    Write-Host "Bumping version: $currentVersion -> $newVersion"

    $configContent = $configContent -replace '"version":\s*"[^"]+"', "`"version`": `"$newVersion`""
    Set-Content $configPath $configContent -NoNewline

    $cargoPath = "src-tauri\Cargo.toml"
    $cargoContent = Get-Content $cargoPath -Raw
    # Match the first top-of-file version (anchored after [package] section header or BOL)
    $cargoContent = [regex]::Replace($cargoContent, '(?m)^version\s*=\s*"[^"]+"', "version = `"$newVersion`"", 1)
    Set-Content $cargoPath $cargoContent -NoNewline

    if (Test-Path "package.json") {
        $pkgContent = Get-Content "package.json" -Raw
        $pkgContent = $pkgContent -replace '"version":\s*"[^"]+"', "`"version`": `"$newVersion`""
        Set-Content "package.json" $pkgContent -NoNewline
    }

    # Refresh Cargo.lock so it doesn't lag
    Push-Location src-tauri
    cargo update -p common-stacks --offline 2>$null | Out-Null
    Pop-Location

    return $newVersion
}

if ($Bump -ne "--no-bump") {
    Bump-Version $Bump | Out-Null
}

$configContent = Get-Content "src-tauri\tauri.conf.json" -Raw
if ($configContent -notmatch '"version":\s*"([^"]+)"') {
    Write-Error "Could not read version from tauri.conf.json"; exit 1
}
$VERSION = $matches[1]
Write-Host "Building CommonStacks $VERSION (Windows x64)" -ForegroundColor Cyan

# ── Tauri update signing ────────────────────────────────────────────────────
if (-not $env:TAURI_SIGNING_PRIVATE_KEY -and $env:TAURI_SIGNING_PRIVATE_KEY_PATH) {
    $env:TAURI_SIGNING_PRIVATE_KEY = Get-Content $env:TAURI_SIGNING_PRIVATE_KEY_PATH -Raw
}
if (-not $env:TAURI_SIGNING_PRIVATE_KEY) {
    Write-Warning "TAURI_SIGNING_PRIVATE_KEY not set — auto-update bundles won't be signed"
}

# ── Code-signing cert check ─────────────────────────────────────────────────
Write-Host "Checking for code signing certificate..."
$cert = Get-ChildItem Cert:\CurrentUser\My -CodeSigningCert -ErrorAction SilentlyContinue |
    Where-Object { $_.Subject -like "*SoFriendly*" } | Select-Object -First 1
if ($cert) {
    Write-Host "Found: $($cert.Subject)" -ForegroundColor Green
    Write-Host "Thumbprint: $($cert.Thumbprint)"
    Write-Host "Expires: $($cert.NotAfter)"
} else {
    Write-Warning "Code signing certificate not found — make sure your Sectigo USB token is plugged in."
    $response = Read-Host "Continue without code signing? (y/N)"
    if ($response -ne 'y') { exit 1 }
}

# ── Frontend build ──────────────────────────────────────────────────────────
Write-Host ""
Write-Host "Installing JS deps..." -ForegroundColor Cyan
bun install
if ($LASTEXITCODE -ne 0) { Write-Error "bun install failed"; exit 1 }

# ── Build Tauri app ─────────────────────────────────────────────────────────
Write-Host ""
Write-Host "Building Tauri app (NSIS + MSI)..." -ForegroundColor Cyan
bunx @tauri-apps/cli build
if ($LASTEXITCODE -ne 0) { Write-Error "tauri build failed"; exit 1 }

# Authenticode signing happens inside the Tauri bundle step via the
# bundle.windows.certificateThumbprint setting in tauri.windows.conf.json,
# so the updater .sig is computed against the already-signed binary.
# Don't re-sign here — that would invalidate the .sig.
$bundleRoot = "src-tauri\target\release\bundle"

Write-Host ""
Write-Host "Artifacts in: $bundleRoot" -ForegroundColor Green
Get-ChildItem -Path "$bundleRoot\msi" -ErrorAction SilentlyContinue
Get-ChildItem -Path "$bundleRoot\nsis" -ErrorAction SilentlyContinue

# ── Auto-commit + tag (only when this run bumped the version) ───────────────
# Only the version files are staged so any unrelated WIP stays untouched.
if ($Bump -ne "--no-bump") {
    $tagExists = $false
    & git rev-parse "v$VERSION" 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { $tagExists = $true }

    if ($tagExists) {
        Write-Host "(tag v$VERSION already exists — skipping commit + tag)"
    } else {
        Write-Host ""
        Write-Host "=== Committing version bump ===" -ForegroundColor Cyan
        & git add src-tauri\tauri.conf.json src-tauri\Cargo.toml src-tauri\Cargo.lock package.json
        & git commit -m "Release v$VERSION"
        & git tag -a "v$VERSION" -m "Release v$VERSION"
        if ($Upload) {
            $branch = (& git branch --show-current).Trim()
            & git push origin $branch
            & git push origin "v$VERSION"
        } else {
            Write-Host "(skipped git push — pass -Upload to push commit + tag)"
        }
    }
}

if ($Upload) {
    Write-Host ""
    Write-Host "=== Uploading to Cloudflare R2 ===" -ForegroundColor Green
    & "$PSScriptRoot\upload-to-cloudflare.ps1"
}
