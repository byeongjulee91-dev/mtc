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

/** Persisted application data (todos, queries, profiles, skill roots). */
export interface AppData {
  todos: Todo[];
  queries: SavedQuery[];
  profiles: Profile[];
  /** Directories scanned for skills (host paths or \\wsl.localhost\... UNC paths). */
  skillRoots: string[];
  /** Shared xterm font size (px) applied to every terminal pane. */
  terminalFontSize: number;
}
