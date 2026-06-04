<script lang="ts">
  import { onMount } from 'svelte';
  import { app } from './lib/state.svelte';
  import { bus } from './lib/bus.svelte';
  import LeftPanel from './lib/components/LeftPanel.svelte';
  import CenterPanel from './lib/components/CenterPanel.svelte';
  import RightPanel from './lib/components/RightPanel.svelte';

  onMount(() => {
    void app.init();
    // Global query shortcuts: Alt+1..9 sends the bound query to the focused
    // terminal. We listen on the window in the capture phase and use the
    // physical key (`e.code` = "Digit1".."Digit9") so layout remapping doesn't
    // matter; capturing here also stops xterm from forwarding the keystroke to
    // the PTY before we can act on it.
    function onHotkey(e: KeyboardEvent) {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const m = /^Digit([1-9])$/.exec(e.code);
      if (!m) return;
      const q = app.queryForHotkey(Number(m[1]));
      if (!q) return;
      e.preventDefault();
      e.stopPropagation();
      bus.send(q.text, q.submit);
    }
    window.addEventListener('keydown', onHotkey, { capture: true });

    // Re-count the active project's modified tracked files when the window
    // regains focus — files commonly change (edits, commits) while the user is
    // away in their editor/terminal, so the badge stays current.
    function onFocus() {
      void app.refreshGitModifiedCount();
    }
    window.addEventListener('focus', onFocus);

    return () => {
      window.removeEventListener('keydown', onHotkey, { capture: true });
      window.removeEventListener('focus', onFocus);
    };
  });

  // --- side-panel resize: drag the divider sitting between a panel and the
  // center. The left panel's left edge is the window's left edge, so the
  // pointer's x is its width; the right panel's right edge is the window's right
  // edge, so its width is (window width − pointer x). Both are clamped in state.
  // Pointer capture keeps events flowing to the handle even while the cursor is
  // over a terminal pane.
  let resizing = $state<'left' | 'right' | null>(null);
  function startResize(side: 'left' | 'right', e: PointerEvent) {
    e.preventDefault();
    resizing = side;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onResize(e: PointerEvent) {
    if (resizing === 'left') app.setLeftPanelWidth(e.clientX);
    else if (resizing === 'right') app.setRightPanelWidth(window.innerWidth - e.clientX);
  }
  function endResize(e: PointerEvent) {
    if (!resizing) return;
    resizing = null;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
  }

  let leftW = $derived(app.data.leftPanelCollapsed ? 0 : app.data.leftPanelWidth);
  let rightW = $derived(app.data.rightPanelCollapsed ? 0 : app.data.rightPanelWidth);
</script>

<div class="app" class:resizing={!!resizing} style="--left-w:{leftW}px; --right-w:{rightW}px">
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
    <div class="reveal-zone left">
      <button class="reveal-tab left" title="Show panel" onclick={() => app.toggleLeftPanel()}>›</button>
    </div>
  {:else}
    <!-- Drag divider on the gap between the left panel and the center. -->
    <div
      class="resize-handle left"
      title="Drag to resize · double-click to hide"
      role="separator"
      aria-orientation="vertical"
      onpointerdown={(e) => startResize('left', e)}
      onpointermove={onResize}
      onpointerup={endResize}
      ondblclick={() => app.toggleLeftPanel()}
    ></div>
  {/if}

  {#if app.data.rightPanelCollapsed}
    <!-- Hover zone at the far right: mirror of the left reveal tab. -->
    <div class="reveal-zone right">
      <button class="reveal-tab right" title="Show panel" onclick={() => app.toggleRightPanel()}>‹</button>
    </div>
  {:else}
    <!-- Drag divider on the gap between the center and the right panel. -->
    <div
      class="resize-handle right"
      title="Drag to resize · double-click to hide"
      role="separator"
      aria-orientation="vertical"
      onpointerdown={(e) => startResize('right', e)}
      onpointermove={onResize}
      onpointerup={endResize}
      ondblclick={() => app.toggleRightPanel()}
    ></div>
  {/if}
</div>
