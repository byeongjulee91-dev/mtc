<script lang="ts">
  import { onMount } from 'svelte';
  import { app } from './lib/state.svelte';
  import { bus } from './lib/bus.svelte';
  import LeftPanel from './lib/components/LeftPanel.svelte';
  import CenterPanel from './lib/components/CenterPanel.svelte';
  import RightPanel from './lib/components/RightPanel.svelte';

  onMount(() => {
    void app.init();
  });

  // --- left-panel resize: drag the divider sitting between the panel and center.
  // The panel's left edge is the window's left edge, so the pointer's x position
  // is the desired width (clamped in state). Pointer capture keeps events flowing
  // to the handle even while the cursor is over a terminal pane.
  let resizing = $state(false);
  function startResize(e: PointerEvent) {
    e.preventDefault();
    resizing = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onResize(e: PointerEvent) {
    if (resizing) app.setLeftPanelWidth(e.clientX);
  }
  function endResize(e: PointerEvent) {
    if (!resizing) return;
    resizing = false;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
  }

  let leftW = $derived(app.data.leftPanelCollapsed ? 0 : app.data.leftPanelWidth);
</script>

<div class="app" class:resizing style="--left-w:{leftW}px">
  <div class="panel left">
    <LeftPanel />
  </div>

  <div class="center">
    <CenterPanel />
  </div>

  <div class="panel right">
    <RightPanel />
  </div>

  {#if app.data.leftPanelCollapsed}
    <!-- Hover zone at the far left: the reveal tab fades in only when the
         pointer is near the edge, so it stays out of the way otherwise. -->
    <div class="reveal-zone">
      <button class="reveal-left" title="Show panel" onclick={() => app.toggleLeftPanel()}>›</button>
    </div>
  {:else}
    <!-- Drag divider on the gap between the left panel and the center. -->
    <div
      class="resize-handle"
      title="Drag to resize · double-click to hide"
      role="separator"
      aria-orientation="vertical"
      onpointerdown={startResize}
      onpointermove={onResize}
      onpointerup={endResize}
      ondblclick={() => app.toggleLeftPanel()}
    ></div>
  {/if}

  <div class="statusbar">
    <span>mtc</span>
    <span class="muted">{app.standalone ? 'browser preview (no terminals)' : 'WSL desktop'}</span>
    <span style="flex:1"></span>
    <span class="muted">{bus.hasFocus ? 'terminal focused' : 'no session'}</span>
    <span class="muted">{app.skills.length} skills</span>
  </div>
</div>
