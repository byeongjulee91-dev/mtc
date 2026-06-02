import type { AppData, Profile } from './types';

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
    todos: [],
    queries: [],
    profiles: defaultProfiles(),
    skillRoots: [],
    terminalFontSize: DEFAULT_FONT_SIZE,
  };
}

/** Fill in any missing fields from a loaded blob so older state stays valid. */
export function normalizeAppData(raw: Partial<AppData> | null | undefined): AppData {
  const base = defaultAppData();
  if (!raw) return base;
  return {
    todos: Array.isArray(raw.todos) ? raw.todos : [],
    queries: Array.isArray(raw.queries) ? raw.queries : [],
    profiles: Array.isArray(raw.profiles) && raw.profiles.length ? raw.profiles : base.profiles,
    skillRoots: Array.isArray(raw.skillRoots) ? raw.skillRoots : [],
    terminalFontSize:
      typeof raw.terminalFontSize === 'number' ? clampFontSize(raw.terminalFontSize) : base.terminalFontSize,
  };
}
