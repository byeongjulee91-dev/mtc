<#
.SYNOPSIS
    mtc quick start — preflight checks + install + launch (Windows host).

.DESCRIPTION
    Automates the WINDOWS_SETUP.md checklist:
      1. Verifies host toolchain   (Node, Rust/cargo, MSVC linker, WebView2)
      2. Verifies the WSL side      (wsl present, claude/codex on the login-shell PATH)
      3. Installs npm deps fresh    (platform-native binaries — never reuse WSL's)
      4. Launches `npm run tauri dev`

    Run from a *Windows-native* path (e.g. C:\dev\mtc), NOT a \\wsl$ share.

.PARAMETER Build
    Run `npm run tauri build` (distributable) instead of the dev window.

.PARAMETER SkipChecks
    Skip preflight and jump straight to install + run.

.PARAMETER NoInstall
    Skip `npm install` (use when deps are already current).

.EXAMPLE
    .\quickstart.ps1
    .\quickstart.ps1 -Build
    .\quickstart.ps1 -SkipChecks -NoInstall
#>
[CmdletBinding()]
param(
    [switch]$Build,
    [switch]$SkipChecks,
    [switch]$NoInstall
)

$ErrorActionPreference = 'Stop'

# --- pretty printers -------------------------------------------------------
function Write-Step($msg) { Write-Host "`n=== $msg ===" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "  [ok]   $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "  [warn] $msg" -ForegroundColor Yellow }
function Write-Err($msg)  { Write-Host "  [fail] $msg" -ForegroundColor Red }

$script:HardFail = $false
function Fail($msg) { Write-Err $msg; $script:HardFail = $true }

# This script lives at the repo root; work from there regardless of cwd.
$RepoRoot = $PSScriptRoot
Set-Location $RepoRoot
Write-Host "mtc quickstart - repo: $RepoRoot" -ForegroundColor Magenta

# --- 0. location sanity ----------------------------------------------------
if ($RepoRoot -match '^\\\\wsl') {
    Write-Warn "Running from a \\wsl$ share. cargo/HMR can be slow or break here."
    Write-Warn "Recommended: clone/copy to a native drive (e.g. C:\dev\mtc). See WINDOWS_SETUP.md §2."
}

if (-not $SkipChecks) {
    # --- 1. host toolchain -------------------------------------------------
    Write-Step "Host toolchain"

    function Test-Cmd($name) { return [bool](Get-Command $name -ErrorAction SilentlyContinue) }

    if (Test-Cmd node) {
        $nodeV = (node -v)
        $major = [int]($nodeV.TrimStart('v').Split('.')[0])
        if ($major -ge 18) { Write-Ok "Node $nodeV" }
        else { Fail "Node $nodeV is < 18. Install Node 18+ (LTS)." }
    } else { Fail "Node.js not found. Install from https://nodejs.org (>= 18)." }

    if (Test-Cmd npm)   { Write-Ok "npm $(npm -v)" } else { Fail "npm not found (comes with Node)." }
    if (Test-Cmd cargo) { Write-Ok "cargo $((cargo -V))" } else { Fail "Rust/cargo not found. Install https://rustup.rs then 'rustup default stable-msvc'." }

    # MSVC linker — Tauri's link step needs link.exe (VS C++ Build Tools).
    if (Test-Cmd link)  { Write-Ok "MSVC linker (link.exe) on PATH" }
    else { Write-Warn "link.exe not on PATH. If build fails with 'linker link.exe not found', install VS C++ Build Tools ('Desktop development with C++')." }

    # WebView2 runtime — registry probe (per-machine x64 + per-user).
    $wv2Keys = @(
        'HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
        'HKCU:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
    )
    $wv2 = $false
    foreach ($k in $wv2Keys) {
        try { if ((Get-ItemProperty -Path $k -ErrorAction Stop).pv) { $wv2 = $true; break } } catch {}
    }
    if ($wv2) { Write-Ok "WebView2 runtime detected" }
    else { Write-Warn "WebView2 runtime not detected. Win11 usually ships it; otherwise install the Evergreen runtime (else: blank/white window)." }

    # --- 2. WSL side -------------------------------------------------------
    Write-Step "WSL side (claude/codex inside the login shell)"

    if (Test-Cmd wsl) {
        Write-Ok "wsl.exe present"

        # claude / codex must resolve on the *login + interactive* shell PATH,
        # because profile.rs spawns: wsl.exe -- bash -lic "<cmd>; exec bash -l"
        foreach ($tool in 'claude','codex') {
            try {
                $out = (wsl -- bash -lic "$tool --version" 2>$null | Out-String).Trim()
                if ($LASTEXITCODE -eq 0 -and $out) { Write-Ok "$tool in WSL: $($out -split "`n" | Select-Object -First 1)" }
                else { Write-Warn "$tool not found on WSL login-shell PATH. Add it to ~/.bashrc/~/.profile. (WINDOWS_SETUP.md §4)" }
            } catch { Write-Warn "Could not probe '$tool' in WSL: $_" }
        }
    } else {
        Write-Warn "wsl.exe not found. Install with 'wsl --install'. The app's terminals won't work without WSL."
    }

    if ($script:HardFail) {
        Write-Host "`nPreflight found blocking issues above. Fix them, or re-run with -SkipChecks to bypass." -ForegroundColor Red
        exit 1
    }
}

# --- 3. install deps (fresh, platform-native) ------------------------------
if (-not $NoInstall) {
    Write-Step "npm install (platform-native — do not reuse WSL's node_modules)"
    npm install
    if ($LASTEXITCODE -ne 0) { Write-Err "npm install failed."; exit 1 }
    Write-Ok "dependencies installed"
} else {
    Write-Warn "Skipping npm install (-NoInstall)."
}

# --- 4. run ----------------------------------------------------------------
if ($Build) {
    Write-Step "npm run tauri build (distributable -> src-tauri\target\release\bundle)"
    npm run tauri build
} else {
    Write-Step "npm run tauri dev (hot-reloading window — first build compiles Rust deps, takes a few min)"
    npm run tauri dev
}
