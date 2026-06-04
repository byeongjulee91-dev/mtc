import type { AppData, LayoutNode, Profile, Project, Todo, SavedQuery } from './types';

/**
 * Bucket key for the "Unfiled" workspace — sessions opened while no project is
 * selected. A real project id is a uuid, so this sentinel can never collide.
 */
export const UNFILED_KEY = '__unfiled__';

/** Terminal font-size bounds and default, shared by all panes. */
export const DEFAULT_FONT_SIZE = 15;
export const MIN_FONT_SIZE = 6;
export const MAX_FONT_SIZE = 40;

/** Clamp an arbitrary value into the allowed font-size range. */
export function clampFontSize(px: number): number {
  if (!Number.isFinite(px)) return DEFAULT_FONT_SIZE;
  return Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, Math.round(px)));
}

/** Left-panel width bounds and default (px), used by the drag divider. */
export const DEFAULT_LEFT_WIDTH = 280;
export const MIN_LEFT_WIDTH = 180;
export const MAX_LEFT_WIDTH = 640;

/** Clamp an arbitrary value into the allowed left-panel width range. */
export function clampLeftWidth(px: number): number {
  if (!Number.isFinite(px)) return DEFAULT_LEFT_WIDTH;
  return Math.min(MAX_LEFT_WIDTH, Math.max(MIN_LEFT_WIDTH, Math.round(px)));
}

/** Right-panel width bounds and default (px), used by the drag divider. */
export const DEFAULT_RIGHT_WIDTH = 320;
export const MIN_RIGHT_WIDTH = 180;
export const MAX_RIGHT_WIDTH = 640;

/** Clamp an arbitrary value into the allowed right-panel width range. */
export function clampRightWidth(px: number): number {
  if (!Number.isFinite(px)) return DEFAULT_RIGHT_WIDTH;
  return Math.min(MAX_RIGHT_WIDTH, Math.max(MIN_RIGHT_WIDTH, Math.round(px)));
}

export function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'id-' + Math.floor(Math.random() * 1e9).toString(36);
}

/**
 * Seed profiles for a fresh install: Claude (WSL), Claude on PowerShell, codex,
 * a WSL shell, and a plain PowerShell.
 */
export function defaultProfiles(): Profile[] {
  return [
    { id: 'claude', name: 'Claude', color: '#d97757', distro: '', cwd: '', command: 'claude', keepOpen: true, shell: 'wsl' },
    { id: 'claude-powershell', name: 'Claude (PS)', color: '#d97757', distro: '', cwd: '', command: 'claude', keepOpen: true, shell: 'powershell' },
    { id: 'codex', name: 'Codex', color: '#10a37f', distro: '', cwd: '', command: 'codex', keepOpen: true, shell: 'wsl' },
    { id: 'shell', name: 'WSL Shell', color: '#4a9eff', distro: '', cwd: '', command: '', keepOpen: false, shell: 'wsl' },
    { id: 'powershell', name: 'PowerShell', color: '#5391fe', distro: '', cwd: '', command: '', keepOpen: false, shell: 'powershell' },
  ];
}

/** Coerce a loaded profile blob into a valid `Profile`, defaulting `shell`. */
function normalizeProfile(p: Partial<Profile> & { id: string }): Profile {
  const shell = p.shell === 'powershell' || p.shell === 'cmd' ? p.shell : 'wsl';
  return {
    id: p.id,
    name: typeof p.name === 'string' ? p.name : '',
    color: typeof p.color === 'string' ? p.color : '#4a9eff',
    distro: typeof p.distro === 'string' ? p.distro : '',
    cwd: typeof p.cwd === 'string' ? p.cwd : '',
    command: typeof p.command === 'string' ? p.command : '',
    keepOpen: !!p.keepOpen,
    shell,
  };
}

/**
 * Coerce a loaded blob into a valid `LayoutNode` tree, or `null` when it is
 * missing/malformed. Recurses defensively so a corrupt persisted layout can
 * never crash startup — any bad subtree collapses to `null`.
 */
function normalizeLayout(raw: unknown): LayoutNode | null {
  if (!raw || typeof raw !== 'object') return null;
  const node = raw as Record<string, unknown>;
  if (node.kind === 'leaf') {
    return typeof node.profileId === 'string' ? { kind: 'leaf', profileId: node.profileId } : null;
  }
  if (node.kind === 'split') {
    const first = normalizeLayout(node.first);
    const second = normalizeLayout(node.second);
    // A split needs both children; if one is gone, the survivor takes its place.
    if (!first) return second;
    if (!second) return first;
    const dir = node.dir === 'h' ? 'h' : 'v';
    const ratio = typeof node.ratio === 'number' && Number.isFinite(node.ratio) ? node.ratio : 0.5;
    return { kind: 'split', dir, ratio, first, second };
  }
  return null;
}

/** Coerce a hotkey blob into a valid digit (1–9) or `null`. */
function normalizeHotkey(h: unknown): number | null {
  if (typeof h !== 'number' || !Number.isFinite(h)) return null;
  const n = Math.floor(h);
  return n >= 1 && n <= 9 ? n : null;
}

/**
 * Coerce a loaded query list into valid `SavedQuery` objects and enforce hotkey
 * uniqueness: if two queries claim the same digit, the first keeps it and the
 * rest are cleared. Older state (no `hotkey`) loads with `null`.
 */
function normalizeQueries(raw: unknown): SavedQuery[] {
  if (!Array.isArray(raw)) return [];
  const taken = new Set<number>();
  return raw
    .filter((q): q is Partial<SavedQuery> & { id: string } => !!q && typeof q.id === 'string')
    .map((q) => {
      let hotkey = normalizeHotkey(q.hotkey);
      if (hotkey !== null && taken.has(hotkey)) hotkey = null;
      if (hotkey !== null) taken.add(hotkey);
      return {
        id: q.id,
        name: typeof q.name === 'string' ? q.name : '',
        text: typeof q.text === 'string' ? q.text : '',
        hotkey,
        // Older state (no `submit`) defaults to true — the prior always-submit
        // behavior — so existing queries keep working unchanged.
        submit: typeof q.submit === 'boolean' ? q.submit : true,
      };
    });
}

export function defaultAppData(): AppData {
  return {
    projects: [],
    activeProjectId: null,
    queries: [],
    profiles: defaultProfiles(),
    unfiledLayout: null,
    skillRoots: [],
    terminalFontSize: DEFAULT_FONT_SIZE,
    leftPanelWidth: DEFAULT_LEFT_WIDTH,
    leftPanelCollapsed: false,
    rightPanelWidth: DEFAULT_RIGHT_WIDTH,
    rightPanelCollapsed: false,
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

  // Project switch shortcuts (Ctrl+<digit>) are unique across projects, just
  // like query hotkeys: if two projects claim the same digit, the first keeps
  // it and the rest are cleared. Older state (no `hotkey`) loads with `null`.
  const takenProjectHotkeys = new Set<number>();
  const projects: Project[] = Array.isArray(raw.projects)
    ? raw.projects.map((p) => {
        let hotkey = normalizeHotkey((p as { hotkey?: unknown }).hotkey);
        if (hotkey !== null && takenProjectHotkeys.has(hotkey)) hotkey = null;
        if (hotkey !== null) takenProjectHotkeys.add(hotkey);
        return {
          id: p.id,
          name: typeof p.name === 'string' ? p.name : '',
          path: typeof p.path === 'string' ? p.path : '',
          hotkey,
          todos: Array.isArray(p.todos) ? p.todos : [],
          profiles: Array.isArray(p.profiles)
            ? p.profiles.filter((pr) => pr && typeof pr.id === 'string').map(normalizeProfile)
            : [],
          layout: normalizeLayout((p as { layout?: unknown }).layout),
        };
      })
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
    queries: normalizeQueries(raw.queries),
    profiles:
      Array.isArray(raw.profiles) && raw.profiles.length
        ? raw.profiles.filter((p) => p && typeof p.id === 'string').map(normalizeProfile)
        : base.profiles,
    unfiledLayout: normalizeLayout((raw as { unfiledLayout?: unknown }).unfiledLayout),
    skillRoots: Array.isArray(raw.skillRoots) ? raw.skillRoots : [],
    terminalFontSize:
      typeof raw.terminalFontSize === 'number' ? clampFontSize(raw.terminalFontSize) : base.terminalFontSize,
    leftPanelWidth:
      typeof raw.leftPanelWidth === 'number' ? clampLeftWidth(raw.leftPanelWidth) : base.leftPanelWidth,
    leftPanelCollapsed: typeof raw.leftPanelCollapsed === 'boolean' ? raw.leftPanelCollapsed : base.leftPanelCollapsed,
    rightPanelWidth:
      typeof raw.rightPanelWidth === 'number' ? clampRightWidth(raw.rightPanelWidth) : base.rightPanelWidth,
    rightPanelCollapsed:
      typeof raw.rightPanelCollapsed === 'boolean' ? raw.rightPanelCollapsed : base.rightPanelCollapsed,
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
        hotkey: null,
        todos: [],
        profiles: [],
        layout: null,
      }))
    : [];
  const legacyTodos = Array.isArray(raw.todos) ? raw.todos : [];
  if (legacyTodos.length) {
    if (projects.length === 0) {
      projects.push({ id: uid(), name: 'General', path: '', hotkey: null, todos: [], profiles: [], layout: null });
    }
    projects[0].todos = legacyTodos;
  }
  return projects;
}
