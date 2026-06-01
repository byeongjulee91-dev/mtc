<script lang="ts">
  import { app } from '../state.svelte';
  import { bus } from '../bus.svelte';
  import { defaultProfiles } from '../defaults';
  import type { Profile, Skill } from '../types';

  let tab = $state<'skills' | 'profiles'>('skills');
  let newRoot = $state('');
  let selectedSkill = $state<Skill | null>(null);

  function insertSkill(s: Skill) {
    bus.send('/' + s.name, false);
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

  function addProfile() {
    app.addProfile({ name: 'New profile', color: '#4a9eff', distro: '', cwd: '', command: '', keepOpen: false });
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
    <button class="btn icon" title="Refresh" onclick={() => app.refreshSkills()}>⟳</button>
  {:else}
    <button class="btn icon" title="Add profile" onclick={addProfile}>＋</button>
  {/if}
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
      <div class="muted" style="font-size:11px">Defaults to ~/.claude/skills when no roots are set.</div>
    </div>

    {#if app.skills.length === 0}
      <div class="empty">No skills found.</div>
    {:else}
      {#each app.skills as s (s.path)}
        <div
          class="list-row"
          class:sel={selectedSkill?.path === s.path}
          onpointerdown={() => (selectedSkill = selectedSkill?.path === s.path ? null : s)}
          role="presentation"
        >
          <div class="grow">
            <div>{s.name}</div>
            {#if selectedSkill?.path === s.path}
              <div class="muted" style="font-size:11px;white-space:normal">{s.description || '(no description)'}</div>
              <div class="muted" style="font-size:10px;white-space:normal">{s.path}</div>
            {:else}
              <div class="muted" style="font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{s.description}</div>
            {/if}
          </div>
          <button class="btn icon" title="Insert /{s.name} into focused terminal" disabled={!bus.hasFocus} onclick={(e) => { e.stopPropagation(); insertSkill(s); }}>↳</button>
        </div>
      {/each}
    {/if}
  {:else}
    <div style="padding:8px;display:flex;justify-content:flex-end">
      <button class="btn" title="Reset to claude / codex / shell" onclick={resetProfiles}>Reset defaults</button>
    </div>
    {#each app.data.profiles as p (p.id)}
      <div style="padding:8px;border-bottom:1px solid var(--border);display:flex;flex-direction:column;gap:5px">
        <div style="display:flex;gap:6px;align-items:center">
          <input type="color" value={p.color} oninput={(e) => update(p, { color: e.currentTarget.value })} style="width:28px;height:24px;padding:0;border:none;background:none" />
          <input class="field" value={p.name} oninput={(e) => update(p, { name: e.currentTarget.value })} placeholder="Name" />
          <button class="btn icon" title="Delete profile" onclick={() => app.deleteProfile(p.id)}>✕</button>
        </div>
        <input class="field" value={p.command} oninput={(e) => update(p, { command: e.currentTarget.value })} placeholder="Command in WSL (e.g. claude, codex) — empty = shell" />
        <div style="display:flex;gap:6px">
          <input class="field" value={p.distro} oninput={(e) => update(p, { distro: e.currentTarget.value })} placeholder="distro (optional)" />
          <input class="field" value={p.cwd} oninput={(e) => update(p, { cwd: e.currentTarget.value })} placeholder="cwd (optional)" />
        </div>
        <label class="muted" style="font-size:12px;display:flex;gap:6px;align-items:center">
          <input type="checkbox" checked={p.keepOpen} onchange={(e) => update(p, { keepOpen: e.currentTarget.checked })} />
          keep shell open after command exits
        </label>
      </div>
    {/each}
  {/if}
</div>
