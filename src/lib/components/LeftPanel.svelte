<script lang="ts">
  import { app } from '../state.svelte';
  import { bus, INSERT_DRAG_TYPE } from '../bus.svelte';
  import Modal from './Modal.svelte';
  import type { SavedQuery } from '../types';

  // Digits available as Alt+<digit> query shortcuts (see App.svelte's handler).
  const HOTKEY_DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

  let tab = $state<'project' | 'query'>('project');
  // The add-project form lives in a modal (opened by the panel-head "+") so the
  // panel body stays a clean project list.
  let showAddProject = $state(false);
  let projectPath = $state('');
  let projectName = $state('');

  // Focus the first field when the add-project modal opens.
  function autofocus(node: HTMLElement) {
    node.focus();
  }
  // Focus an inline edit field and select its contents so the user can retype
  // or extend it straight away (used when entering edit mode).
  function focusSelect(node: HTMLInputElement | HTMLTextAreaElement) {
    node.focus();
    node.select();
  }
  // Svelte action: grow an edit textarea to fit its content (height set inline,
  // capped by CSS) so multi-line todos/queries are fully visible instead of
  // being crammed into a fixed-height box.
  function autogrow(node: HTMLTextAreaElement) {
    const grow = () => {
      node.style.height = 'auto';
      node.style.height = `${node.scrollHeight}px`;
    };
    grow();
    node.addEventListener('input', grow);
    return { destroy: () => node.removeEventListener('input', grow) };
  }
  // Shared edit-field key handling: Escape cancels, Ctrl/Cmd+Enter saves; plain
  // Enter inserts a newline so multi-line items can be edited in place.
  function editKeydown(e: KeyboardEvent, save: () => void, cancel: () => void) {
    if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      save();
    }
  }
  let todoText = $state('');
  let queryName = $state('');
  let queryText = $state('');
  // Insert mode for the query being created: true = submit (append Enter),
  // false = append only. Mirrors SavedQuery.submit.
  let querySubmit = $state(true);

  function addProject() {
    const p = app.addProject(projectPath, projectName);
    if (p) {
      projectPath = '';
      projectName = '';
      showAddProject = false;
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
      app.addQuery(n, t, querySubmit);
      queryName = '';
      queryText = '';
    }
  }
  // `enter` controls whether the insert is submitted (Enter appended) or just
  // appended. Todos always submit; queries pass their per-query `submit` flag.
  function sendQuery(text: string, enter = true) {
    bus.send(text, enter);
  }
  function sendQueryAll(text: string, enter = true) {
    bus.sendAll(text, enter);
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

  // --- inline editing ---
  let editingTodoId = $state<string | null>(null);
  let editTodoText = $state('');
  function startEditTodo(id: string, text: string) {
    editingTodoId = id;
    editTodoText = text;
  }
  function saveEditTodo() {
    if (editingTodoId === null) return;
    const t = editTodoText.trim();
    if (t) app.editTodo(editingTodoId, t);
    editingTodoId = null;
  }
  function cancelEditTodo() {
    editingTodoId = null;
  }

  let editingQueryId = $state<string | null>(null);
  let editQueryName = $state('');
  let editQueryText = $state('');
  function startEditQuery(id: string, name: string, text: string) {
    editingQueryId = id;
    editQueryName = name;
    editQueryText = text;
  }
  function saveEditQuery() {
    if (editingQueryId === null) return;
    const n = editQueryName.trim();
    const t = editQueryText.trim();
    if (n && t) app.editQuery(editingQueryId, n, t);
    editingQueryId = null;
  }
  function cancelEditQuery() {
    editingQueryId = null;
  }

  // Assigning an Alt+digit that another query already owns silently stole it
  // before; now we confirm first. `hotkeyConflict` holds the pending change
  // while the modal is open (null = no prompt).
  let hotkeyConflict = $state<{
    qId: string;
    qName: string;
    digit: number;
    otherName: string;
  } | null>(null);
  function changeHotkey(e: Event & { currentTarget: HTMLSelectElement }, q: SavedQuery) {
    const digit = e.currentTarget.value ? Number(e.currentTarget.value) : null;
    if (digit !== null) {
      const other = app.data.queries.find((x) => x.id !== q.id && x.hotkey === digit);
      if (other) {
        // Revert the visible chip to its current value and ask before stealing.
        e.currentTarget.value = q.hotkey === null ? '' : String(q.hotkey);
        hotkeyConflict = { qId: q.id, qName: q.name, digit, otherName: other.name };
        return;
      }
    }
    app.setQueryHotkey(q.id, digit);
  }
  function confirmHotkeyReassign() {
    if (hotkeyConflict) app.setQueryHotkey(hotkeyConflict.qId, hotkeyConflict.digit);
    hotkeyConflict = null;
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
  {#if tab === 'project'}
    <button class="btn icon" title="Add project" onclick={() => (showAddProject = true)}>+</button>
  {/if}
  <button class="btn icon" title="Hide panel" onclick={() => app.toggleLeftPanel()}>‹</button>
</div>

<div class="panel-body">
  {#if tab === 'project'}
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
          {#if bus.liveCounts[p.id]}
            <span class="live-badge" title="{bus.liveCounts[p.id]} live session(s)">{bus.liveCounts[p.id]}</span>
            {#if app.data.activeProjectId !== p.id}
              <button
                class="btn icon"
                title="Park — close this project's {bus.liveCounts[p.id]} session(s) to free memory (layout is kept; reopens on next visit)"
                onclick={() => bus.parkProject(p.id)}>⏸</button
              >
            {/if}
          {/if}
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
          {#if editingTodoId === t.id}
            <div class="list-row top">
              <textarea
                class="field edit-area grow-flex"
                rows="1"
                bind:value={editTodoText}
                use:focusSelect
                use:autogrow
                onkeydown={(e) => editKeydown(e, saveEditTodo, cancelEditTodo)}
              ></textarea>
              <button class="btn icon" title="Save (Ctrl+Enter)" onclick={saveEditTodo}>✓</button>
              <button class="btn icon" title="Cancel (Esc)" onclick={cancelEditTodo}>✕</button>
            </div>
          {:else}
            <div class="list-row top row-float">
              <input type="checkbox" checked={t.done} onchange={() => app.toggleTodo(t.id)} />
              <span
                class="grow wrap"
                class:done={t.done}
                draggable="true"
                role="presentation"
                ondblclick={() => startEditTodo(t.id, t.text)}
                ondragstart={(e) => startDrag(e, t.text)}
                ondragend={() => (bus.dragText = null)}
                title="Double-click to edit · drag onto a terminal to insert">{t.text}</span
              >
              <div class="row-actions">
                <button
                  class="btn icon"
                  title="Send to focused terminal"
                  disabled={!bus.hasFocus}
                  onclick={() => sendQuery(t.text)}>➤</button
                >
                <button class="btn icon" title="Edit" onclick={() => startEditTodo(t.id, t.text)}>✎</button>
                <button
                  class="btn icon"
                  title={copiedId === t.id ? 'Copied!' : 'Copy'}
                  onclick={() => copyText(t.id, t.text)}>{copiedId === t.id ? '✓' : '⧉'}</button
                >
                <button class="btn icon" title="Delete" onclick={() => app.deleteTodo(t.id)}>✕</button>
              </div>
            </div>
          {/if}
        {/each}
      {/if}
    {/if}
  {:else}
    <div style="padding:8px;display:flex;flex-direction:column;gap:6px">
      <input class="field" placeholder="Query name" bind:value={queryName} />
      <textarea class="field" rows="3" placeholder="Query text sent to the focused terminal" bind:value={queryText}></textarea>
      <div style="display:flex;gap:6px;align-items:center">
        <select
          class="select-lg"
          title="What happens when this query is inserted: submit (append Enter) or append only"
          bind:value={querySubmit}
        >
          <option value={true}>↵ Submit</option>
          <option value={false}>… Append</option>
        </select>
        <button class="btn" style="flex:1" onclick={addQuery}>Save</button>
      </div>
    </div>
    {#if app.data.queries.length === 0}
      <div class="empty">No saved queries.</div>
    {:else}
      <div class="section-head">Saved queries · {app.data.queries.length}</div>
      {#each app.data.queries as q (q.id)}
        {#if editingQueryId === q.id}
          <div class="list-row top" style="flex-direction:column;align-items:stretch;gap:6px">
            <input
              class="field"
              placeholder="Query name"
              bind:value={editQueryName}
              use:focusSelect
              onkeydown={(e) => editKeydown(e, saveEditQuery, cancelEditQuery)}
            />
            <textarea
              class="field edit-area"
              rows="1"
              placeholder="Query text sent to the focused terminal"
              bind:value={editQueryText}
              use:autogrow
              onkeydown={(e) => editKeydown(e, saveEditQuery, cancelEditQuery)}
            ></textarea>
            <div style="display:flex;gap:6px;justify-content:flex-end">
              <button class="btn icon" title="Save (Ctrl+Enter)" onclick={saveEditQuery}>✓</button>
              <button class="btn icon" title="Cancel (Esc)" onclick={cancelEditQuery}>✕</button>
            </div>
          </div>
        {:else}
          <div class="list-row top row-float query-item">
            <div class="grow wrap">
              <div class="q-title">
                <!-- Hotkey + insert-mode are managed inline as always-visible
                     chips (click to change); they're deliberately kept out of
                     the hover action cluster so it stays narrow at min width.
                     {#key} re-creates the <select> whenever the bound hotkey
                     changes (a steal, or a confirmed reassign) so its displayed
                     value re-syncs even after we revert it by hand on a clash. -->
                {#key q.hotkey}
                  <select
                    class="chip-select"
                    class:assigned={q.hotkey !== null}
                    title="Keyboard shortcut — Alt+digit inserts this query"
                    onchange={(e) => changeHotkey(e, q)}
                  >
                    <option value="" selected={q.hotkey === null}>No hotkey</option>
                    {#each HOTKEY_DIGITS as d}
                      <option value={d} selected={q.hotkey === d}>Alt+{d}</option>
                    {/each}
                  </select>
                {/key}
                <button
                  class="chip-mode"
                  title={q.submit
                    ? 'Submits on insert (Enter appended) — click for append-only'
                    : 'Appends only (no Enter) — click to submit on insert'}
                  onclick={() => app.setQuerySubmit(q.id, !q.submit)}
                  >{q.submit ? '↵ Submit' : '… Append'}</button
                >
                <span
                  class="q-name"
                  draggable="true"
                  role="presentation"
                  ondblclick={() => startEditQuery(q.id, q.name, q.text)}
                  ondragstart={(e) => startDrag(e, q.text)}
                  ondragend={() => (bus.dragText = null)}
                  title="Double-click to edit · drag onto a terminal to insert">{q.name}</span
                >
              </div>
              {#if q.text.trim() !== q.name.trim()}
                <div
                  class="muted query-text"
                  draggable="true"
                  role="presentation"
                  ondblclick={() => startEditQuery(q.id, q.name, q.text)}
                  ondragstart={(e) => startDrag(e, q.text)}
                  ondragend={() => (bus.dragText = null)}
                  title={q.text}
                >
                  {q.text}
                </div>
              {/if}
            </div>
            <div class="row-actions">
              <button
                class="btn icon"
                title="Send to focused terminal"
                disabled={!bus.hasFocus}
                onclick={() => sendQuery(q.text, q.submit)}>➤</button
              >
              <button
                class="btn icon"
                title="Send to all sessions"
                disabled={!bus.hasFocus}
                onclick={() => sendQueryAll(q.text, q.submit)}>⇶</button
              >
              <button
                class="btn icon"
                title="Edit"
                onclick={() => startEditQuery(q.id, q.name, q.text)}>✎</button
              >
              <button
                class="btn icon"
                title={copiedId === q.id ? 'Copied!' : 'Copy'}
                onclick={() => copyText(q.id, q.text)}>{copiedId === q.id ? '✓' : '⧉'}</button
              >
              <button class="btn icon" title="Delete" onclick={() => app.deleteQuery(q.id)}>✕</button>
            </div>
          </div>
        {/if}
      {/each}
    {/if}
  {/if}
</div>

{#if showAddProject}
  <Modal title="Add project" onclose={() => (showAddProject = false)}>
    <div style="display:flex;flex-direction:column;gap:6px">
      <input
        class="field"
        placeholder="Path, e.g. /mnt/c/Users/me/project"
        bind:value={projectPath}
        use:autofocus
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
  </Modal>
{/if}

{#if hotkeyConflict}
  <Modal title="Reassign shortcut?" onclose={() => (hotkeyConflict = null)}>
    <div style="display:flex;flex-direction:column;gap:14px">
      <p style="margin:0;line-height:1.5">
        <span class="kbd">Alt+{hotkeyConflict.digit}</span> is already assigned to
        “{hotkeyConflict.otherName}”. Move it to “{hotkeyConflict.qName}”? The other query
        will be left with no shortcut.
      </p>
      <div style="display:flex;gap:6px;justify-content:flex-end">
        <button class="btn" onclick={() => (hotkeyConflict = null)}>Cancel</button>
        <button class="btn accent" onclick={confirmHotkeyReassign}>Reassign</button>
      </div>
    </div>
  </Modal>
{/if}

<style>
  /* Inline edit textarea (todo/query): the height is set to fit the content by
     the `autogrow` action, capped here so a very long item scrolls inside the
     box instead of pushing the whole panel. Wraps normally (unlike the .grow
     display span, which truncates to one line). */
  .edit-area {
    resize: none;
    min-height: 30px;
    max-height: 40vh;
    overflow-y: auto;
    line-height: 1.4;
    white-space: pre-wrap;
  }
  /* Share the row width with the Save/Cancel buttons (the todo edit row is a
     horizontal flex; .grow can't be reused here as it forces nowrap). */
  .grow-flex {
    flex: 1;
    min-width: 0;
  }

  /* Count of warm (live) terminal sessions a project currently holds. */
  .live-badge {
    flex: 0 0 auto;
    min-width: 16px;
    text-align: center;
    padding: 0 5px;
    border-radius: 999px;
    font-size: 10px;
    line-height: 16px;
    color: var(--bg);
    background: var(--accent);
  }
</style>
