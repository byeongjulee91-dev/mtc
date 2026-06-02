<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-06-02 | Updated: 2026-06-02 -->

# src (src-tauri)

## Purpose
The Rust backend modules. `main.rs` wires the Tauri app and exposes IPC commands;
the other three modules implement the real work: spawning/managing PTYs, turning a
profile into a concrete process invocation, and persisting data + discovering
skills on disk.

## Key Files

| File | Description |
|------|-------------|
| `main.rs` | App entry. Declares the modules, defines the seven `#[tauri::command]`s (`load_app_data`, `save_app_data`, `scan_skills`, `create_session`, `write_session`, `resize_session`, `close_session`), registers the dialog plugin, manages a `PtyManager`, and runs the Tauri builder. Hides the console on Windows release builds. |
| `pty.rs` | `PtyManager` — owns all live PTY sessions in an `Arc<Mutex<HashMap>>`. `create` opens a PTY via `portable-pty`, spawns the child, and starts a reader thread that base64-encodes output into `PtyMessage::Data` over a channel and emits `PtyMessage::Exit` on EOF. `write`/`resize`/`close` operate by session id. Uses a poison-recovering `lock()` helper. |
| `profile.rs` | `Profile` (serde mirror of the TS type) and `build_invocation()`. On Windows the `shell` field selects the backend: `"powershell"` → `powershell.exe -NoLogo [-NoExit] [-Command …]`, `"cmd"` → `cmd.exe [/k|/c …]`, anything else → `wsl.exe [-d distro] [--cd cwd] -- bash …`. Native shells use the `cwd` field (a Windows path); WSL uses `--cd`. On Unix it always runs `bash` directly regardless of `shell`. Login shell `-l`, or `-lic <script>` with optional `exec bash -l` keep-open. Unit-tested for all backends. |
| `storage.rs` | App-data persistence (`load_app_data` / atomic `save_app_data` via temp-file + rename) and skill discovery (`scan_skills` walks roots, reads each subdir's `SKILL.md`, parses minimal YAML frontmatter for `name`/`description`). Defines the `Skill` struct. Unit-tested. |

## For AI Agents

### Working In This Directory
- **Command parity**: any change to a command's name, parameters, or return type
  must be reflected in `../../src/lib/api.ts`. The `generate_handler!` macro list
  in `main.rs` must include every command, or it won't be callable.
- **PTY lifecycle** (`pty.rs`): the slave handle is dropped after spawn so EOF
  reaches the reader; the reader thread reaps the child and removes the session on
  exit. `close()` removes from the map *before* killing/waiting to avoid holding
  the lock during a slow wait. Keep the `lock()` poison-recovery helper — a panic
  in one session must not disable the others.
- **`profile.rs` security note**: `profile.command` is composed verbatim into the
  shell script *by design* — it is trusted user input from the profile editor
  (users run their own commands in their own WSL). Don't "harden" this into
  breakage, but preserve the comment explaining the intent.
- **`storage.rs`**: saves are atomic (temp + rename); a missing/corrupt data file
  returns an empty object so the frontend fills defaults. Frontmatter parsing is
  intentionally minimal (flat `key: value`), not a full YAML parser.

### Testing Requirements
- `cargo test` runs the `#[cfg(test)]` modules in `profile.rs` (invocation shapes
  for Windows/Unix, distro/cwd, keep-open) and `storage.rs` (frontmatter parse,
  skill scan, save/load round-trip).
- `cargo run --example pty_smoke` for live PTY streaming.

### Common Patterns
- Commands return `Result<_, String>`; internal errors are mapped to descriptive
  strings (`map_err(|e| format!(...))`).
- IPC structs: `#[serde(rename_all = "camelCase")]`, `#[serde(default)]` on
  optional profile fields for forward/backward compatibility.

## Dependencies

### Internal
- `profile::build_invocation` is used by `pty::PtyManager::create`.
- `storage::Skill` / `pty::PtyMessage` / `profile::Profile` are re-exported through
  `main.rs` commands.

### External
- `portable-pty`, `base64`, `serde`/`serde_json`, `tauri` (`ipc::Channel`,
  `Manager`, `State`).

<!-- MANUAL: -->
