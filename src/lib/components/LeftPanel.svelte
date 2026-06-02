<script lang="ts">
  import { app } from '../state.svelte';
  import { bus, INSERT_DRAG_TYPE } from '../bus.svelte';

  let tab = $state<'project' | 'query'>('project');
  let projectPath = $state('');
  let projectName = $state('');
  let todoText = $state('');
  let queryName = $state('');
  let queryText = $state('');

  function addProject() {
    const p = app.addProject(projectPath, projectName);
    if (p) {
      projectPath = '';
      projectName = '';
    }
  }
  function addTodo() {
    const t = todoText.trim();
    if (t) {
      app.addTodo(t);
      todoText = '';
    }
  }
  function addQuery() {
    const n = queryName.trim();
    const t = queryText.trim();
    if (n && t) {
      app.addQuery(n, t);
      queryName = '';
      queryText = '';
    }
  }
  function sendQuery(text: string) {
    bus.send(text, true);
  }
  // Drag a todo/query onto a terminal pane to insert its text into that
  // session's input (see TerminalPane's drop handler). The text is shared via
  // `bus.dragText` so panes can accept the drop even in WebViews that strip
  // custom MIME types; the DataTransfer copy is a native/standards fallback.
  function startDrag(e: DragEvent, text: string) {
    bus.dragText = text;
    if (e.dataTransfer) {
      e.dataTransfer.setData(INSERT_DRAG_TYPE, text);
      e.dataTransfer.setData('text/plain', text);
      e.dataTransfer.effectAllowed = 'copy';
    }
  }
  let copiedId = $state<string | null>(null);
  let copyTimer: ReturnType<typeof setTimeout> | undefined;
  async function copyText(id: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      copiedId = id;
      clearTimeout(copyTimer);
      copyTimer = setTimeout(() => (copiedId = null), 1200);
    } catch {
      /* clipboard unavailable (e.g. insecure context) — ignore */
    }
  }
</script>

<div class="panel-head">
  <button class="tab" class:active={tab === 'project'} onclick={() => (tab = 'project')}>Project</button>
  <button class="tab" class:active={tab === 'query'} onclick={() => (tab = 'query')}>Query</button>
  <span style="flex:1"></span>
  <button class="btn icon" title="Hide panel" onclick={() => app.toggleLeftPanel()}>‹</button>
</div>

<div class="panel-body">
  {#if tab === 'project'}
    <div style="padding:8px;display:flex;flex-direction:column;gap:6px">
      <input
        class="field"
        placeholder="Path, e.g. /mnt/c/Users/me/project"
        bind:value={projectPath}
        onkeydown={(e) => e.key === 'Enter' && addProject()}
      />
      <input
        class="field"
        placeholder="Name (optional)"
        bind:value={projectName}
        onkeydown={(e) => e.key === 'Enter' && addProject()}
      />
      <button class="btn" onclick={addProject}>Add project</button>
    </div>
    <div class="empty" style="padding-top:0">
      Select a project to scope its todos and open new sessions in its directory.
    </div>
    {#if app.data.projects.length === 0}
      <div class="empty">No projects yet.</div>
    {:else}
      {#each app.data.projects as p (p.id)}
        <div class="list-row" class:sel={app.data.activeProjectId === p.id}>
          <button
            class="path-pick grow"
            title={app.data.activeProjectId === p.id ? 'Active project' : 'Select project'}
            onclick={() => app.selectProject(p.id)}
          >
            <span class="path-mark">{app.data.activeProjectId === p.id ? '●' : '○'}</span>
            <span class="grow">
              <div>{p.name || p.path}</div>
              {#if p.name}
                <div class="muted" style="font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{p.path}</div>
              {/if}
            </span>
          </button>
          <button class="btn icon" title="Delete" onclick={() => app.removeProject(p.id)}>✕</button>
        </div>
      {/each}
    {/if}

    <!-- Todos for the selected project, shown below the project list. -->
    {#if app.activeProject}
      <div class="section-head">
        Todo · {app.activeProject.name || app.activeProject.path}
      </div>
      <div style="padding:8px;display:flex;gap:6px">
        <input
          class="field"
          placeholder="New todo…"
          bind:value={todoText}
          onkeydown={(e) => e.key === 'Enter' && addTodo()}
        />
        <button class="btn" onclick={addTodo}>+</button>
      </div>
      {#if app.activeProject.todos.length === 0}
        <div class="empty">No todos yet.</div>
      {:else}
        {#each app.activeProject.todos as t (t.id)}
          <div class="list-row top row-float">
            <input type="checkbox" checked={t.done} onchange={() => app.toggleTodo(t.id)} />
            <span
              class="grow wrap"
              class:done={t.done}
              draggable="true"
              role="presentation"
              ondragstart={(e) => startDrag(e, t.text)}
              ondragend={() => (bus.dragText = null)}
              title="Drag onto a terminal to insert">{t.text}</span
            >
            <div class="row-actions">
              <button
                class="btn icon"
                title="Send to focused terminal"
                disabled={!bus.hasFocus}
                onclick={() => sendQuery(t.text)}>➤</button
              >
              <button
                class="btn icon"
                title={copiedId === t.id ? 'Copied!' : 'Copy'}
                onclick={() => copyText(t.id, t.text)}>{copiedId === t.id ? '✓' : '⧉'}</button
              >
              <button class="btn icon" title="Delete" onclick={() => app.deleteTodo(t.id)}>✕</button>
            </div>
          </div>
        {/each}
      {/if}
    {/if}
  {:else}
    <div style="padding:8px;display:flex;flex-direction:column;gap:6px">
      <input class="field" placeholder="Query name" bind:value={queryName} />
      <textarea class="field" rows="2" placeholder="Query text sent to the focused terminal" bind:value={queryText}></textarea>
      <button class="btn" onclick={addQuery}>Save query</button>
    </div>
    {#if app.data.queries.length === 0}
      <div class="empty">No saved queries.</div>
    {:else}
      {#each app.data.queries as q (q.id)}
        <div class="list-row top row-float">
          <div
            class="grow wrap"
            draggable="true"
            role="presentation"
            ondragstart={(e) => startDrag(e, q.text)}
            ondragend={() => (bus.dragText = null)}
            title="Drag onto a terminal to insert"
          >
            <div>{q.name}</div>
            <div class="muted query-text">{q.text}</div>
          </div>
          <div class="row-actions">
            <button
              class="btn icon"
              title="Send to focused terminal"
              disabled={!bus.hasFocus}
              onclick={() => sendQuery(q.text)}>➤</button
            >
            <button
              class="btn icon"
              title={copiedId === q.id ? 'Copied!' : 'Copy'}
              onclick={() => copyText(q.id, q.text)}>{copiedId === q.id ? '✓' : '⧉'}</button
            >
            <button class="btn icon" title="Delete" onclick={() => app.deleteQuery(q.id)}>✕</button>
          </div>
        </div>
      {/each}
    {/if}
  {/if}
</div>
