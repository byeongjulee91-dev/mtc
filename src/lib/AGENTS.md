<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-06-02 | Updated: 2026-06-02 -->

# lib

## Purpose
The heart of the frontend: reactive application state, the Tauri IPC client, the
binary-space-partition tiling engine, shared types, defaults/migration, and the
focused-pane bus. These modules are framework-light (plain TS, except the
`.svelte.ts` rune files) and are imported by the components in `components/`.

## Key Files

| File | Description |
|------|-------------|
| `state.svelte.ts` | The `app` singleton (`AppState`). Holds persisted `AppData` + live `skills`, exposes mutations for projects/todos/queries/profiles/skill-roots/font-size, autosaves with a 250ms debounce, and detects `standalone` mode when no Tauri backend is present. Profiles are two-tier: global (`data.profiles`) plus per-project (`project.profiles`); `visibleProfiles` concatenates global + active-project, and `addProfile(p, scope)` targets either tier. |
| `api.ts` | Tauri IPC client. Wraps `invoke(...)` for every backend command and defines `PtyMessage`; `createSession` opens a `Channel`, base64-decodes streamed PTY bytes, and dispatches to callbacks. |
| `bus.svelte.ts` | The `bus` singleton: a tiny shared sender so side panels can write to the focused terminal without prop-drilling. The active+visible `TerminalPane` registers `bus.send`; `bus.hasFocus` tracks whether the active workspace has a pane; `bus.liveCounts` (per-bucket warm-session counts) and `bus.parkProject(key)` drive the left panel's badge/park button. |
| `session.svelte.ts` | `PaneRuntime` — the live tiling state (tree, pane→profile `SvelteMap`, focus/maximize, id allocator) for one workspace bucket, with the split/close/maximize/equalize/focus-neighbor operations. `CenterPanel` keeps one per visited bucket. Exports the shared `AREA` box. |
| `layout.ts` | Pure conversions between the live `TileNode` tree (numeric pane ids) and the persisted `LayoutNode` tree (stable profile ids): `serializeTree` (live→persisted, dropping profile-less leaves) and `buildLayout` (persisted→live, dropping deleted-profile leaves, re-allocating ids, applying a `prepare` hook for cwd). Unit-tested. |
| `tiling.ts` | Pure BSP tile-tree logic: `TileNode` (leaf/split), `splitPane`, `removePane`, `paneOrder`, `leafCount`, `nudgeRatio`, `computeTiles`, `effectiveTiles`. No framework deps — fully unit-tested. |
| `types.ts` | Shared interfaces: `Profile`, `Todo`, `SavedQuery`, `Skill`, `Project` (incl. `layout`), `AppData` (incl. `unfiledLayout`), and the persisted `LayoutNode` (leaf/split). The `Profile` shape mirrors the Rust `Profile` in `src-tauri/src/profile.rs`. |
| `defaults.ts` | `defaultAppData()` / `defaultProfiles()` (claude/codex/shell seeds), `uid()`, `UNFILED_KEY` (the no-project bucket sentinel), font-size bounds + `clampFontSize`, `normalizeLayout()`, and `normalizeAppData()` which migrates the legacy pre-projects data shape. |
| `tiling.test.ts` | Vitest suite for `tiling.ts`: non-overlap, full coverage, split/remove/maximize/nudge invariants. |
| `layout.test.ts` | Vitest suite for `layout.ts`: serialize/build round-trip, fresh-id allocation, cwd `prepare`, and deleted-profile leaf collapse. |

## For AI Agents

### Working In This Directory
- `.svelte.ts` files (`state.svelte.ts`, `bus.svelte.ts`, `session.svelte.ts`)
  may use runes (`$state`, and `$state` class fields) at module scope; plain
  `.ts` files (`tiling.ts`, `layout.ts`, `api.ts`, etc.) must not.
- **`types.ts` ↔ Rust parity**: `Profile` here must match `Profile` in
  `src-tauri/src/profile.rs` (camelCase ↔ snake_case via serde). Update both when
  changing fields.
- **`api.ts` ↔ commands parity**: every wrapper corresponds to a
  `#[tauri::command]` in `src-tauri/src/main.rs`. Argument names passed to
  `invoke` must match the Rust parameter names (e.g. `onEvent` → `on_event`).
- State mutations call `scheduleSave()`, which is a no-op in standalone mode and
  snapshots via `$state.snapshot()` before crossing IPC — keep that snapshot so
  the reactive proxy isn't serialized.
- When loading, raw data passes through `normalizeAppData()`; preserve the legacy
  migration path (`favoritePaths`/top-level todos → projects) when editing.

### Testing Requirements
- `tiling.ts` is the tested module — extend `tiling.test.ts` for any change to the
  tree algorithms (verify non-overlap + full-area coverage invariants).
- Other modules are integration-tested implicitly through the app; verify with
  `npm run check`.

### Common Patterns
- Pure functions over the immutable `TileNode` tree return new trees (structural
  sharing), never mutate in place.
- IDs come from `uid()` (crypto.randomUUID with a fallback).

## Dependencies

### Internal
- `components/` consumes all of these modules.

### External
- `@tauri-apps/api/core` — `invoke`, `Channel` (used by `api.ts`).
- `svelte` runes (in `.svelte.ts` files).

<!-- MANUAL: -->
