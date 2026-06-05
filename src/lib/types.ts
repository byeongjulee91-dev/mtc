/** A launch profile describes how a new terminal session is spawned. */
export interface Profile {
  id: string;
  name: string;
  /** Accent color (hex) for the profile chip / pane border. */
  color: string;
  /** WSL distro for `wsl.exe -d <distro>`. Empty = default distro. */
  distro: string;
  /** Working directory inside WSL (`--cd <cwd>`). Empty = login default. */
  cwd: string;
  /**
   * Command to run inside WSL after entering (e.g. "claude", "codex").
   * Empty = just an interactive login shell.
   */
  command: string;
  /** Keep an interactive shell open after `command` exits. */
  keepOpen: boolean;
  /**
   * Terminal backend on Windows: `'wsl'` (default) enters WSL via `wsl.exe`;
   * `'powershell'` launches Windows PowerShell; `'cmd'` launches the command
   * prompt. Ignored on Unix (always bash). For native shells `cwd` is a Windows
   * path and `distro` is unused.
   */
  shell: 'wsl' | 'powershell' | 'cmd';
}

export interface Todo {
  id: string;
  text: string;
  done: boolean;
}

export interface SavedQuery {
  id: string;
  name: string;
  text: string;
  /**
   * Optional keyboard shortcut digit (1–9). When set, pressing `Alt+<digit>`
   * sends this query's text to the focused terminal. A digit is unique across
   * all queries — assigning it to one query clears it from any other.
   * `null` = no shortcut.
   */
  hotkey: number | null;
  /**
   * Insert mode. `true` (default) appends the text *and* presses Enter so the
   * query is submitted immediately; `false` only appends the text and leaves it
   * on the prompt for the user to edit before submitting. Applies to the ➤ /
   * ⇶ buttons and the `Alt+<digit>` shortcut — dragging a query onto a pane is
   * always append-only.
   */
  submit: boolean;
}

/** A discovered skill (a directory containing SKILL.md). */
export interface Skill {
  name: string;
  description: string;
  path: string;
}

/** A group of skills sharing one source root. */
export interface SkillGroup {
  /** The root the skills were found under (resolved path), used as the header. */
  root: string;
  /**
   * `'wsl'` = scanned inside WSL (only a WSL terminal can use them);
   * `'host'` = scanned on the host filesystem (a native shell can use them).
   */
  kind: 'wsl' | 'host';
  skills: Skill[];
}

/** Result of skill discovery: skills grouped by the root they were found under. */
export interface SkillDiscovery {
  groups: SkillGroup[];
}

/**
 * Persisted tiling layout for a workspace's terminal sessions. It mirrors the
 * runtime `TileNode` tree (see `tiling.ts`) but leaves reference a *profile id*
 * instead of a live numeric pane id, so a layout can be saved across runs and
 * re-spawned into fresh sessions. A leaf whose `profileId` no longer resolves
 * (profile deleted) is dropped on restore.
 */
export type LayoutNode = LayoutLeaf | LayoutSplit;

export interface LayoutLeaf {
  kind: 'leaf';
  profileId: string;
}

export interface LayoutSplit {
  kind: 'split';
  dir: 'v' | 'h';
  ratio: number;
  first: LayoutNode;
  second: LayoutNode;
}

/**
 * A project is a working directory with its own todos. Selecting a project sets
 * where new sessions open (`path` is passed to WSL as `--cd <path>`, so it is a
 * Linux-style path like `/mnt/c/Users/me/project` or `~/work`) and scopes the
 * Todo tab to that project. Queries stay global.
 */
export interface Project {
  id: string;
  /** Friendly name shown in the list. Falls back to `path` when empty. */
  name: string;
  path: string;
  /**
   * Optional keyboard shortcut digit (1–9). When set, pressing `Ctrl+<digit>`
   * switches to (selects) this project. A digit is unique across all projects —
   * assigning it to one project clears it from any other. `null` = no shortcut.
   * Mirrors `SavedQuery.hotkey`, but on the `Ctrl` modifier instead of `Alt`.
   */
  hotkey: number | null;
  todos: Todo[];
  /**
   * Profiles scoped to this project. They appear after the global
   * (`AppData.profiles`) ones, but only while this project is active.
   */
  profiles: Profile[];
  /**
   * Persisted terminal layout for this project: the tiling tree of sessions
   * (by profile reference) that is re-spawned when the project is first opened
   * in a run. `null` = no remembered layout (start empty). Live sessions stay
   * warm across in-run project switches; this only drives restore on launch and
   * after a manual park.
   */
  layout: LayoutNode | null;
}

/** Persisted application data (projects, global queries, profiles, skills). */
export interface AppData {
  /** Projects: a working directory with its own todos. */
  projects: Project[];
  /** Id of the selected project. `null` = none selected. */
  activeProjectId: string | null;
  /** Saved queries, shared across all projects. */
  queries: SavedQuery[];
  profiles: Profile[];
  /**
   * Persisted layout for the "Unfiled" workspace — sessions opened while no
   * project is selected. Mirrors `Project.layout`. `null` = none.
   */
  unfiledLayout: LayoutNode | null;
  /** Directories scanned for skills (host paths or \\wsl.localhost\... UNC paths). */
  skillRoots: string[];
  /** Shared xterm font size (px) applied to every terminal pane. */
  terminalFontSize: number;
  /** Width (px) of the left panel. Driven by the drag divider. */
  leftPanelWidth: number;
  /** Whether the left panel is collapsed (hidden). */
  leftPanelCollapsed: boolean;
  /** Width (px) of the right panel. Driven by the drag divider. */
  rightPanelWidth: number;
  /** Whether the right panel is collapsed (hidden). */
  rightPanelCollapsed: boolean;
}
