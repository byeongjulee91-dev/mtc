# mtc — Design System

> The canonical reference for mtc's visual language. Every color and size below is
> greppable in `src/app.css` (the `:root` token block + component rules),
> `src/lib/defaults.ts` (numeric defaults/bounds), or the inline styles in
> `src/lib/components/*.svelte`. If a value isn't in the code, it doesn't belong here.

## Overview

mtc's surface is a **near-black IDE chrome** (`var(--bg)` — #0e1116) that exists only
to frame its real content: the **live terminal panes** running `claude`, `codex`, or a
shell. The chrome has no decorative voltage of its own — energy comes from the terminal
output itself (pure-black `#000` panes filled with colored program output). The UI around
the terminals stays deliberately quiet: thin dark surfaces stacked in three tonal steps,
1px hairline dividers (`var(--border)`), small uppercase section labels, and flat buttons
that only light up on hover. Where BMW M backs its chrome off to let full-bleed photography
fill the frame, mtc backs its chrome off to let the **terminals** be the focal content.

The system's signature marker — its equivalent of a brand stripe — is the **two-accent
split**. Cyan `var(--border-focus)` (#00d7ff) means *this is live / focused / where your
keystrokes go*: the focused pane border, the terminal cursor, the active resize handle.
Blue `var(--accent)` (#4a9eff) means *this is interactive / hover / a hint*: button hover
borders, the assigned-hotkey chip, the live-session count. Cyan is state; blue is affordance. Keeping
the two roles distinct is the one subtle thing a reader would otherwise miss.

Type runs a single **system sans-serif** stack for all chrome and a **monospace** stack
inside the terminals. There is no display/body weight contrast to manage — the chrome is
intentionally small (13px base) and uniform so it recedes; the visual hierarchy comes from
tonal surface steps and the accent split, not from type scale.

**Key Characteristics:**
- Near-black IDE canvas (`var(--bg)` — #0e1116) with light cool-gray text
  (`var(--text)` — #d7dce5). The system inverts nothing — there is no light mode.
- Depth via three stacked surface tones — `var(--bg)` → `var(--panel)` (#161a22) →
  `var(--panel-2)` (#1d222c) — separated by 1px `var(--border)` hairlines, **never**
  drop shadows.
- The **two-accent system**: cyan `var(--border-focus)` for live/focused state, blue
  `var(--accent)` for hover/interactive affordance. They are not interchangeable.
- Terminal panes are pure `#000` and fill their tile edge-to-edge — the output is the
  content; chrome is a 1px border and a 11px header strip.
- A fixed three-column shell: left panel (projects/queries) · center (tiled terminals) ·
  right panel (skills/profiles), divided by 1px gaps that show the border color through.
- Border radius is small and functional: 4–6px on chips/buttons/inputs, 999px on pills
  and status dots, 0 on terminal panes. There is no formal radius or spacing token scale —
  values are literal px (documented below).
- Density over whitespace: padding is 2–12px, gaps are 1/6/8px. This is a developer tool
  meant to pack many sessions and lists into one window.

## Colors

All theme colors are CSS custom properties declared in `:root` (`src/app.css`). Reference
them as `var(--name)` — never inline the hex.

### Accent (the two-accent system)
- **Focus / Live** (`var(--border-focus)` — #00d7ff): Cyan. Marks the *active, live*
  surface — the focused pane border (`.pane.focused`), the xterm cursor, the active drag
  divider, the drag-over drop outline. This is the closest thing to a brand color.
- **Interactive / Hint** (`var(--accent)` — #4a9eff): Blue. Hover borders on buttons,
  tabs, chips, and inputs; the assigned-hotkey chip; the live-session count badge; the project
  active-mark (`.path-mark`). Signals "you can act here," not "this is live."

### Surface (the three-tone depth ladder)
- **Canvas** (`var(--bg)` — #0e1116): The window floor and the background of focused
  inputs/fields. The center area and the 1px grid gaps also resolve to this/the border.
- **Panel** (`var(--panel)` — #161a22): Side-panel and pane-header background — one step
  up from canvas.
- **Panel Elevated** (`var(--panel-2)` — #1d222c): Buttons, chips, the active tab,
  selectable-row hover, badges, the reveal tab — two steps up. The top of the ladder.
- **Terminal Black** (`#000` / `#000000`): The terminal pane background (`.pane`) and the
  xterm theme background. Pure black, distinct from the chrome canvas — a *not-yet-tokenized*
  literal (see Known Gaps).

### Hairlines & Borders
- **Hairline** (`var(--border)` — #2a313d): The 1px divider tone everywhere — panel heads,
  section heads, list rows, pane borders, input outlines, and the 1px grid gaps between the
  three columns (the grid background is `var(--border)`, showing through the `gap: 1px`).

### Text
- **Ink** (`var(--text)` — #d7dce5): Primary text and the xterm foreground. Cool light gray,
  not pure white.
- **Muted** (`var(--muted)` — #7d8694): Section labels, captions, secondary metadata,
  empty-state copy, placeholder-level hints, pane-header titles.

### Profile Colors (user data, not theme tokens)
Profile dots and the focused-pane accent are driven by per-profile `color` values, seeded in
`defaultProfiles()` (`src/lib/defaults.ts`). These are **semantic, per-tool** colors the user
can edit — they are *not* part of the theme palette:
- **Claude** — #d97757 (Anthropic terracotta)
- **Codex** — #10a37f (OpenAI green)
- **WSL Shell** — #4a9eff (blue; also the new-profile default)
- **PowerShell** — #5391fe (PowerShell blue)

### Inline / not-yet-tokenized colors
Documented for honesty (see Known Gaps) — these appear as raw hex in the code rather than
`var(--…)`: selected list row `#243042`; terminal selection `#264f78` /
`#264f7866` (inactive); scrollbar thumb hover `#3a4350`.

## Typography

### Font Families
- **Chrome (UI):** `ui-sans-serif, system-ui, "Segoe UI", Roboto, sans-serif` — set once on
  `:root`. The system font on each platform; no web font is loaded.
- **Terminal:** `ui-monospace, "Cascadia Code", "Consolas", monospace` — set on the xterm
  instance in `TerminalPane.svelte`.

There is deliberately **no display typeface and no weight-pair**. The chrome is small and
uniform so it recedes behind the terminals; hierarchy is carried by surface tone and the
accent split, not by type scale.

### Hierarchy (observed scale)
The system has no `{typography.*}` token file. The sizes actually in use:

| Context | Size | Weight | Treatment |
|---|---|---|---|
| Base / body / list rows | 13px | normal | `:root` default |
| Panel head, empty states | 12px | 600 | UPPERCASE, `letter-spacing: 0.04em` (panel head) |
| Section head, pane head, captions, hints, query text | 11px | 600 (heads) / normal | UPPERCASE on section head |
| Saved-query chips, live badge | 10px | 600 | — |
| Terminal text | 15px default (6–40) | normal | monospace; `DEFAULT_FONT_SIZE`, Ctrl+wheel zoom |

### Principles
- UPPERCASE + `letter-spacing: 0.04em` + weight 600 is the "section label" voice
  (`.panel-head`, `.section-head`, the right-panel group headers). It is the only
  typographic flourish in the system.
- Everything else is sentence-case at the 13px base, or 10–12px muted for secondary lines.
- Terminal font size is shared across all panes (`app.data.terminalFontSize`) — zooming one
  pane re-fits and resizes every pane in lockstep.

## Layout

### Spacing System
- **No formal token scale.** Values are literal px. The recurring rhythm: **1px** (grid
  gaps), **2px** (tight icon padding, pane-head), **6px** (the default flex `gap` and
  list-row gap), **8px** (panel/content padding), **12px** (empty-state padding). Larger
  values (20/24/28/64px) appear only as fixed control dimensions (e.g. the reveal tab's
  24×64px target and its 20px hover-zone).
- **List rows:** `padding: 4px 8px`, `gap: 6px`.
- **Panel / section heads:** `padding: 6px 8px`.
- **Content blocks** (add-project, add-todo, query editor): `padding: 8px`, `gap: 6px`.
- **Profile rows:** `padding: 8px`, `gap: 5px`.

### Grid & Container
- **Shell:** a CSS grid `grid-template-columns: var(--left-w) 1fr var(--right-w)` with
  `gap: 1px` over a `var(--border)` background, so the gaps read as hairlines.
- **Left panel:** default 280px, clamped 180–640 (`DEFAULT/MIN/MAX_LEFT_WIDTH`).
- **Right panel:** default 320px, clamped 180–640 (`DEFAULT/MIN/MAX_RIGHT_WIDTH`).
- **Center:** `1fr` — a vertical flex of the profile bar (toolbar) over the `.tiles` area.
- **Tiles:** terminal panes positioned absolutely by percentage from a BSP split tree
  (`src/lib/layout.ts` / `tiling.ts`), not a CSS grid.

### Whitespace Philosophy
mtc trusts the terminals to do the visual work, the way BMW trusts photography. Chrome
whitespace is minimal and uniform — the goal is to fit many sessions, todos, queries,
skills, and profiles into one window without scrolling chrome. Empty space inside the
center stays as empty `#000` terminal canvas. No atmospheric backdrops, gradients, or
decorative spacing.

## Elevation & Depth

| Level | Treatment | Use |
|---|---|---|
| Flat | No shadow, no border | Center area, terminal interiors |
| Surface step | One tone up (`--panel` / `--panel-2`) over canvas | Panels, buttons, chips, active tab |
| Hairline | 1px `var(--border)` | Panel/section dividers, list rows, pane borders, input outlines, grid gaps |
| Focus ring | `border-color: var(--border-focus)` + `z-index` | The focused pane (`.pane.focused`) |
| Drop-target | 2px dashed `var(--border-focus)` + 12% `color-mix` fill | A pane while a todo/query is dragged over it |

The system uses **no drop shadows**. Depth is the three-tone surface ladder plus 1px
hairlines. The only "lift" effects are functional: a `backdrop-filter: blur(2px)` behind the
hover-revealed `.row-actions` cluster, and an `inset` box-shadow as the profile-reorder
drop indicator. Photography's role (depth via subject + lighting) is played here by the
terminal output itself.

## Shapes

### Border Radius (observed)
No token scale — literal px:

| Value | Use |
|---|---|
| 0 | Terminal panes (`.pane`), the grid shell — sharp by default |
| 4px | Saved-query chips (`.chip-select`, `.chip-mode`) |
| 5px | Buttons (`.btn`), tabs (`.tab`), inputs (`.field`), the compose select (`.select-lg`) |
| 6px | Reveal tab, `.row-actions` cluster, scrollbar thumb |
| 999px / 50% | Pills (`.chip`, `.cwd-hint`, `.live-badge`) and status dots (`.dot`, `.path-mark`) |

The hierarchy is "small functional rounding on controls, fully round on pills/dots, sharp on
the work surface." Terminal panes stay at 0 so the work area reads as a precise grid.

## Components

### Shell & Panels
- **`.app`** — the three-column grid shell. Adds `.resizing` (col-resize cursor +
  no-select) while a divider is dragged. Sets `--left-w`/`--right-w` inline so a collapsed
  panel resolves to width 0.
- **`.panel`** — a side panel: `var(--panel)` background, vertical flex of `.panel-head`
  over `.panel-body`.
- **`.panel-head`** — 600-weight UPPERCASE label strip with a bottom hairline; holds the
  panel's tabs and a hide button.
- **`.panel-body`** — the scrolling content region (`overflow-y: auto`).
- **`.section-head`** — an in-panel divider (e.g. "Todo · <project>"): `var(--panel-2)`
  background, top+bottom hairline, UPPERCASE 11px.

### Resize & Reveal
- **`.resize-handle`** (`.left` / `.right`) — a 7px-wide invisible strip over the gap
  between a panel and the center; drag to resize, double-click to collapse. Lights up
  `var(--border-focus)` at 0.5 opacity on hover/while dragging.
- **`.pane-divider`** (`.v` / `.h`) — the same 7px invisible handle, but on every split
  boundary *between terminal panes*: drag to rebalance the two sides. `.v` is a vertical
  line (`col-resize`), `.h` a horizontal one (`row-resize`); both light up like the panel
  handle on hover/drag. While a drag is live the `.tiles` container forces the resize
  cursor and suppresses selection (`.tiles.drag-v` / `.drag-h`).
- **`.reveal-zone`** + **`.reveal-tab`** — when a panel is collapsed, a 20px edge hover-zone
  fades in a 24×64px tab (`opacity 0 → 1`) to bring the panel back. The tab is pinned to the
  **vertical middle** of the window (drawer-handle position) so it clears the top-right
  toolbar close button. Functional hover (see Do's & Don'ts).

### Controls
- **`.btn`** / **`.btn.icon`** / **`.btn.accent`** — flat button: `var(--panel-2)` fill, 1px
  `var(--border)`, radius 5px. Hover sets `border-color: var(--accent)`. `.icon` is the compact
  square variant used for the per-row action glyphs (✕ ✎ ➤ ⧉ …); `.accent` is the emphasised
  (primary) variant — accent border + text — for the confirming action in a dialog.
- **`.tab`** / **`.tab.active`** — text-only panel tab; active state fills `var(--panel-2)`
  and switches text from `var(--muted)` to `var(--text)`.
- **`.field`** (input/textarea) — full-width form input: `var(--bg)` fill, 1px border,
  radius 5px, inherits font.
- **`.select-lg`** — the full-size `var(--panel-2)` dropdown in the query compose form
  (insert mode for the query being saved); matches `.btn` height at the 13px base.

### Center / Terminals
- **`.profile-bar`** — the center toolbar: an icon split-direction toggle (a `.btn.icon`
  showing ◧ side-by-side / ⬓ stacked, flipping on click) at the left that sets which direction
  a launcher chip opens its new pane in, then the launcher chips for each visible profile, the
  cwd hint, and the split/equalize/maximize/close pane controls on the right.
- **`.chip`** + **`.dot`** — a profile launcher: rounded 999px pill with a colored status
  dot (the profile's `color`) and name. Hover borders `var(--accent)`. Clicking opens a new
  pane with that profile.
- **`.cwd-hint`** — a muted 999px pill showing the active project's directory ("📁 name"),
  signalling where new sessions will open.
- **`.tiles`** — the absolute-positioned tiling area. Each visited workspace renders a
  full-bleed `.project-layer` (`inset: 0`); only the active layer is shown, the rest stay
  mounted via `display:none` to keep their PTY sessions warm.
- **`.pane`** / **`.pane.focused`** — a terminal tile: `#000` background, 1px border, absolute
  `left/top/width/height` in %. Focused state swaps the border to `var(--border-focus)` and
  raises `z-index`.
- **`.pane-head`** — the 11px pane header: a colored dot (profile color), the profile
  name/command, and a close button.
- **`.pane-term`** — the xterm host. `.drag-over` overlays a 2px dashed cyan drop outline
  when a todo/query is dragged onto it. Carries the themed `::-webkit-scrollbar` styling so
  the scrollbar blends into the black terminal.
- **`.center-empty`** — centered muted empty state ("No sessions open · Pick a profile
  above") shown when the active workspace has no panes.

### Lists & Rows
- **`.list-row`** / **`.list-row.sel`** / **`.list-row.top`** — the generic row: hover fills
  `var(--panel-2)`; selected fills `#243042`; `.top` aligns to flex-start for wrapped
  multi-line content (todos, queries).
- **`.row-float`** + **`.row-actions`** — rows whose action buttons float over the
  bottom-right corner and fade in on hover/focus-within (`opacity 0 → 1`,
  `backdrop-filter: blur(2px)`), giving the text full width.
- **`.path-pick`** + **`.path-mark`** — the project selector row; `.path-mark` is the
  ●/○ active indicator in `var(--accent)`.
- **`.empty`** — muted 12px empty-state / helper copy block.

### Badges & Chips
- **`.chip-select`** — the always-visible hotkey chip on a saved query: a styled
  (`appearance:none`) `<select>` that opens the Alt+digit picker on click. Muted
  ("No hotkey") when unassigned; flips to the `var(--accent)` 12%-tint affordance once a
  digit is bound (`.assigned`). Picking a digit another query owns opens a confirm modal
  ("Reassign shortcut?") rather than silently stealing it. Its option rows are pinned to
  `var(--panel-2)` so the open dropdown matches the chrome.
- **`.chip-mode`** — the always-visible insert-mode chip on a saved query: a muted toggle
  button reading "↵ Submit" / "… Append" that flips the mode on click. Both chips live on the
  title line so the hover `.row-actions` cluster can stay narrow (no per-row selects),
  keeping the panel legible at its 180px min width.
- **`.live-badge`** — a 999px count pill (`var(--accent)` fill, `var(--bg)` text) on a
  project row showing how many warm sessions it holds.

### Right Panel (Profiles)
- **`.profile-row`** — the profile editor card: color picker, name field, shell select
  (WSL/PowerShell/cmd), command/distro/cwd fields, and a keep-open checkbox. Draggable to
  reorder; `.drag-over` shows an `inset 0 2px 0 0 #4a9eff` top indicator.
- **`.grip`** — the ⠿ drag handle (opacity 0.45 → 0.9 on hover, grab/grabbing cursors).

## Do's and Don'ts

### Do
- Reference theme colors as `var(--…)`; pull values from the `:root` block in `app.css`.
- Keep the two-accent split honest: cyan `var(--border-focus)` for live/focused state, blue
  `var(--accent)` for hover/interactive affordance.
- Build depth from the three surface tones + 1px hairlines, not shadows.
- Keep terminal panes pure `#000` with radius 0 — the output is the content.
- Use the UPPERCASE + `0.04em` + 600 voice for section/panel labels; sentence-case at 13px
  for everything else.
- Preserve dual-mode: every component must render in standalone (`npm run dev`, no backend)
  as well as inside Tauri — keep the graceful fallbacks.
- Keep new `#[tauri::command]` / `invoke(…)` / `Profile` field changes in lockstep on both
  sides (see CLAUDE.md invariants).

### Don't
- Don't introduce a third chrome accent. Two accents (cyan/blue) carry all state + affordance.
- Don't add drop shadows or gradients for depth — step the surface tone instead.
- Don't round terminal panes or the grid shell; sharp corners are the work-surface language.
- Don't treat profile colors (#d97757/#10a37f/…) as theme tokens — they're editable user
  data with per-tool semantics.
- Don't add a light mode or invert surfaces — the system is dark-only by design.
- Don't inline new hex when a `var(--…)` token already covers it (and prefer promoting the
  remaining raw-hex values, not adding more — see Known Gaps).

## Adaptive Behavior

mtc is a single desktop window — there are **no responsive breakpoints**. "Adaptation" here
is the user reshaping their workspace, all persisted to `app.data`:

- **Panel resize** — drag the `.resize-handle` between a panel and the center. Left clamps
  180–640 (default 280); right clamps 180–640 (default 320). Pointer capture keeps the drag
  alive over a terminal.
- **Panel collapse / reveal** — double-click a divider (or the hide button) to collapse a
  panel to width 0; an edge `.reveal-zone` then fades in a `.reveal-tab` to bring it back.
- **Pane tiling** — launcher chips open a new pane split off the focused one in the direction
  set by the profile bar's split-direction toggle (◧ side-by-side, the default / ⬓ stacked).
  The ◧/⬓ toolbar buttons and the Alt+Shift+= / Alt+Shift+- shortcuts clone the focused pane
  in an explicit direction. Move focus with Alt+Arrow, maximize/restore with Alt+Enter,
  equalize, and close with Ctrl+W. Resize a pane by dragging the `.pane-divider` on a split
  boundary or with Alt+Shift+Arrow (Windows-Terminal style — the nearest divider of that axis
  moves). Panes are positioned by % from a BSP tree so they reflow as the window resizes.
- **Terminal font zoom** — Ctrl+wheel or Ctrl +/-/0 adjusts the shared terminal font size,
  clamped 6–40 (default 15). Every pane re-fits and the new cols/rows are pushed to each PTY.
- **Per-workspace warm sessions** — switching projects swaps the visible `.project-layer`
  while keeping others mounted (`display:none`) so their PTYs stay warm; an LRU cap
  (`MAX_WARM_BUCKETS`) parks the least-recently-used workspace's sessions to bound memory.

### Drag & Drop
- Todos and saved queries are draggable; dropping one on a `.pane-term` inserts its text
  into *that* session (no Enter), highlighted by the `.drag-over` cyan outline.
- Profile rows drag to reorder within their scope (global / project).

## Iteration Guide

1. Focus on ONE component at a time; reference its class (`.pane`, `.chip`, `.section-head`).
2. New surfaces pick a tone from the ladder (`--panel` or `--panel-2`); new dividers use 1px
   `var(--border)`.
3. New radii follow the observed scale (5px controls, 999px pills, 0 work surface) — don't
   invent in-between values.
4. Use `var(--…)` tokens for color; reach for raw hex only when matching an existing
   not-yet-tokenized value, and note it.
5. State color is cyan, affordance color is blue — never swap them.
6. When adding chrome, ask whether it earns its pixels against terminal space — density wins.
7. Keep the change working in both standalone and Tauri modes before declaring done.

## Known Gaps

- **No design-token files.** mtc has CSS custom properties for *colors* only; there is no
  spacing, radius, or typography token scale — those are literal px throughout. This doc
  records the observed scales rather than a formal system.
- **Raw hex not promoted to variables:** the selected-row `#243042`, the terminal-selection
  `#264f78` / `#264f7866`, the scrollbar-hover `#3a4350`, and the pure-black `#000` terminal
  background all live as inline hex rather than `var(--…)`. Candidates for tokenization.
- **Hover is documented here on purpose.** BMW's guide says "never document hover," but
  mtc's hover affordances are *functional, not decorative* — the reveal-tab fade-in and the
  `.row-actions` reveal are how features become reachable — so they're documented as a
  deliberate deviation.
- **No light mode and no theming hooks** beyond the `:root` variables — the system is
  dark-only. `:root` also sets `color-scheme: dark` so native controls (the `<select>`
  dropdown popup, scrollbars) render dark instead of the browser's default light chrome.
- **Animation/transition timings** are minimal (`opacity 0.12s ease` on reveals) and not
  treated as a system; motion is out of scope.
- **Profile colors** are user-editable data, not a fixed palette; the seeded values are
  defaults only.
