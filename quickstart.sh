#!/usr/bin/env bash
# mtc quick start — Linux/WSL dev path.
#
# On Unix, profile.rs spawns `bash` directly (no wsl.exe), so this exercises the
# full PTY/channel/tiling stack without a Windows host. Use this for development
# and CI; use quickstart.ps1 on a Windows host to test the real app.
#
#   ./quickstart.sh            # checks + install + verify (test/check/build)
#   ./quickstart.sh --run      # ... then boot headless (xvfb) as a sanity check
#   ./quickstart.sh --no-install
set -euo pipefail

RUN=0
INSTALL=1
for arg in "$@"; do
  case "$arg" in
    --run)        RUN=1 ;;
    --no-install) INSTALL=0 ;;
    -h|--help)    awk 'NR==1{next} /^#/{sub(/^# ?/,"");print;next} {exit}' "$0"; exit 0 ;;
    *) echo "unknown arg: $arg" >&2; exit 2 ;;
  esac
done

# this script lives at the repo root
cd "$(dirname "$0")"
echo "mtc quickstart (unix) — repo: $(pwd)"

step() { printf '\n=== %s ===\n' "$1"; }
ok()   { printf '  [ok]   %s\n' "$1"; }
warn() { printf '  [warn] %s\n' "$1"; }

step "Toolchain"
have() { command -v "$1" >/dev/null 2>&1; }

if have node; then
  v=$(node -v); maj=${v#v}; maj=${maj%%.*}
  if [ "$maj" -ge 18 ]; then ok "Node $v"; else echo "  [fail] Node $v < 18" >&2; exit 1; fi
else echo "  [fail] node not found" >&2; exit 1; fi

have npm   && ok "npm $(npm -v)"     || { echo "  [fail] npm not found" >&2; exit 1; }
have cargo && ok "cargo $(cargo -V)" || warn "cargo not found — Rust backend (cargo test / tauri) unavailable"

# Tauri Linux system deps (webkit2gtk etc.) — probe via pkg-config if available.
if have pkg-config; then
  if pkg-config --exists webkit2gtk-4.1 2>/dev/null || pkg-config --exists webkit2gtk-4.0 2>/dev/null; then
    ok "webkit2gtk dev libs present"
  else
    warn "webkit2gtk not found. Tauri build needs it — see https://tauri.app/start/prerequisites/"
  fi
fi

step "Install deps"
if [ "$INSTALL" -eq 1 ]; then npm install && ok "npm deps installed"; else warn "skipping npm install"; fi

step "Verify (frontend)"
npm run test         # vitest — tiling logic
npm run check        # svelte-check — type errors
npm run build        # type-check + vite build
ok "frontend test/check/build passed"

if have cargo; then
  step "Verify (Rust backend)"
  ( cd src-tauri && cargo test )
  ok "cargo test passed"
fi

if [ "$RUN" -eq 1 ]; then
  step "Headless boot sanity (xvfb)"
  if have xvfb-run; then
    ( cd src-tauri && cargo build )
    echo "  booting under xvfb — Ctrl-C to stop"
    xvfb-run -a ./src-tauri/target/debug/mtc
  else
    warn "xvfb-run not found; install xvfb or run 'npm run tauri dev' on a host with a display."
  fi
fi
