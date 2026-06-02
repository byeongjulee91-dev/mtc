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
}

/** A discovered skill (a directory containing SKILL.md). */
export interface Skill {
  name: string;
  description: string;
  path: string;
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
  todos: Todo[];
  /**
   * Profiles scoped to this project. They appear after the global
   * (`AppData.profiles`) ones, but only while this project is active.
   */
  profiles: Profile[];
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
  /** Directories scanned for skills (host paths or \\wsl.localhost\... UNC paths). */
  skillRoots: string[];
  /** Shared xterm font size (px) applied to every terminal pane. */
  terminalFontSize: number;
}
