<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-06-02 | Updated: 2026-06-02 -->

# src

## Purpose
The Svelte 5 frontend. This directory holds the application entry point, the
top-level layout shell, and global styles; all reusable logic and components live
under `lib/`. The frontend renders the three-panel UI (projects/queries, tiled
terminals, skills/profiles) and talks to the Rust backend over Tauri IPC.

## Key Files

| File | Description |
|------|-------------|
| `main.ts` | Entry point. Mounts `App.svelte` into `#app` using Svelte 5's `mount()` API and imports global CSS. |
| `App.svelte` | Root layout: a CSS grid of `LeftPanel`, `CenterPanel`, and `RightPanel`. Calls `app.init()` on mount and wires the global Alt+digit query shortcuts. |
| `app.css` | Global styles and CSS custom properties (the dark theme tokens: `--bg`, `--panel`, `--border-focus`, panel widths, etc.). The `.app` grid template lives here. |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `lib/` | State, IPC client, tiling logic, types, and UI components (see `lib/AGENTS.md`) |

## For AI Agents

### Working In This Directory
- `main.ts` uses `mount(App, …)` — the Svelte 5 mounting API, not the legacy
  `new App({ target })` constructor. Keep it that way.
- Layout structure (grid columns/rows) is split between `App.svelte` markup and
  the `.app` rule in `app.css`; change both together.

### Testing Requirements
- `npm test` runs vitest (currently exercises `lib/tiling.ts`).
- `npm run check` runs svelte-check for type/markup errors before a build.

### Common Patterns
- Svelte 5 runes only (`$state`, `$derived`, `$effect`, `$props`).
- Global, non-component state is imported from `lib/state.svelte.ts` as the `app`
  singleton; the shared terminal sender from `lib/bus.svelte.ts` as `bus`.

## Dependencies

### Internal
- `lib/` — every component and the `app`/`bus` singletons.

### External
- `svelte` — `mount`, `onMount`, runes.

<!-- MANUAL: -->
