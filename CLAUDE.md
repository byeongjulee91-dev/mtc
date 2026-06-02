# CLAUDE.md

Project guidance for Claude Code working in **mtc** (Multi-Terminal Claude Code).

The full architecture documentation lives in the hierarchical `AGENTS.md` files
throughout the tree — this file imports the root one below so there is a single
source of truth. When working in a subdirectory, also read that directory's
`AGENTS.md` (each links to its parent via a `<!-- Parent: ../AGENTS.md -->` tag).

## Quick reference

| Task | Command |
|------|---------|
| Frontend dev (browser, no backend) | `npm run dev` |
| Full desktop app (Windows) | `npm run tauri dev` |
| Type/markup check | `npm run check` |
| Frontend tests | `npm test` (vitest) |
| Backend tests | `cargo test` (in `src-tauri/`) |
| PTY smoke check | `cargo run --example pty_smoke` (in `src-tauri/`) |
| Production bundle | `npm run tauri build` |

## Critical invariants (don't break these)

1. **Command parity** — every `#[tauri::command]` in `src-tauri/src/main.rs` must
   have a matching `invoke(...)` wrapper in `src/lib/api.ts`, be listed in
   `generate_handler!`, and (for plugin APIs) be permitted in
   `src-tauri/capabilities/default.json`.
2. **Type parity** — the Rust `Profile` (`src-tauri/src/profile.rs`) mirrors the
   TS `Profile` (`src/lib/types.ts`) via serde `rename_all = "camelCase"`
   (`keep_open` ↔ `keepOpen`). Change both sides together.
3. **Dual-mode** — the app must keep working both inside Tauri (real WSL
   terminals) and as plain `vite` in a browser (`standalone` mode, no backend).
   Preserve the graceful fallbacks in `state.svelte.ts` and `TerminalPane.svelte`.
4. **Svelte 5 runes only** — `$state`/`$derived`/`$effect`/`$props`; reactive
   singletons live in `.svelte.ts` files. No legacy store API.
5. **Generated, don't hand-edit** — `src-tauri/icons/` (via `npm run tauri icon`)
   and `src-tauri/gen/` (Tauri codegen).

## Git workflow

- **Commit and push directly on `main`.** When reflecting changes to git, commit
  on the `main` branch and push immediately — no feature branches or PRs.
- After making an edit, commit and push it right away (`git add`, `git commit`,
  `git push`) rather than batching unrelated changes.

@AGENTS.md
