<script lang="ts">
  import { SvelteMap } from 'svelte/reactivity';
  import type { Profile } from '../types';
  import { app } from '../state.svelte';
  import { bus } from '../bus.svelte';
  import { UNFILED_KEY } from '../defaults';
  import { PaneRuntime } from '../session.svelte';
  import { buildLayout, serializeTree } from '../layout';
  import type { Box, PaneDivider } from '../tiling';
  import TerminalPane from './TerminalPane.svelte';

  // One live runtime per *visited* workspace bucket (a project, or the "Unfiled"
  // bucket when no project is selected). Inactive buckets stay mounted but
  // hidden so their PTY sessions remain warm across project switches; only the
  // active bucket is shown. The persisted layout seeds a runtime on first visit.
  const runtimes = new SvelteMap<string, PaneRuntime>();

  // Cap on how many buckets may hold live PTY sessions at once (active included).
  // When a switch or a freshly-spawned pane pushes the count past this, the
  // least-recently-active live bucket is parked (its PTYs closed) so warm
  // sessions can't accumulate unboundedly as you hop between projects. The active
  // bucket is never evicted; empty buckets hold no PTYs and don't count. `mru`
  // records visit order (most-recent first) — visit *history*, so it is plain
  // (non-reactive) and is updated imperatively on each switch.
  const MAX_WARM_BUCKETS = 4;
  const mru: string[] = [];

  // The active bucket: the selected project's id, or the Unfiled sentinel.
  let bucketKey = $derived(app.data.activeProjectId ?? UNFILED_KEY);

  // Direction a launcher chip opens its new pane in: 'v' side-by-side (default)
  // or 'h' stacked. The profile bar's segmented toggle flips it. The keyboard
  // split shortcuts (Alt+Shift+±) clone the focused pane in an explicit
  // direction and intentionally leave this untouched.
  let splitDir = $state<'v' | 'h'>('v');

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

  // Build (and restore) a bucket's runtime on demand, returning the existing one
  // if already warm. Single source of runtime creation — used by the warm effect
  // below and by openProfile — so a bucket is never created empty when it has a
  // saved layout. Restoring drops leaves whose profile was deleted; if pruning
  // changed the tree, normalize storage once so the dead leaf doesn't linger.
  function ensureRuntime(key: string): PaneRuntime {
    const existing = runtimes.get(key);
    if (existing) return existing;
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
      const pruned = serializeTree(rt.tree, rt.panes);
      if (JSON.stringify(pruned) !== JSON.stringify(layout)) app.setLayout(key, pruned);
    }
    runtimes.set(key, rt);
    return rt;
  }

  // Record a bucket visit as most-recent in the MRU order (drives LRU eviction).
  function noteVisit(key: string): void {
    const i = mru.indexOf(key);
    if (i !== -1) mru.splice(i, 1);
    mru.unshift(key);
  }

  // Park the least-recently-active live buckets until at most MAX_WARM_BUCKETS
  // hold sessions. Empty buckets are free (no PTYs) and don't count; the active
  // bucket is never parked. Deleting a runtime unmounts its panes → onDestroy
  // closes the PTYs, killing that project's warm terminal processes.
  function evictBeyondCap(): void {
    const live = [...runtimes].filter(([, rt]) => rt.paneCount > 0).map(([k]) => k);
    let over = live.length - MAX_WARM_BUCKETS;
    if (over <= 0) return;
    const rank = (k: string): number => {
      const i = mru.indexOf(k);
      return i === -1 ? Infinity : i; // never-visited → most stale
    };
    const lruFirst = live.filter((k) => k !== bucketKey).sort((a, b) => rank(b) - rank(a));
    for (const key of lruFirst) {
      if (over <= 0) break;
      runtimes.delete(key);
      over--;
    }
  }

  // Lazy warm / restore: once persisted data has loaded, ensure the active
  // bucket has a runtime — built from its saved layout on first visit (the
  // restore-on-launch path). Gating on `app.loaded` is essential: `app.init()`
  // is async, so before it resolves `app.data` is the default (empty) blob;
  // creating a runtime then would shadow the real persisted layout forever
  // (especially the Unfiled bucket, since activeProjectId starts null). Recording
  // the visit and enforcing the warm-bucket cap also live here so they react to
  // both project switches and pane-count changes.
  $effect(() => {
    if (!app.loaded) return;
    ensureRuntime(bucketKey);
    noteVisit(bucketKey);
    evictBeyondCap();
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
  // Busy (streaming) session counts per bucket — drives the left panel's working
  // dot. Same shape and derivation as liveCounts, but reads each runtime's busy
  // set, which TerminalPane keeps current via its output idle timer.
  $effect(() => {
    const counts: Record<string, number> = {};
    for (const [key, rt] of runtimes) {
      const n = rt.busyCount;
      if (n > 0) counts[key] = n;
    }
    bus.busyCounts = counts;
  });

  // Side panels / terminal key handlers act on the *active* runtime. These read
  // current state at call time, so a single assignment is enough.
  bus.focusDir = (dir) => activeRuntime()?.focusNeighbor(dir);
  bus.resizeDir = (dir) => {
    const rt = activeRuntime();
    if (!rt) return;
    rt.resizeFocused(dir);
    persist(bucketKey);
  };
  bus.toggleMax = () => activeRuntime()?.toggleMax();
  bus.splitDir = (dir) => splitActive(dir);
  bus.closeFocused = () => closeActiveFocused();
  bus.parkProject = (key) => {
    if (key === bucketKey) return; // the active bucket would just respawn
    runtimes.delete(key); // unmounts its panes → onDestroy closes the PTYs
  };

  function openProfile(profile: Profile): void {
    const key = bucketKey;
    const rt = ensureRuntime(key);
    rt.addPane(prepareProfile(key, profile), splitDir);
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

  // --- pane divider drag: drag a boundary between two panes to re-balance them.
  // Mirrors App.svelte's side-panel resize — pointer capture keeps move/up events
  // flowing even while the cursor is over a terminal. The pointer's position
  // within the split's region becomes the new ratio; we persist once on release.
  let tilesEl: HTMLElement;
  let dragPath = $state<string | null>(null);
  let dragDir = $state<'v' | 'h'>('v');
  let dragArea: Box | null = null;

  function startDividerDrag(e: PointerEvent, d: PaneDivider): void {
    e.preventDefault();
    dragPath = d.path;
    dragDir = d.dir;
    dragArea = d.area;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onDividerDrag(e: PointerEvent): void {
    if (dragPath === null || dragArea === null) return;
    const rt = activeRuntime();
    if (!rt) return;
    const r = tilesEl.getBoundingClientRect();
    const ratio =
      dragDir === 'v'
        ? (((e.clientX - r.left) / r.width) * 100 - dragArea.left) / dragArea.width
        : (((e.clientY - r.top) / r.height) * 100 - dragArea.top) / dragArea.height;
    rt.setDividerRatio(dragPath, ratio);
  }
  function endDividerDrag(e: PointerEvent): void {
    if (dragPath === null) return;
    dragPath = null;
    dragArea = null;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    persist(bucketKey);
  }
</script>

<div class="profile-bar">
  <button
    class="btn icon"
    aria-label="새 터미널 분할 방향"
    aria-pressed={splitDir === 'h'}
    title={splitDir === 'v'
      ? '새 터미널: 좌우로 엶 · 클릭하면 위아래로'
      : '새 터미널: 위아래로 엶 · 클릭하면 좌우로'}
    onclick={() => (splitDir = splitDir === 'v' ? 'h' : 'v')}
  >{splitDir === 'v' ? '◧' : '⬓'}</button>
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

<div
  class="tiles"
  bind:this={tilesEl}
  class:drag-v={dragPath !== null && dragDir === 'v'}
  class:drag-h={dragPath !== null && dragDir === 'h'}
>
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
              <TerminalPane
                {profile}
                active={isActive && id === rt.focusedId}
                visible={isActive}
                onbusy={(b) => rt.setBusy(id, b)}
              />
            </div>
          {/if}
        {/each}
        <!-- Drag handles on every split boundary (active layer only). -->
        {#if isActive}
          {#each rt.dividers as d (d.path)}
            <div
              class="pane-divider {d.dir}"
              role="separator"
              aria-orientation={d.dir === 'v' ? 'vertical' : 'horizontal'}
              title="Drag to resize · Alt+Shift+Arrow"
              style={d.dir === 'v'
                ? `left:${d.pos}%;top:${d.area.top}%;height:${d.area.height}%`
                : `top:${d.pos}%;left:${d.area.left}%;width:${d.area.width}%`}
              onpointerdown={(e) => startDividerDrag(e, d)}
              onpointermove={onDividerDrag}
              onpointerup={endDividerDrag}
            ></div>
          {/each}
        {/if}
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
