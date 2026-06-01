<script lang="ts">
  import { app } from '../state.svelte';
  import { bus } from '../bus.svelte';

  let tab = $state<'todo' | 'query'>('todo');
  let todoText = $state('');
  let queryName = $state('');
  let queryText = $state('');

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
</script>

<div class="panel-head">
  <button class="tab" class:active={tab === 'todo'} onclick={() => (tab = 'todo')}>Todos</button>
  <button class="tab" class:active={tab === 'query'} onclick={() => (tab = 'query')}>Queries</button>
</div>

<div class="panel-body">
  {#if tab === 'todo'}
    <div style="padding:8px;display:flex;gap:6px">
      <input
        class="field"
        placeholder="New todo…"
        bind:value={todoText}
        onkeydown={(e) => e.key === 'Enter' && addTodo()}
      />
      <button class="btn" onclick={addTodo}>+</button>
    </div>
    {#if app.data.todos.length === 0}
      <div class="empty">No todos yet.</div>
    {:else}
      {#each app.data.todos as t (t.id)}
        <div class="list-row">
          <input type="checkbox" checked={t.done} onchange={() => app.toggleTodo(t.id)} />
          <span class="grow" class:done={t.done}>{t.text}</span>
          <button class="btn icon" title="Delete" onclick={() => app.deleteTodo(t.id)}>✕</button>
        </div>
      {/each}
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
        <div class="list-row">
          <div class="grow">
            <div>{q.name}</div>
            <div class="muted" style="font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{q.text}</div>
          </div>
          <button class="btn icon" title="Send to focused terminal" disabled={!bus.hasFocus} onclick={() => sendQuery(q.text)}>➤</button>
          <button class="btn icon" title="Delete" onclick={() => app.deleteQuery(q.id)}>✕</button>
        </div>
      {/each}
    {/if}
  {/if}
</div>
