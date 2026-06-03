<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-06-02 | Updated: 2026-06-03 -->

# components

## Purpose
The Svelte 5 UI components that make up the three-panel window. The center panel
hosts the tiled terminals; the left and right panels are control surfaces that act
on the focused terminal and on persisted state.

## Key Files

| File | Description |
|------|-------------|
| `CenterPanel.svelte` | The workspace. Holds **one `PaneRuntime` per visited bucket** (a project id, or `UNFILED_KEY` when none is selected) in a `SvelteMap`, and renders *every* bucket's panes in one keyed `{#each}` — inactive buckets are mounted but `display:none` so their PTY sessions stay warm across project switches. Renders the profile launch bar; opens panes in the active project's cwd; splits/maximizes/closes panes on the active runtime; renders a draggable handle on every split boundary (`rt.dividers` → `setDividerRatio`, pointer-capture drag); lazily builds (restores) a bucket's runtime from its persisted `layout` once `app.loaded`; persists the live tree after every structural change; prunes runtimes for deleted projects; and parks a bucket (`bus.parkProject`) by dropping its runtime. |
| `TerminalPane.svelte` | A single xterm.js terminal bound to a backend PTY session. Creates the session via `api.createSession`, streams output in, forwards keystrokes/resizes out, and handles Ctrl+wheel / Ctrl +/-/0 font zoom through shared state. Takes a `visible` prop (its bucket is the shown one): only visible panes own `bus.send` / join the `sendAll` broadcast pool, and a pane re-fits + resizes its PTY when it becomes visible again (xterm can't measure under `display:none`). Shows a placeholder in standalone mode. |
| `LeftPanel.svelte` | Two tabs: **Project** (add/select projects, per-project todos; a live-session-count badge and a **park** button — shown on warm, non-active projects — via `bus.liveCounts` / `bus.parkProject`) and **Query** (save reusable query text and send it to the focused terminal via `bus.send`). |
| `RightPanel.svelte` | Two tabs: **Skills** (manage skill-root paths, browse via the Tauri dialog plugin, list discovered skills, insert `/<name>` into the focused terminal) and **Profiles** (edit launch profiles — color/name/command/distro/cwd/keepOpen — and reset to defaults). |

## For AI Agents

### Working In This Directory
- Terminal sessions are **per workspace bucket** (a project, or the Unfiled
  bucket). The *live* runtime (tiling tree, pane→profile map, focus/maximize)
  lives in `CenterPanel.svelte` as a `SvelteMap<bucketKey, PaneRuntime>` (see
  `../session.svelte.ts`); the *persisted* layout (a tree of profile references)
  lives in `Project.layout` / `AppData.unfiledLayout` and is what restores
  sessions on launch. Switching projects must NEVER unmount another bucket's
  panes (that kills its PTYs) — keep the single unified keyed `{#each}` that only
  toggles each layer's `display`.
- Runtime creation goes through `ensureRuntime()` only, and the warm/restore
  `$effect` is gated on `app.loaded` — `app.init()` is async, so building a
  runtime against the pre-load default `app.data` would shadow the real saved
  layout. Preserve both.
- Side panels never reference panes directly; they call `bus.send(text, enter?)`
  and gate on `bus.hasFocus`. The active **and visible** `TerminalPane` owns
  `bus.send`; ownership hand-off on project switch relies on the guarded relinquish
  (only clear `bus.send` if you still own it), so keep that guard.
- `TerminalPane` reacts to `app.data.terminalFontSize` via `$effect`: any pane (or
  Ctrl-zoom) that changes the size re-fits every pane and pushes new cols/rows to
  its PTY. Preserve the "skip if unchanged" guard to avoid resize loops.
- Pane sizing has two front-ends, both funnelling into one `setRatioAt` setter in
  `../tiling.ts`: a **drag handle** per split boundary (`CenterPanel`), and
  **Alt+Shift+Arrow** keys (`TerminalPane.onKey` → `bus.resizeDir` →
  `resizeFocused` → `resizePane`), which move the nearest divider of the matching
  axis Windows-Terminal-style. Changing a ratio re-lays the panes, and the per-pane
  `ResizeObserver` pushes the new cols/rows to each PTY — no extra wiring needed.
- Profiles are cloned with the bucket's project path as `cwd` (`prepareProfile`)
  so new sessions open in the selected project directory. The persisted layout
  stores only the profile **id** — the cwd is re-applied at spawn time, so it
  follows a project whose path later changes.
- Browser/standalone mode: guard backend calls (the dialog import in
  `RightPanel`, session creation in `TerminalPane`) so the UI still renders.

### Testing Requirements
- No component unit tests today; verify changes by running the app
  (`npm run tauri dev` on Windows, or `npm run dev` for browser/standalone UI).
- Run `npm run check` for Svelte/TS correctness.

### Common Patterns
- `$props()` for inputs (see `TerminalPane`'s `Props`), `$state`/`$derived` for
  local reactive state, `$effect` for side effects tied to focus/size.
- Keyed `{#each … (id)}` blocks for panes, projects, todos, queries, skills,
  profiles.
- Inline styles for one-off layout; shared classes (`.btn`, `.field`, `.list-row`,
  `.tab`, `.chip`) come from `src/app.css`.

## Dependencies

### Internal
- `../state.svelte.ts` (`app`), `../bus.svelte.ts` (`bus`), `../api.ts` (session
  IPC), `../tiling.ts` (tree ops), `../types.ts`, `../defaults.ts`.

### External
- `@xterm/xterm` + `@xterm/addon-fit` — terminal rendering and sizing
  (`TerminalPane`).
- `@tauri-apps/plugin-dialog` — folder picker (`RightPanel`, dynamically imported).

<!-- MANUAL: -->
