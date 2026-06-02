<script lang="ts">
  import {
    computeTiles,
    leaf,
    splitPane,
    removePane,
    paneOrder,
    findNeighbor,
    type TileNode,
    type Box,
    type Dir,
  } from '../tiling';
  import type { Profile } from '../types';
  import { app } from '../state.svelte';
  import { bus } from '../bus.svelte';
  import TerminalPane from './TerminalPane.svelte';

  let tree = $state<TileNode | null>(null);
  let maximizedId = $state<number | null>(null);
  let focusedId = $state<number | null>(null);
  let nextId = 1;
  let panes = $state(new Map<number, Profile>());

  const AREA: Box = { left: 0, top: 0, width: 100, height: 100 };

  let order = $derived(tree ? paneOrder(tree) : []);
  let allTiles = $derived(tree ? computeTiles(tree, AREA) : new Map<number, Box>());

  function boxFor(id: number): Box {
    if (maximizedId === id) return AREA;
    return allTiles.get(id) ?? AREA;
  }
  function isHidden(id: number): boolean {
    return maximizedId !== null && id !== maximizedId;
  }

  function focus(id: number) {
    focusedId = id;
  }

  // Alt+Arrow: move focus to the spatially adjacent pane. While maximized the
  // maximize follows, so you flip through panes full-screen. Registered on the
  // shared bus; the focused terminal's key handler calls it.
  function focusNeighbor(dir: Dir) {
    if (focusedId === null) return;
    const next = findNeighbor(allTiles, focusedId, dir);
    if (next === null) return;
    focusedId = next;
    if (maximizedId !== null) maximizedId = next;
  }
  bus.focusDir = focusNeighbor;

  function addPane(profile: Profile, dir: 'v' | 'h') {
    const id = nextId++;
    const next = new Map(panes);
    next.set(id, profile);
    panes = next;
    if (tree === null || focusedId === null) tree = leaf(id);
    else tree = splitPane(tree, focusedId, id, dir);
    focusedId = id;
    maximizedId = null;
    bus.hasFocus = true;
  }

  function openProfile(profile: Profile) {
    // The selected project's path overrides the profile's own working directory,
    // so the new session opens there (passed to WSL as `--cd <path>`).
    const project = app.activeProject;
    addPane(project?.path ? { ...profile, cwd: project.path } : profile, 'v');
  }

  function splitFocused(dir: 'v' | 'h') {
    if (focusedId === null) return;
    const profile = panes.get(focusedId);
    if (profile) addPane(profile, dir);
  }

  function closePane(id: number) {
    tree = tree ? removePane(tree, id) : null;
    const next = new Map(panes);
    next.delete(id);
    panes = next;
    if (maximizedId === id) maximizedId = null;
    if (focusedId === id) {
      const ord = tree ? paneOrder(tree) : [];
      focusedId = ord.length ? ord[0] : null;
    }
    if (!tree) bus.hasFocus = false;
  }

  function toggleMax() {
    if (focusedId === null) return;
    maximizedId = maximizedId === null ? focusedId : null;
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
  <button class="btn icon" title="Split vertical" onclick={() => splitFocused('v')}>◧</button>
  <button class="btn icon" title="Split horizontal" onclick={() => splitFocused('h')}>⬓</button>
  <button class="btn icon" title="Maximize / restore" onclick={toggleMax}>⛶</button>
  <button class="btn icon" title="Close focused" onclick={() => focusedId !== null && closePane(focusedId)}>✕</button>
</div>

<div class="tiles">
  {#if tree === null}
    <div class="center-empty">
      <div>No sessions open</div>
      <div class="muted">Pick a profile above to launch a WSL terminal.</div>
    </div>
  {:else}
    {#each order as id (id)}
      {@const profile = panes.get(id)}
      {#if profile}
        {@const box = boxFor(id)}
        <div
          class="pane"
          class:focused={id === focusedId}
          style="left:{box.left}%;top:{box.top}%;width:{box.width}%;height:{box.height}%;{isHidden(id) ? 'display:none' : ''}"
          onpointerdowncapture={() => focus(id)}
          role="presentation"
        >
          <div class="pane-head">
            <span class="dot" style="background:{profile.color};width:8px;height:8px;border-radius:50%"></span>
            <span class="grow">{profile.name}{profile.command ? ` · ${profile.command}` : ''}</span>
            <button class="btn icon" title="Close" onclick={() => closePane(id)}>✕</button>
          </div>
          <TerminalPane {profile} active={id === focusedId} />
        </div>
      {/if}
    {/each}
  {/if}
</div>
