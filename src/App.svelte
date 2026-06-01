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
</script>

<div class="app">
  <div class="panel left">
    <LeftPanel />
  </div>

  <div class="center">
    <CenterPanel />
  </div>

  <div class="panel right">
    <RightPanel />
  </div>

  <div class="statusbar">
    <span>mtc</span>
    <span class="muted">{app.standalone ? 'browser preview (no terminals)' : 'WSL desktop'}</span>
    <span style="flex:1"></span>
    <span class="muted">{bus.hasFocus ? 'terminal focused' : 'no session'}</span>
    <span class="muted">{app.skills.length} skills</span>
  </div>
</div>
