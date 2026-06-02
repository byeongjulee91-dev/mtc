<script lang="ts">
  import { SvelteMap } from 'svelte/reactivity';
  import type { Profile } from '../types';
  import { app } from '../state.svelte';
  import { bus } from '../bus.svelte';
  import { UNFILED_KEY } from '../defaults';
  import { PaneRuntime } from '../session.svelte';
  import { buildLayout, serializeTree } from '../layout';
  import TerminalPane from './TerminalPane.svelte';

  // One live runtime per *visited* workspace bucket (a project, or the "Unfiled"
  // bucket when no project is selected). Inactive buckets stay mounted but
  // hidden so their PTY sessions remain warm across project switches; only the
  // active bucket is shown. The persisted layout seeds a runtime on first visit.
  const runtimes = new SvelteMap<string, PaneRuntime>();

  // The active bucket: the selected project's id, or the Unfiled sentinel.
  let bucketKey = $derived(app.data.activeProjectId ?? UNFILED_KEY);

  function activeRuntime(): PaneRuntime | undefined {
    return runtimes.get(bucketKey);
  }
  // Reactive view of the active runtime for the template (the empty-state).
  let activeRt = $derived(runtimes.get(bucketKey));

  // Resolve a stored profile id within a bucket: global profiles plus, for a
  // project bucket, that project's own profiles.
  function resolveProfile(key: string, profileId: string): Profile | null {
    const proj = key === UNFILED_KEY ? null : app.data.projects.find((p) => p.id === key);
    const all = [...app.data.profiles, ...(proj?.profiles ?? [])];
    return all.find((p) => p.id === profileId) ?? null;
  }
  // New sessions in a project bucket open in the project's directory (cwd
  // override), mirroring the prior per-profile behavior.
  function projectPath(key: string): string {
    if (key === UNFILED_KEY) return '';
    return app.data.projects.find((p) => p.id === key)?.path ?? '';
  }
  function prepareProfile(key: string, profile: Profile): Profile {
    const cwd = projectPath(key);
    return cwd ? { ...profile, cwd } : profile;
  }

  // Persist a bucket's layout after a structural change.
  function persist(key: string): void {
    const rt = runtimes.get(key);
    if (rt) app.setLayout(key, serializeTree(rt.tree, rt.panes));
  }

  // Lazy warm / restore: ensure the active bucket has a runtime, building it
  // from the persisted layout on first visit. This is also what restores a
  // project's sessions after an app restart.
  $effect(() => {
    const key = bucketKey;
    if (runtimes.has(key)) return;
    const rt = new PaneRuntime();
    const layout = app.layoutFor(key);
    if (layout) {
      rt.load(
        buildLayout(
          layout,
          (id) => resolveProfile(key, id),
          (p) => prepareProfile(key, p),
        ),
      );
    }
    runtimes.set(key, rt);
  });

  // Prune runtimes whose project was deleted — unmounting their panes closes
  // the underlying PTYs.
  $effect(() => {
    const valid = new Set<string>([UNFILED_KEY, ...app.data.projects.map((p) => p.id)]);
    for (const key of [...runtimes.keys()]) {
      if (!valid.has(key)) runtimes.delete(key);
    }
  });

  // Keep the shared bus in sync with the active runtime.
  $effect(() => {
    const rt = runtimes.get(bucketKey);
    bus.hasFocus = !!(rt && rt.tree);
  });
  // Live (warm) session counts per bucket, for the left panel's badge + park.
  $effect(() => {
    const counts: Record<string, number> = {};
    for (const [key, rt] of runtimes) {
      const n = rt.paneCount;
      if (n > 0) counts[key] = n;
    }
    bus.liveCounts = counts;
  });

  // Side panels / terminal key handlers act on the *active* runtime. These read
  // current state at call time, so a single assignment is enough.
  bus.focusDir = (dir) => activeRuntime()?.focusNeighbor(dir);
  bus.toggleMax = () => activeRuntime()?.toggleMax();
  bus.splitDir = (dir) => splitActive(dir);
  bus.closeFocused = () => closeActiveFocused();
  bus.parkProject = (key) => {
    if (key === bucketKey) return; // the active bucket would just respawn
    runtimes.delete(key); // unmounts its panes → onDestroy closes the PTYs
  };

  function openProfile(profile: Profile): void {
    const key = bucketKey;
    let rt = runtimes.get(key);
    if (!rt) {
      rt = new PaneRuntime();
      runtimes.set(key, rt);
    }
    rt.addPane(prepareProfile(key, profile), 'v');
    persist(key);
  }
  function splitActive(dir: 'v' | 'h'): void {
    const rt = activeRuntime();
    if (!rt) return;
    rt.splitFocused(dir);
    persist(bucketKey);
  }
  function equalizeActive(): void {
    activeRuntime()?.equalizePanes();
    persist(bucketKey);
  }
  function toggleMaxActive(): void {
    activeRuntime()?.toggleMax();
  }
  function closePaneIn(rt: PaneRuntime, key: string, id: number): void {
    rt.closePane(id);
    persist(key);
  }
  function closeActiveFocused(): void {
    const rt = activeRuntime();
    if (rt && rt.focusedId !== null) closePaneIn(rt, bucketKey, rt.focusedId);
  }
  function focus(rt: PaneRuntime, id: number): void {
    rt.focusedId = id;
  }
</script>

<div class="profile-bar">
  {#each app.visibleProfiles as p (p.id)}
    <button class="chip" onclick={() => openProfile(p)} title={p.command || 'WSL shell'}>
      <span class="dot" style="background:{p.color}"></span>{p.name}
    </button>
  {/each}
  <span style="flex:1"></span>
  {#if app.activeProject?.path}
    <span class="cwd-hint" title="New sessions open in {app.activeProject.path}">
      📁 {app.activeProject.name || app.activeProject.path}
    </span>
  {/if}
  <button class="btn icon" title="Split vertical (Alt+Shift++)" onclick={() => splitActive('v')}>◧</button>
  <button class="btn icon" title="Split horizontal (Alt+Shift+-)" onclick={() => splitActive('h')}>⬓</button>
  <button class="btn icon" title="Distribute panes evenly" onclick={equalizeActive}>⊞</button>
  <button class="btn icon" title="Maximize / restore (Alt+Enter)" onclick={toggleMaxActive}>⛶</button>
  <button class="btn icon" title="Close focused (Ctrl+W)" onclick={closeActiveFocused}>✕</button>
</div>

<div class="tiles">
  {#each [...runtimes] as [key, rt] (key)}
    {#if rt.tree !== null}
      {@const isActive = key === bucketKey}
      {@const tiles = isActive ? rt.tiles : null}
      <div class="project-layer" style:display={isActive ? null : 'none'}>
        {#each rt.order as id (id)}
          {@const profile = rt.panes.get(id)}
          {#if profile}
            {@const box = tiles?.get(id)}
            <div
              class="pane"
              class:focused={isActive && id === rt.focusedId}
              style={box
                ? `left:${box.left}%;top:${box.top}%;width:${box.width}%;height:${box.height}%`
                : 'display:none'}
              onpointerdowncapture={() => focus(rt, id)}
              role="presentation"
            >
              <div class="pane-head">
                <span class="dot" style="background:{profile.color};width:8px;height:8px;border-radius:50%"></span>
                <span class="grow">{profile.name}{profile.command ? ` · ${profile.command}` : ''}</span>
                <button class="btn icon" title="Close" onclick={() => closePaneIn(rt, key, id)}>✕</button>
              </div>
              <TerminalPane {profile} active={isActive && id === rt.focusedId} visible={isActive} />
            </div>
          {/if}
        {/each}
      </div>
    {/if}
  {/each}

  {#if !activeRt || activeRt.tree === null}
    <div class="center-empty">
      <div>No sessions open</div>
      <div class="muted">Pick a profile above to launch a terminal.</div>
    </div>
  {/if}
</div>

<style>
  /* Each visited workspace gets a full-bleed layer; only the active one is
     shown. Keeping inactive layers mounted (display:none) is what keeps their
     terminal sessions warm. Panes position absolutely within their layer. */
  .project-layer {
    position: absolute;
    inset: 0;
  }
</style>
