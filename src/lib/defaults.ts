import type { AppData, Profile, Project, Todo, SavedQuery } from './types';

/** Terminal font-size bounds and default, shared by all panes. */
export const DEFAULT_FONT_SIZE = 15;
export const MIN_FONT_SIZE = 6;
export const MAX_FONT_SIZE = 40;

/** Clamp an arbitrary value into the allowed font-size range. */
export function clampFontSize(px: number): number {
  if (!Number.isFinite(px)) return DEFAULT_FONT_SIZE;
  return Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, Math.round(px)));
}

export function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'id-' + Math.floor(Math.random() * 1e9).toString(36);
}

/** Seed profiles for a fresh install: claude, codex, and a plain WSL shell. */
export function defaultProfiles(): Profile[] {
  return [
    { id: 'claude', name: 'Claude', color: '#d97757', distro: '', cwd: '', command: 'claude', keepOpen: true },
    { id: 'codex', name: 'Codex', color: '#10a37f', distro: '', cwd: '', command: 'codex', keepOpen: true },
    { id: 'shell', name: 'WSL Shell', color: '#4a9eff', distro: '', cwd: '', command: '', keepOpen: false },
  ];
}

export function defaultAppData(): AppData {
  return {
    projects: [],
    activeProjectId: null,
    queries: [],
    profiles: defaultProfiles(),
    skillRoots: [],
    terminalFontSize: DEFAULT_FONT_SIZE,
  };
}

/**
 * Legacy shape (pre-projects): top-level todos/queries and favoritePaths.
 * Migrated into the projects model on load.
 */
interface LegacyAppData {
  todos?: Todo[];
  queries?: SavedQuery[];
  favoritePaths?: { id: string; label?: string; path: string }[];
  activePathId?: string | null;
}

/** Fill in any missing fields from a loaded blob so older state stays valid. */
export function normalizeAppData(raw: (Partial<AppData> & LegacyAppData) | null | undefined): AppData {
  const base = defaultAppData();
  if (!raw) return base;

  const projects: Project[] = Array.isArray(raw.projects)
    ? raw.projects.map((p) => ({
        id: p.id,
        name: typeof p.name === 'string' ? p.name : '',
        path: typeof p.path === 'string' ? p.path : '',
        todos: Array.isArray(p.todos) ? p.todos : [],
      }))
    : migrateLegacyProjects(raw);

  const activeProjectId =
    typeof raw.activeProjectId === 'string' && projects.some((p) => p.id === raw.activeProjectId)
      ? raw.activeProjectId
      : // Carry over the old "active favorite path" selection if present.
        typeof raw.activePathId === 'string' && projects.some((p) => p.id === raw.activePathId)
        ? raw.activePathId
        : null;

  return {
    projects,
    activeProjectId,
    // Queries are global; accept either the current top-level list or a legacy one.
    queries: Array.isArray(raw.queries) ? raw.queries : [],
    profiles: Array.isArray(raw.profiles) && raw.profiles.length ? raw.profiles : base.profiles,
    skillRoots: Array.isArray(raw.skillRoots) ? raw.skillRoots : [],
    terminalFontSize:
      typeof raw.terminalFontSize === 'number' ? clampFontSize(raw.terminalFontSize) : base.terminalFontSize,
  };
}

/**
 * Build the projects list from the legacy shape: each favorite path becomes a
 * project, and any old top-level todos are attached to the first one (or a
 * synthesized "General" project if there were no paths). Legacy queries are
 * preserved separately as global queries by the caller.
 */
function migrateLegacyProjects(raw: LegacyAppData): Project[] {
  const projects: Project[] = Array.isArray(raw.favoritePaths)
    ? raw.favoritePaths.map((f) => ({
        id: f.id,
        name: typeof f.label === 'string' ? f.label : '',
        path: f.path,
        todos: [],
      }))
    : [];
  const legacyTodos = Array.isArray(raw.todos) ? raw.todos : [];
  if (legacyTodos.length) {
    if (projects.length === 0) {
      projects.push({ id: uid(), name: 'General', path: '', todos: [] });
    }
    projects[0].todos = legacyTodos;
  }
  return projects;
}
