import type { AppData, LayoutNode, Profile, Skill, SkillGroup, Todo, SavedQuery, Project } from './types';
import { DEFAULT_FONT_SIZE, UNFILED_KEY, clampFontSize, clampLeftWidth, clampRightWidth, defaultAppData, normalizeAppData, uid } from './defaults';
import { loadAppData, saveAppData, discoverSkills, countGitFiles } from './api';

/**
 * Reactive application state (Svelte 5 runes). Holds persisted data (projects
 * with per-project todos, global queries, profiles, skill roots) plus the live
 * skill list. Mutations autosave to the backend with a short debounce.
 */
class AppState {
  data = $state<AppData>(defaultAppData());
  /** Discovered skills, grouped by the root they were found under. */
  skillGroups = $state<SkillGroup[]>([]);
  loaded = $state(false);
  /** True when running outside Tauri (e.g. `vite` in a plain browser). */
  standalone = $state(false);
  /**
   * Number of git-tracked files in the active project's directory, or `null`
   * when unknown (no project, not a git repo, standalone, or git unavailable).
   * Refreshed when the active project changes; results are cached per path.
   */
  gitFileCount = $state<number | null>(null);
  /**
   * Reason the count failed for a *real* error (git not on PATH, dubious
   * ownership, …) — surfaced as a ⚠ badge so the failure isn't silent. Stays
   * `null` for the ordinary "not a git repository" case, which just hides the
   * badge. Cleared on a successful count.
   */
  gitCountError = $state<string | null>(null);

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
    // Skills are discovered lazily by the Skills panel (it spawns `wsl.exe`), so
    // no scan is kicked off here.
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
    const project: Project = { id: uid(), name: name.trim(), path: trimmed, todos: [], profiles: [], layout: null };
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
    // The active project's `.claude/skills` is auto-detected, but discovery is
    // driven lazily by the Skills panel (it spawns `wsl.exe`) — switching
    // projects no longer scans on its own.
  }

  // --- per-workspace terminal layout (persisted; drives restore on launch) ---
  /** The saved layout for a bucket (`UNFILED_KEY` or a project id), or null. */
  layoutFor(key: string): LayoutNode | null {
    if (key === UNFILED_KEY) return this.data.unfiledLayout;
    return this.data.projects.find((p) => p.id === key)?.layout ?? null;
  }
  /** Persist the terminal layout for a bucket. A missing project id is ignored
   *  (it may have just been deleted). */
  setLayout(key: string, layout: LayoutNode | null): void {
    if (key === UNFILED_KEY) {
      this.data.unfiledLayout = layout;
    } else {
      const p = this.data.projects.find((x) => x.id === key);
      if (!p) return;
      p.layout = layout;
    }
    this.scheduleSave();
  }

  // --- todos (scoped to the active project) ---
  addTodo(text: string): void {
    const project = this.activeProject;
    if (!project) return;
    project.todos.unshift({ id: uid(), text, done: false });
    this.scheduleSave();
  }
  toggleTodo(id: string): void {
    const t = this.activeProject?.todos.find((x) => x.id === id);
    if (t) t.done = !t.done;
    this.scheduleSave();
  }
  editTodo(id: string, text: string): void {
    const t = this.activeProject?.todos.find((x) => x.id === id);
    if (t) t.text = text;
    this.scheduleSave();
  }
  deleteTodo(id: string): void {
    const project = this.activeProject;
    if (!project) return;
    project.todos = project.todos.filter((x) => x.id !== id);
    this.scheduleSave();
  }

  // --- queries (global, shared across projects) ---
  addQuery(name: string, text: string, submit = true): void {
    this.data.queries.push({ id: uid(), name, text, hotkey: null, submit });
    this.scheduleSave();
  }
  editQuery(id: string, name: string, text: string): void {
    const q = this.data.queries.find((x) => x.id === id);
    if (q) {
      q.name = name;
      q.text = text;
    }
    this.scheduleSave();
  }
  deleteQuery(id: string): void {
    this.data.queries = this.data.queries.filter((x) => x.id !== id);
    this.scheduleSave();
  }
  /**
   * Bind (or clear, with `null`) the `Alt+<digit>` shortcut for a query. Hotkeys
   * are unique across all queries, so assigning a digit that another query holds
   * first releases it there.
   */
  setQueryHotkey(id: string, hotkey: number | null): void {
    const q = this.data.queries.find((x) => x.id === id);
    if (!q) return;
    if (hotkey !== null) {
      for (const other of this.data.queries) {
        if (other.id !== id && other.hotkey === hotkey) other.hotkey = null;
      }
    }
    q.hotkey = hotkey;
    this.scheduleSave();
  }
  /**
   * Set a query's insert mode: `true` submits on insert (appends Enter),
   * `false` only appends the text. See `SavedQuery.submit`.
   */
  setQuerySubmit(id: string, submit: boolean): void {
    const q = this.data.queries.find((x) => x.id === id);
    if (!q) return;
    q.submit = submit;
    this.scheduleSave();
  }
  /** The query bound to a given `Alt+<digit>` shortcut, or null if unassigned. */
  queryForHotkey(digit: number): SavedQuery | null {
    return this.data.queries.find((q) => q.hotkey === digit) ?? null;
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

  // --- left panel layout (width + collapsed, persisted) ---
  setLeftPanelWidth(px: number): void {
    const next = clampLeftWidth(px);
    if (next === this.data.leftPanelWidth) return;
    this.data.leftPanelWidth = next;
    this.scheduleSave();
  }
  toggleLeftPanel(): void {
    this.data.leftPanelCollapsed = !this.data.leftPanelCollapsed;
    this.scheduleSave();
  }

  // --- right panel layout (width + collapsed, persisted) ---
  setRightPanelWidth(px: number): void {
    const next = clampRightWidth(px);
    if (next === this.data.rightPanelWidth) return;
    this.data.rightPanelWidth = next;
    this.scheduleSave();
  }
  toggleRightPanel(): void {
    this.data.rightPanelCollapsed = !this.data.rightPanelCollapsed;
    this.scheduleSave();
  }

  // --- skills ---
  addSkillRoot(path: string): void {
    if (path && !this.data.skillRoots.includes(path)) {
      this.data.skillRoots.push(path);
      this.scheduleSave();
      this.invalidateSkillCache();
      void this.refreshSkills();
    }
  }
  removeSkillRoot(path: string): void {
    this.data.skillRoots = this.data.skillRoots.filter((x) => x !== path);
    this.scheduleSave();
    this.invalidateSkillCache();
    void this.refreshSkills();
  }

  // Discovery spawns `wsl.exe`, so it is split into two cached passes:
  //  - global: manual roots + host/WSL user skills. Project-independent, so it
  //    is scanned once per root set and reused across every project switch.
  //  - project: the active project's `.claude/skills`, scanned once per project.
  // The displayed list is their merge. Editing the manual roots invalidates the
  // global pass; the per-project passes don't depend on it and stay cached.
  private skillScanSeq = 0;
  private currentSkillKey: string | null = null;
  private globalSkillKey: string | null = null;
  private globalSkillGroups: SkillGroup[] | null = null;
  private projectSkillCache = new Map<string, SkillGroup[]>();
  private invalidateSkillCache(): void {
    this.globalSkillKey = null;
    this.globalSkillGroups = null;
    this.currentSkillKey = null;
    // The per-project passes don't depend on the manual roots, so they stay.
  }
  /**
   * Discover skills for the current roots + active project and show their merge.
   * The global pass (manual roots + host/WSL user skills) is scanned once per
   * session and reused across switches; the project pass is scanned once per
   * project. Both are cached, so switching back to a visited project spawns no
   * `wsl.exe` and switching to a new one re-scans only the project root. `force`
   * (the ⟳ button) re-scans both. Driven lazily from the Skills panel, so
   * nothing scans while it is hidden; a slow scan is dropped if a newer one won.
   */
  async refreshSkills(force = false): Promise<void> {
    if (this.standalone) return;
    const roots = $state.snapshot(this.data.skillRoots);
    const projectPath = this.activeProject?.path ?? null;
    const globalKey = JSON.stringify(roots);
    const displayKey = globalKey + ' ' + (projectPath ?? '');
    if (!force && displayKey === this.currentSkillKey) return; // already shown

    const seq = ++this.skillScanSeq;
    try {
      // Global pass — reused unless the manual roots changed (or forced).
      if (force || this.globalSkillGroups === null || this.globalSkillKey !== globalKey) {
        const { groups } = await discoverSkills(roots, null, true);
        if (seq !== this.skillScanSeq) return; // a newer scan already won
        this.globalSkillGroups = groups;
        this.globalSkillKey = globalKey;
      }
      // Project pass — cached per project path; only the project root is scanned.
      let projectGroups: SkillGroup[] = [];
      if (projectPath) {
        const cached = force ? undefined : this.projectSkillCache.get(projectPath);
        if (cached) {
          projectGroups = cached;
        } else {
          const { groups } = await discoverSkills([], projectPath, false);
          if (seq !== this.skillScanSeq) return;
          projectGroups = groups;
          this.projectSkillCache.set(projectPath, groups);
        }
      }
      if (seq !== this.skillScanSeq) return;
      this.skillGroups = mergeSkillGroups(this.globalSkillGroups ?? [], projectGroups);
      this.currentSkillKey = displayKey;
    } catch {
      if (seq !== this.skillScanSeq) return;
      this.skillGroups = [];
      this.currentSkillKey = null;
    }
  }

  // --- git-tracked file count (for the active project's path) ---
  // Counting spawns `git` (inside WSL on Windows), so results are cached per
  // path: switching back to a visited project shows the cached count without
  // re-spawning, and a stale async result is dropped if a newer switch won.
  private gitCountSeq = 0;
  private gitCountCache = new Map<string, number | null>();
  /**
   * Refresh `gitFileCount` for the active project's path. A no-op (clears to
   * `null`) in standalone mode or with no active project. Cached per path; a
   * slow count is discarded if the active project changed before it resolved.
   * `force` (window-focus / badge click) bypasses the cache and re-counts, so a
   * count kept current as files change rather than only on project switch.
   */
  async refreshGitFileCount(force = false): Promise<void> {
    const path = this.activeProject?.path ?? '';
    if (this.standalone || !path) {
      this.gitFileCount = null;
      this.gitCountError = null;
      return;
    }
    if (!force && this.gitCountCache.has(path)) {
      this.gitFileCount = this.gitCountCache.get(path) ?? null;
      this.gitCountError = null;
      return;
    }
    const seq = ++this.gitCountSeq;
    try {
      const count = await countGitFiles(path);
      if (seq !== this.gitCountSeq) return; // a newer refresh already won
      this.gitCountCache.set(path, count);
      this.gitFileCount = count;
      this.gitCountError = null;
    } catch (e) {
      if (seq !== this.gitCountSeq) return;
      const msg = String((e as { message?: string })?.message ?? e);
      this.gitFileCount = null;
      // "not a git repository" is the normal no-badge case; anything else
      // (git not found, dubious ownership, …) is surfaced as a ⚠ badge + log.
      this.gitCountError = /not a git repository/i.test(msg) ? null : msg;
      if (this.gitCountError) console.warn('[git-count]', path, msg);
    }
  }
}

/**
 * Merge two finalized skill-group lists (global + project): combine groups that
 * share a root, dedup skills by path (first occurrence wins), sort each group's
 * skills by name, and surface non-empty groups first. Mirrors the backend's
 * per-call finalize across the two cached passes.
 */
function mergeSkillGroups(global: SkillGroup[], project: SkillGroup[]): SkillGroup[] {
  const byRoot = new Map<string, SkillGroup>();
  const order: string[] = [];
  for (const g of [...global, ...project]) {
    const existing = byRoot.get(g.root);
    if (existing) existing.skills = [...existing.skills, ...g.skills];
    else {
      byRoot.set(g.root, { root: g.root, kind: g.kind, skills: [...g.skills] });
      order.push(g.root);
    }
  }
  const seen = new Set<string>();
  const groups = order.map((root) => {
    const g = byRoot.get(root)!;
    const skills = g.skills
      .filter((s) => {
        if (seen.has(s.path)) return false;
        seen.add(s.path);
        return true;
      })
      .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
    return { root: g.root, kind: g.kind, skills };
  });
  // Non-empty groups first; stable sort keeps each partition's order.
  return groups.sort((a, b) => Number(a.skills.length === 0) - Number(b.skills.length === 0));
}

export const app = new AppState();

export type { Todo, SavedQuery, Profile, Skill };
