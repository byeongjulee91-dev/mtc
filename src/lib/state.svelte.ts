import type { AppData, Profile, Skill, Todo, SavedQuery } from './types';
import { DEFAULT_FONT_SIZE, clampFontSize, defaultAppData, normalizeAppData, uid } from './defaults';
import { loadAppData, saveAppData, scanSkills } from './api';

/**
 * Reactive application state (Svelte 5 runes). Holds persisted data (todos,
 * queries, profiles, skill roots) plus the live skill list. Mutations autosave
 * to the backend with a short debounce.
 */
class AppState {
  data = $state<AppData>(defaultAppData());
  skills = $state<Skill[]>([]);
  loaded = $state(false);
  /** True when running outside Tauri (e.g. `vite` in a plain browser). */
  standalone = $state(false);

  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  async init(): Promise<void> {
    try {
      this.data = normalizeAppData(await loadAppData());
    } catch {
      // No Tauri backend (plain browser dev) — start from defaults.
      this.standalone = true;
      this.data = defaultAppData();
    }
    this.loaded = true;
    void this.refreshSkills();
  }

  private scheduleSave(): void {
    if (this.standalone) return;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      // Snapshot to a plain (deep-cloned) object so the reactive proxy isn't
      // passed over IPC.
      saveAppData($state.snapshot(this.data)).catch(() => {
        /* best-effort; retried on next mutation */
      });
    }, 250);
  }

  // --- todos ---
  addTodo(text: string): void {
    this.data.todos.push({ id: uid(), text, done: false });
    this.scheduleSave();
  }
  toggleTodo(id: string): void {
    const t = this.data.todos.find((x) => x.id === id);
    if (t) t.done = !t.done;
    this.scheduleSave();
  }
  deleteTodo(id: string): void {
    this.data.todos = this.data.todos.filter((x) => x.id !== id);
    this.scheduleSave();
  }

  // --- queries ---
  addQuery(name: string, text: string): void {
    this.data.queries.push({ id: uid(), name, text });
    this.scheduleSave();
  }
  deleteQuery(id: string): void {
    this.data.queries = this.data.queries.filter((x) => x.id !== id);
    this.scheduleSave();
  }

  // --- profiles ---
  addProfile(p: Omit<Profile, 'id'>): Profile {
    const profile: Profile = { ...p, id: uid() };
    this.data.profiles.push(profile);
    this.scheduleSave();
    return profile;
  }
  updateProfile(id: string, patch: Partial<Profile>): void {
    const p = this.data.profiles.find((x) => x.id === id);
    if (p) Object.assign(p, patch);
    this.scheduleSave();
  }
  deleteProfile(id: string): void {
    this.data.profiles = this.data.profiles.filter((x) => x.id !== id);
    this.scheduleSave();
  }

  // --- terminal font size (shared across all panes, persisted) ---
  setTerminalFontSize(px: number): void {
    const next = clampFontSize(px);
    if (next === this.data.terminalFontSize) return;
    this.data.terminalFontSize = next;
    this.scheduleSave();
  }
  adjustTerminalFontSize(delta: number): void {
    this.setTerminalFontSize(this.data.terminalFontSize + delta);
  }
  resetTerminalFontSize(): void {
    this.setTerminalFontSize(DEFAULT_FONT_SIZE);
  }

  // --- skills ---
  addSkillRoot(path: string): void {
    if (path && !this.data.skillRoots.includes(path)) {
      this.data.skillRoots.push(path);
      this.scheduleSave();
      void this.refreshSkills();
    }
  }
  removeSkillRoot(path: string): void {
    this.data.skillRoots = this.data.skillRoots.filter((x) => x !== path);
    this.scheduleSave();
    void this.refreshSkills();
  }
  async refreshSkills(): Promise<void> {
    if (this.standalone) return;
    try {
      this.skills = await scanSkills($state.snapshot(this.data.skillRoots));
    } catch {
      this.skills = [];
    }
  }
}

export const app = new AppState();

export type { Todo, SavedQuery, Profile, Skill };
