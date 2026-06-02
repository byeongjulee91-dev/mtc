<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-06-02 | Updated: 2026-06-02 -->

# examples

## Purpose
Standalone Rust binaries run via `cargo run --example <name>`. They exercise
backend plumbing in isolation — without launching the full Tauri app — so the
core mechanics can be validated quickly in any environment (including the Linux
sandbox).

## Key Files

| File | Description |
|------|-------------|
| `pty_smoke.rs` | Proves `portable-pty` round-trips bytes in this runtime: opens a PTY, spawns `bash -lic 'echo PTY_SMOKE_OK; exit 0'` (the same shape as the Unix profile path), resizes the master, reads output with a 5s deadline, and asserts the marker is present. Exits non-zero on failure. |

## For AI Agents

### Working In This Directory
- Examples mirror, but do not import, the real backend logic. `pty_smoke.rs`
  intentionally reconstructs the invocation that `../src/profile.rs`
  `build_invocation(windows=false)` produces — keep them consistent if the Unix
  invocation shape changes.
- Run with `cargo run --example pty_smoke` from `src-tauri/`.

### Testing Requirements
- This *is* a test harness; treat a non-zero exit / missing `PTY_SMOKE_OK` marker
  as a failure of the PTY layer in the current environment.

### Common Patterns
- Self-contained `fn main()`, bounded by a deadline so it can't hang CI.

## Dependencies

### External
- `portable-pty` — same crate the real PTY manager (`../src/pty.rs`) uses.

<!-- MANUAL: -->
