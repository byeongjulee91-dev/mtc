<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-06-02 | Updated: 2026-06-02 -->

# src-tauri

## Purpose
The Rust/Tauri backend. It defines the desktop shell, exposes IPC commands to the
frontend, spawns and manages WSL/bash PTY sessions, persists app data to the OS
config directory, and scans the filesystem for Claude skills. This is the native
half of the app; the frontend in `../src` is bundled into it at build time.

## Key Files

| File | Description |
|------|-------------|
| `Cargo.toml` | Crate manifest. Deps: `tauri 2`, `tauri-plugin-dialog`, `serde`/`serde_json`, `portable-pty 0.8`, `base64`. Release profile is size-optimized (`opt-level=s`, `lto`, `strip`). |
| `tauri.conf.json` | Tauri app config: product name/identifier, window (1280×800, min 800×500), `frontendDist: ../dist`, `devUrl: localhost:1420`, before-dev/build npm commands, bundle targets + icons. |
| `build.rs` | Build script — runs `tauri_build::build()`. |
| `Cargo.lock` | Pinned dependency versions. |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `src/` | Rust source: commands, PTY manager, storage, profile invocation (see `src/AGENTS.md`) |
| `capabilities/` | Tauri permission capabilities for the main window (see `capabilities/AGENTS.md`) |
| `examples/` | Standalone Rust examples / smoke checks (see `examples/AGENTS.md`) |
| `icons/` | App icon assets (PNG/ico/icns + android/ios). Generated from `../app-icon.png` via `tauri icon` — **not hand-edited**. |
| `gen/` | Tauri-generated schemas (e.g. `gen/schemas/`). Auto-generated — **do not edit**. |
| `target/` | Cargo build output. Ignored. |

## For AI Agents

### Working In This Directory
- Adding or changing an IPC command requires edits in **`src/main.rs`** (the
  `#[tauri::command]` and the `generate_handler!` list) **and** the matching
  wrapper in `../src/lib/api.ts`. Permissions for new capabilities go in
  `capabilities/default.json`.
- The dev/build pipeline is driven by `tauri.conf.json`'s `beforeDevCommand` /
  `beforeBuildCommand` (`npm run dev` / `npm run build`) and the fixed port 1420 —
  keep that port in sync with `../vite.config.ts`.
- `icons/` and `gen/` are generated; regenerate rather than editing by hand
  (`npm run tauri icon` / Tauri's codegen).

### Testing Requirements
- `cargo test` — unit tests live in `src/profile.rs` and `src/storage.rs`.
- `cargo run --example pty_smoke` — verifies portable-pty byte round-trip.
- `cargo build` / `npm run tauri build` for a full bundle.

### Common Patterns
- Commands return `Result<T, String>`; errors are stringified for the frontend.
- Cross-IPC structs derive `Serialize`/`Deserialize` with
  `#[serde(rename_all = "camelCase")]` to match the TS types.

## Dependencies

### Internal
- Bundles `../dist` (the built frontend) as `frontendDist`.

### External
- `tauri 2` + `tauri-build`, `tauri-plugin-dialog`, `portable-pty`, `serde`,
  `serde_json`, `base64`.

<!-- MANUAL: -->
