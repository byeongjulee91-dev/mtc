import type { AppData, Profile, Skill, Todo, SavedQuery, Project } from './types';
import { DEFAULT_FONT_SIZE, clampFontSize, defaultAppData, normalizeAppData, uid } from './defaults';
import { loadAppData, saveAppData, scanSkills } from './api';

/**
 * Reactive application state (Svelte 5 runes). Holds persisted data (projects
 * with per-project todos, global queries, profiles, skill roots) plus the live
 * skill list. Mutations autosave to the backend with a short debounce.
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

  // --- projects (a working directory with its own todos) ---
  /** The selected project, or null when none is selected. */
  get activeProject(): Project | null {
    const id = this.data.activeProjectId;
    return id ? this.data.projects.find((p) => p.id === id) ?? null : null;
  }
  addProject(path: string, name: string): Project | null {
    const trimmed = path.trim();
    if (!trimmed) return null;
    // De-dupe on the path so the same directory isn't added twice.
    const existing = this.data.projects.find((p) => p.path === trimmed);
    if (existing) return existing;
    const project: Project = { id: uid(), name: name.trim(), path: trimmed, todos: [], profiles: [] };
    this.data.projects.push(project);
    this.scheduleSave();
    return project;
  }
  removeProject(id: string): void {
    this.data.projects = this.data.projects.filter((p) => p.id !== id);
    if (this.data.activeProjectId === id) this.data.activeProjectId = null;
    this.scheduleSave();
  }
  selectProject(id: string): void {
    this.data.activeProjectId = id;
    this.scheduleSave();
  }

  // --- todos (scoped to the active project) ---
  addTodo(text: string): void {
    const project = this.activeProject;
    if (!project) return;
    project.todos.push({ id: uid(), text, done: false });
    this.scheduleSave();
  }
  toggleTodo(id: string): void {
    const t = this.activeProject?.todos.find((x) => x.id === id);
    if (t) t.done = !t.done;
    this.scheduleSave();
  }
  deleteTodo(id: string): void {
    const project = this.activeProject;
    if (!project) return;
    project.todos = project.todos.filter((x) => x.id !== id);
    this.scheduleSave();
  }

  // --- queries (global, shared across projects) ---
  addQuery(name: string, text: string): void {
    this.data.queries.push({ id: uid(), name, text });
    this.scheduleSave();
  }
  deleteQuery(id: string): void {
    this.data.queries = this.data.queries.filter((x) => x.id !== id);
    this.scheduleSave();
  }

  // --- profiles ---
  /**
   * Profiles available right now: the global ones plus, when a project is
   * active, that project's own profiles (appended after the globals).
   */
  get visibleProfiles(): Profile[] {
    const own = this.activeProject?.profiles ?? [];
    return [...this.data.profiles, ...own];
  }
  /**
   * Add a profile. `scope: 'project'` attaches it to the active project (falling
   * back to global when no project is selected); otherwise it is global.
   */
  addProfile(p: Omit<Profile, 'id'>, scope: 'global' | 'project' = 'global'): Profile {
    const profile: Profile = { ...p, id: uid() };
    const project = this.activeProject;
    if (scope === 'project' && project) {
      project.profiles.push(profile);
    } else {
      this.data.profiles.push(profile);
    }
    this.scheduleSave();
    return profile;
  }
  updateProfile(id: string, patch: Partial<Profile>): void {
    const global = this.data.profiles.find((x) => x.id === id);
    if (global) {
      Object.assign(global, patch);
    } else {
      // Search project-scoped profiles (ids are unique across all lists).
      for (const proj of this.data.projects) {
        const p = proj.profiles.find((x) => x.id === id);
        if (p) {
          Object.assign(p, patch);
          break;
        }
      }
    }
    this.scheduleSave();
  }
  deleteProfile(id: string): void {
    this.data.profiles = this.data.profiles.filter((x) => x.id !== id);
    for (const proj of this.data.projects) {
      proj.profiles = proj.profiles.filter((x) => x.id !== id);
    }
    this.scheduleSave();
  }
  /** Reorder via drag-and-drop: move `dragId` to sit next to `targetId`. Only
   *  reorders within a single list (global or one project) — a drag whose source
   *  and target live in different lists is a no-op. */
  reorderProfile(dragId: string, targetId: string): void {
    if (dragId === targetId) return;
    const lists = [this.data.profiles, ...this.data.projects.map((p) => p.profiles)];
    for (const list of lists) {
      const from = list.findIndex((x) => x.id === dragId);
      const origTo = list.findIndex((x) => x.id === targetId);
      if (from === -1 || origTo === -1) continue;
      const [moved] = list.splice(from, 1);
      const to = list.findIndex((x) => x.id === targetId);
      // Dragging downward lands after the target; upward lands before it.
      list.splice(from < origTo ? to + 1 : to, 0, moved);
      this.scheduleSave();
      return;
    }
  }
  /** Duplicate a profile (any list) into the active project, keeping its color,
   *  shell, command, etc. Returns the copy, or null when no project is active. */
  copyProfileToProject(id: string): Profile | null {
    const project = this.activeProject;
    if (!project) return null;
    const all = [...this.data.profiles, ...this.data.projects.flatMap((p) => p.profiles)];
    const src = all.find((x) => x.id === id);
    if (!src) return null;
    const copy: Profile = { ...src, id: uid() };
    project.profiles.push(copy);
    this.scheduleSave();
    return copy;
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
