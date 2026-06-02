<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-06-02 | Updated: 2026-06-02 -->

# components

## Purpose
The Svelte 5 UI components that make up the three-panel window. The center panel
hosts the tiled terminals; the left and right panels are control surfaces that act
on the focused terminal and on persisted state.

## Key Files

| File | Description |
|------|-------------|
| `CenterPanel.svelte` | The workspace. Owns the local tiling tree (`TileNode`), pane→profile map, focus and maximize state. Renders the profile launch bar and absolutely-positions each pane from `computeTiles`. Opens new panes in the active project's cwd; splits, maximizes, and closes panes. |
| `TerminalPane.svelte` | A single xterm.js terminal bound to a backend PTY session. Creates the session via `api.createSession`, streams output in, forwards keystrokes/resizes out, registers `bus.send` while focused, and handles Ctrl+wheel / Ctrl +/-/0 font zoom through shared state. Shows a placeholder in standalone mode. |
| `LeftPanel.svelte` | Two tabs: **Project** (add/select projects, per-project todos) and **Query** (save reusable query text and send it to the focused terminal via `bus.send`). |
| `RightPanel.svelte` | Two tabs: **Skills** (manage skill-root paths, browse via the Tauri dialog plugin, list discovered skills, insert `/<name>` into the focused terminal) and **Profiles** (edit launch profiles — color/name/command/distro/cwd/keepOpen — and reset to defaults). |

## For AI Agents

### Working In This Directory
- The tiling tree state lives **in `CenterPanel.svelte`**, not in the global
  store — pane layout is ephemeral and per-window. Only `terminalFontSize` (in
  `app` state) is shared/persisted across panes.
- Side panels never reference panes directly; they call `bus.send(text, enter?)`
  and gate on `bus.hasFocus`. The focused `TerminalPane` owns `bus.send` and must
  clear it on destroy if it still owns it (see the `onDestroy` guard).
- `TerminalPane` reacts to `app.data.terminalFontSize` via `$effect`: any pane (or
  Ctrl-zoom) that changes the size re-fits every pane and pushes new cols/rows to
  its PTY. Preserve the "skip if unchanged" guard to avoid resize loops.
- Profiles passed to `addPane`/`openProfile` are cloned with the active project's
  path as `cwd` so new sessions open in the selected project directory.
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
