<script lang="ts">
  import { app } from '../state.svelte';
  import { bus } from '../bus.svelte';
  import { defaultProfiles } from '../defaults';
  import type { Profile, Skill, SkillGroup } from '../types';

  type SkillAgent = 'claude' | 'codex' | 'mixed' | 'custom';

  let tab = $state<'skills' | 'profiles'>('skills');
  let newRoot = $state('');
  let skillQuery = $state('');
  let selectedSkill = $state<Skill | null>(null);
  /** Explicit per-group collapse choices (by root). Absent = use the default. */
  let groupOverride = $state<Record<string, boolean>>({});
  /** Drag-and-drop reordering state for the profile lists. */
  let dragId = $state<string | null>(null);
  let overId = $state<string | null>(null);

  // Drive skill discovery lazily: only scan while the Skills tab is actually
  // visible (panel open + Skills tab + data loaded). `refreshSkills()` is cached
  // and deduped, so reading the active project / skill roots here re-scans only
  // when they truly change and serves revisits from cache — no `wsl.exe` spawn
  // happens while the panel is hidden or on another tab.
  $effect(() => {
    if (tab !== 'skills' || app.data.rightPanelCollapsed || !app.loaded) return;
    void app.refreshSkills();
  });

  /**
   * Groups narrowed by the search box. A skill matches when the query (case-
   * insensitive) is a substring of its name or description; groups with no
   * surviving skills are dropped. An empty query returns every group untouched.
   */
  const filteredGroups = $derived.by(() => {
    const q = skillQuery.trim().toLowerCase();
    let groups = app.skillGroups;
    if (q) {
      groups = app.skillGroups
        .map((g) => ({
          ...g,
          skills: g.skills.filter(
            (s) => s.name.toLowerCase().includes(q) || (s.description ?? '').toLowerCase().includes(q),
          ),
        }))
        .filter((g) => g.skills.length > 0);
    }
    return [...groups].sort((a, b) => groupSortKey(a) - groupSortKey(b));
  });
  /** While searching, ignore collapse state so every match stays visible. */
  const searching = $derived(skillQuery.trim().length > 0);

  function insertSkill(s: Skill) {
    bus.send('/' + s.name, false);
  }
  function skillAgentFromPath(path: string): SkillAgent {
    const normalized = path.replaceAll('\\', '/').toLowerCase();
    if (normalized.includes('/.codex/skills/')) return 'codex';
    if (normalized.includes('/.claude/skills/')) return 'claude';
    return 'custom';
  }
  function groupAgent(g: SkillGroup): SkillAgent {
    const rootAgent = skillAgentFromPath(g.root + '/');
    if (rootAgent !== 'custom') return rootAgent;
    const agents = new Set(g.skills.map((s) => skillAgentFromPath(s.path)).filter((a) => a !== 'custom'));
    if (agents.size === 1) return Array.from(agents)[0] ?? 'custom';
    if (agents.size > 1) return 'mixed';
    return 'custom';
  }
  function groupSortKey(g: SkillGroup): number {
    const agent = groupAgent(g);
    if (agent === 'claude') return 0;
    if (agent === 'codex') return 1;
    if (agent === 'mixed') return 2;
    return 3;
  }
  function agentLabel(agent: SkillAgent): string {
    if (agent === 'claude') return 'Claude';
    if (agent === 'codex') return 'Codex';
    if (agent === 'mixed') return 'Mixed';
    return 'Custom';
  }
  /** Shorten a Linux home path for display: /home/<user>/… → ~/…. */
  function prettyRoot(root: string): string {
    return root.replace(/^\/home\/[^/]+/, '~').replace(/^\/root(?=\/|$)/, '~');
  }
  /**
   * A WSL-discovered skill can only be inserted into a WSL terminal — native
   * PowerShell/cmd agents run against the Windows host's skills, not WSL's.
   */
  function groupBlocked(g: SkillGroup): boolean {
    return g.kind === 'wsl' && (bus.focusedShell === 'powershell' || bus.focusedShell === 'cmd');
  }
  /**
   * Whether a group is collapsed. Default: blocked groups (WSL skills while a
   * native shell is focused) start collapsed so they're out of the way during
   * Windows work; an explicit toggle overrides that for the session.
   */
  function isCollapsed(g: SkillGroup): boolean {
    const o = groupOverride[g.root];
    return o === undefined ? groupBlocked(g) : o;
  }
  function toggleGroup(g: SkillGroup) {
    groupOverride[g.root] = !isCollapsed(g);
  }
  function addRoot() {
    const r = newRoot.trim();
    if (r) {
      app.addSkillRoot(r);
      newRoot = '';
    }
  }
  async function browseRoot() {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const picked = await open({ directory: true, multiple: false });
      if (typeof picked === 'string') app.addSkillRoot(picked);
    } catch {
      /* dialog unavailable in standalone */
    }
  }

  const blankProfile = () => ({ name: 'New profile', color: '#4a9eff', distro: '', cwd: '', command: '', keepOpen: false, shell: 'wsl' as const });
  function addProfile() {
    app.addProfile(blankProfile(), 'global');
  }
  function addProjectProfile() {
    app.addProfile(blankProfile(), 'project');
  }
  function resetProfiles() {
    for (const p of [...app.data.profiles]) app.deleteProfile(p.id);
    for (const p of defaultProfiles()) app.addProfile(p);
  }
  function update(p: Profile, patch: Partial<Profile>) {
    app.updateProfile(p.id, patch);
  }
</script>

<div class="panel-head">
  <button class="tab" class:active={tab === 'skills'} onclick={() => (tab = 'skills')}>Skills</button>
  <button class="tab" class:active={tab === 'profiles'} onclick={() => (tab = 'profiles')}>Profiles</button>
  <span style="flex:1"></span>
  {#if tab === 'skills'}
    <button class="btn icon" title="Refresh" onclick={() => app.refreshSkills(true)}>⟳</button>
  {:else}
    <button class="btn icon" title="Add profile" onclick={addProfile}>＋</button>
  {/if}
  <button class="btn icon" title="Hide panel" onclick={() => app.toggleRightPanel()}>›</button>
</div>

<div class="panel-body">
  {#if tab === 'skills'}
    <div style="padding:8px;display:flex;flex-direction:column;gap:6px">
      <div class="muted" style="font-size:11px">Skill roots (host or \\wsl.localhost\… paths)</div>
      {#each app.data.skillRoots as root (root)}
        <div class="list-row" style="padding:2px 0">
          <span class="grow" style="font-size:11px">{root}</span>
          <button class="btn icon" title="Remove" onclick={() => app.removeSkillRoot(root)}>✕</button>
        </div>
      {/each}
      <div style="display:flex;gap:6px">
        <input class="field" placeholder="Add skill root path…" bind:value={newRoot} onkeydown={(e) => e.key === 'Enter' && addRoot()} />
        <button class="btn" onclick={addRoot}>+</button>
        <button class="btn" title="Browse folder" onclick={browseRoot}>…</button>
      </div>
      <div class="muted" style="font-size:11px">Auto-detects Claude and Codex skill dirs (host + WSL, user + active project).</div>
      <div class="search-row">
        <input class="field" placeholder="Search skills…" bind:value={skillQuery} />
        {#if searching}
          <button class="btn icon" title="Clear search" onclick={() => (skillQuery = '')}>✕</button>
        {/if}
      </div>
    </div>

    {#if app.skillGroups.length === 0}
      <div class="empty">No skills found.</div>
    {:else if filteredGroups.length === 0}
      <div class="empty">No skills match “{skillQuery.trim()}”.</div>
    {:else}
      {#each filteredGroups as g (g.root)}
        {@const blocked = groupBlocked(g)}
        {@const folded = !searching && isCollapsed(g)}
        {@const agent = groupAgent(g)}
        <button
          class="group-head"
          class:blocked
          title={blocked ? `${g.root} — WSL skills aren't usable in the focused PowerShell/cmd terminal` : g.root}
          onclick={() => toggleGroup(g)}
        >
          <span class="tw">{folded ? '▸' : '▾'}</span>
          <span class="agent-badge" class:claude={agent === 'claude'} class:codex={agent === 'codex'} class:mixed={agent === 'mixed'}>{agentLabel(agent)}</span>
          <span class="grow" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{prettyRoot(g.root)}</span>
          <span class="badge" class:wsl={g.kind === 'wsl'}>{g.kind === 'wsl' ? 'WSL' : 'host'}</span>
          <span class="muted" style="font-size:11px">{g.skills.length}</span>
        </button>
        {#if !folded}
          {#if g.skills.length === 0}
            <div class="muted" style="padding:4px 8px 4px 16px;font-size:11px">(no skills found here)</div>
          {/if}
          {#each g.skills as s (s.path)}
          <div
            class="list-row top"
            class:sel={selectedSkill?.path === s.path}
            onclick={() => (selectedSkill = selectedSkill?.path === s.path ? null : s)}
            role="presentation"
          >
            <div class="grow">
              <div class:skill-name={selectedSkill?.path === s.path}>{s.name}</div>
              {#if selectedSkill?.path === s.path}
                <div class="skill-desc">{s.description || '(no description)'}</div>
                <div class="skill-path">{s.path}</div>
              {:else}
                <div class="muted" style="font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{s.description}</div>
              {/if}
            </div>
            <button
              class="btn icon"
              title={blocked ? 'WSL skill — not usable in a PowerShell/cmd terminal' : `Insert /${s.name} into focused terminal`}
              disabled={!bus.hasFocus || blocked}
              onclick={(e) => { e.stopPropagation(); insertSkill(s); }}>↳</button>
          </div>
          {/each}
        {/if}
      {/each}
    {/if}
  {:else}
    {#snippet profileRow(p: Profile, scope: 'global' | 'project')}
      <div
        role="listitem"
        class="profile-row"
        class:drag-over={overId === p.id && dragId !== null && dragId !== p.id}
        ondragover={(e) => { e.preventDefault(); overId = p.id; }}
        ondragleave={() => { if (overId === p.id) overId = null; }}
        ondrop={(e) => { e.preventDefault(); if (dragId) app.reorderProfile(dragId, p.id); dragId = null; overId = null; }}
      >
        <div style="display:flex;gap:6px;align-items:center">
          <span
            class="grip"
            title="Drag to reorder"
            draggable="true"
            role="button"
            tabindex="-1"
            ondragstart={(e) => { dragId = p.id; if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'; }}
            ondragend={() => { dragId = null; overId = null; }}
          >⠿</span>
          <input type="color" value={p.color} oninput={(e) => update(p, { color: e.currentTarget.value })} style="width:28px;height:24px;padding:0;border:none;background:none" />
          <input class="field" value={p.name} oninput={(e) => update(p, { name: e.currentTarget.value })} placeholder="Name" />
          {#if scope === 'global' && app.activeProject}
            <button class="btn icon" title={`Copy to project · ${app.activeProject.name || app.activeProject.path || 'current'}`} onclick={() => app.copyProfileToProject(p.id)}>⧉</button>
          {/if}
          <button class="btn icon" title="Delete profile" onclick={() => app.deleteProfile(p.id)}>✕</button>
        </div>
        <div style="display:flex;gap:6px">
          <select class="field" style="flex:0 0 auto" value={p.shell} onchange={(e) => update(p, { shell: e.currentTarget.value as Profile['shell'] })} title="Terminal backend">
            <option value="wsl">WSL</option>
            <option value="powershell">PowerShell</option>
            <option value="cmd">cmd</option>
          </select>
          <input class="field" value={p.command} oninput={(e) => update(p, { command: e.currentTarget.value })} placeholder={p.shell === 'wsl' ? 'Command in WSL (e.g. claude) — empty = shell' : 'Command — empty = interactive shell'} />
        </div>
        <div style="display:flex;gap:6px">
          {#if p.shell === 'wsl'}
            <input class="field" value={p.distro} oninput={(e) => update(p, { distro: e.currentTarget.value })} placeholder="distro (optional)" />
          {/if}
          <input class="field" value={p.cwd} oninput={(e) => update(p, { cwd: e.currentTarget.value })} placeholder={p.shell === 'wsl' ? 'cwd (optional)' : 'cwd — Windows path (optional)'} />
        </div>
        <label class="muted" style="font-size:12px;display:flex;gap:6px;align-items:center">
          <input type="checkbox" checked={p.keepOpen} onchange={(e) => update(p, { keepOpen: e.currentTarget.checked })} />
          keep shell open after command exits
        </label>
      </div>
    {/snippet}

    <div class="muted" style="padding:6px 8px;display:flex;align-items:center;gap:6px;border-bottom:1px solid var(--border);font-size:11px;text-transform:uppercase;letter-spacing:.04em">
      <span>Global</span>
      <span style="flex:1"></span>
      <button class="btn" title="Reset global profiles to claude / codex / shell / PowerShell" onclick={resetProfiles}>Reset defaults</button>
    </div>
    {#each app.data.profiles as p (p.id)}
      {@render profileRow(p, 'global')}
    {/each}

    <div class="muted" style="padding:6px 8px;display:flex;align-items:center;gap:6px;border-bottom:1px solid var(--border);font-size:11px;text-transform:uppercase;letter-spacing:.04em">
      <span>{app.activeProject ? `Project · ${app.activeProject.name || app.activeProject.path || 'unnamed'}` : 'Project'}</span>
      <span style="flex:1"></span>
      {#if app.activeProject}
        <button class="btn icon" title="Add a profile only for this project" onclick={addProjectProfile}>＋</button>
      {/if}
    </div>
    {#if !app.activeProject}
      <div class="muted" style="padding:8px;font-size:12px">Select a project to add profiles that appear only while it is active.</div>
    {:else if app.activeProject.profiles.length === 0}
      <div class="muted" style="padding:8px;font-size:12px">No project-specific profiles yet. Use ＋ above to add one.</div>
    {:else}
      {#each app.activeProject.profiles as p (p.id)}
        {@render profileRow(p, 'project')}
      {/each}
    {/if}
  {/if}
</div>

<style>
  /* Skill search box: full-width field with an optional clear button. */
  .search-row {
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .search-row .field {
    flex: 1;
  }

  /* Skill-group header (one per detected root) — click to collapse/expand. */
  .group-head {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 5px 8px;
    background: var(--panel-2);
    border: none;
    border-top: 1px solid var(--border);
    border-bottom: 1px solid var(--border);
    color: var(--text);
    font: inherit;
    font-size: 11px;
    text-align: left;
    cursor: pointer;
  }
  .group-head:hover {
    background: #243042;
  }
  /* Blocked group (WSL skills, native shell focused): dimmed and collapsed by
     default so it stays out of the way during Windows work. */
  .group-head.blocked {
    opacity: 0.55;
  }
  .group-head .tw {
    flex: 0 0 auto;
    width: 10px;
    opacity: 0.6;
  }
  /* Selected skill: emphasized name + a readable, full-contrast description. */
  .skill-name {
    font-weight: 600;
  }
  .skill-desc {
    color: var(--text);
    font-size: 13px;
    line-height: 1.5;
    white-space: normal;
    margin: 3px 0 1px;
  }
  .skill-path {
    color: var(--muted);
    font-size: 10px;
    white-space: normal;
    word-break: break-all;
  }
  .badge {
    flex: 0 0 auto;
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 0 4px;
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--muted);
  }
  /* WSL groups get the cyan accent so their origin reads at a glance. */
  .badge.wsl {
    color: var(--border-focus);
    border-color: var(--border-focus);
  }
  .agent-badge {
    flex: 0 0 auto;
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 1px 5px;
    border: 1px solid #596171;
    border-radius: 4px;
    color: #b9c1cf;
    background: #202734;
  }
  .agent-badge.claude {
    color: #f1b39a;
    border-color: #b96b4f;
    background: #34251f;
  }
  .agent-badge.codex {
    color: #84dfc2;
    border-color: #278b70;
    background: #18312b;
  }
  .agent-badge.mixed {
    color: #c7b9ff;
    border-color: #7766bf;
    background: #28233b;
  }

  .profile-row {
    padding: 8px;
    border-bottom: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .profile-row.drag-over {
    box-shadow: inset 0 2px 0 0 #4a9eff;
  }
  .grip {
    cursor: grab;
    user-select: none;
    opacity: 0.45;
    padding: 0 2px;
    line-height: 1;
  }
  .grip:hover {
    opacity: 0.9;
  }
  .grip:active {
    cursor: grabbing;
  }
</style>
