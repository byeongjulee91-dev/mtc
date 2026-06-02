# mtc — Multi-Terminal Claude Code

A **Tauri** desktop app for Windows that runs multiple **claude / codex** sessions
inside **WSL**, side-by-side, with split & maximize — plus a todo/query panel and a
skill panel.

```
┌─ Todos / Queries ─┬─ [Claude] [Codex] [WSL Shell]   ◧ ⬓ ⛶ ✕ ─┬─ Skills ───┐
│  [ ] write tests  │ ┌ Claude · claude ─┐┌ Codex · codex ──────┐│ • plan     │
│  [x] ship v0.1    │ │ (WSL pty)        ││ (WSL pty)           ││ • review   │
│                   │ │                  ││                     ││ • ship     │
│  greet  ➤ ✕       │ └──────────────────┘└─────────────────────┘│ Profiles…  │
└───────────────────┴───────────────────────────────────────────┴────────────┘
 mtc · WSL desktop                                  terminal focused · 42 skills
```

- **Left** — Todos and saved Queries. `➤` sends a query into the focused terminal.
- **Center** — terminal sessions launched from **profiles**. Each session spawns a
  real PTY; on Windows it enters WSL via `wsl.exe` and runs the profile's command.
  Split vertically/horizontally and maximize any pane.
- **Right** — **Skills** discovered from configurable roots (insert `/<name>` into the
  focused terminal), and a **Profiles** editor.

## Architecture

| Layer | Tech |
| --- | --- |
| Shell | Tauri v2 (Rust) |
| PTY | [`portable-pty`](https://crates.io/crates/portable-pty) — ConPTY on Windows, openpty on Unix |
| Frontend | Svelte 5 + TypeScript + Vite |
| Terminal | [`@xterm/xterm`](https://xtermjs.org) in the webview |

A profile is turned into a process invocation by `src-tauri/src/profile.rs`:

- **Windows** → `wsl.exe [-d <distro>] [--cd <cwd>] -- bash -lic "<command>; exec bash -l"`
  (or just `wsl.exe …` for a plain login shell when the command is empty).
- **Unix** (used for local dev / CI on Linux) → `bash` directly, so the exact same PTY
  plumbing can be exercised without a Windows host.

PTY output is base64-framed and streamed to the webview over a Tauri channel, then
written into xterm.js. Keystrokes and resize events flow back through Tauri commands.
Persisted data (todos, queries, profiles, skill roots) lives in the OS app-config dir
as `app-data.json` (atomic write).

## Prerequisites (Windows)

1. **WSL** with a distro, and `claude` / `codex` installed *inside* WSL
   (verify: `wsl -- bash -lic "claude --version"`).
2. **Rust** (stable, MSVC toolchain) — https://rustup.rs
3. **Node.js ≥ 18**
4. **WebView2 runtime** (preinstalled on Windows 11; otherwise install the Evergreen runtime).
5. Tauri prerequisites: https://tauri.app/start/prerequisites/ (Visual Studio C++ Build Tools).

## Develop & run (on Windows)

The project lives in WSL; from Windows access it via the `\\wsl$` share (e.g.
`\\wsl.localhost\<distro>\home\<you>\project\mtc`) or clone it onto the Windows drive.

### Quick start (recommended)

`quickstart.ps1` (in the repo root) automates the [`WINDOWS_SETUP.md`](WINDOWS_SETUP.md)
checklist — it verifies the host toolchain (Node, Rust, MSVC linker, WebView2) and
the WSL side (`claude`/`codex` on the login-shell PATH), then installs deps and
launches the dev window. Run it from a **Windows-native** path (e.g. `C:\dev\mtc`),
not a `\\wsl$` share:

```powershell
.\quickstart.ps1               # preflight checks + npm install + tauri dev
.\quickstart.ps1 -Build        # ... build a distributable instead
.\quickstart.ps1 -SkipChecks -NoInstall   # skip preflight + install, just run
```

For the **Linux/WSL dev path** (no Windows host — exercises the PTY stack against
`bash`, used for development & CI), use the bash counterpart:

```bash
./quickstart.sh                # checks + install + test/check/build
./quickstart.sh --run          # ... then a headless (xvfb) boot sanity check
```

### Manual

```powershell
npm install
npm run tauri dev      # hot-reloading dev window
```

Build a distributable:

```powershell
npm run tauri build    # produces an .msi / .exe under src-tauri/target/release/bundle
```

## Profiles

Edit profiles in the **right panel → Profiles** tab. Each profile has:

| Field | Meaning |
| --- | --- |
| Name / color | Label and accent shown on the chip & pane |
| Command | What to run inside WSL (`claude`, `codex`, …). Empty = login shell |
| distro | `wsl.exe -d <distro>` (empty = default distro) |
| cwd | `wsl.exe --cd <cwd>` working directory inside WSL |
| keep open | Drop into an interactive shell after the command exits |

Defaults: **Claude**, **Codex**, **WSL Shell**.

## Skills

The **Skills** tab scans configured **roots** for subdirectories containing a `SKILL.md`
and reads the `name` / `description` frontmatter. Because claude runs inside WSL, point a
root at the WSL skills dir via its UNC path, e.g.:

```
\\wsl.localhost\Ubuntu\home\<you>\.claude\skills
```

With no roots configured it falls back to the host's `~/.claude/skills`.

## Development scripts

```bash
npm run test       # vitest — tiling logic
npm run check      # svelte-check (type-check)
npm run build      # type-check + vite production build
cargo test         # (in src-tauri/) Rust unit tests — profile invocation, skill scan, storage
```

### A note on verification

This repo was developed in a Linux/WSL environment. The frontend (type-check, build,
unit tests) and the Rust backend (`cargo test` / `cargo build` for Linux) are verified
there. The **Windows-specific paths** — `wsl.exe` spawning and the WebView2 window —
must be run on a Windows host (`npm run tauri dev`). On Unix the PTY plumbing is
exercised against `bash`, so the same channel/resize/lifecycle code is covered.
