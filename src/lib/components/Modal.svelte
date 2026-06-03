<script lang="ts">
  import type { Snippet } from 'svelte';

  // A centered dialog over a full-window scrim. Used to lift forms out of the
  // side panels (e.g. add-project) so the panels keep their space for lists.
  // Closes on the ✕ button, a backdrop click, or Escape; the caller owns the
  // open/closed flag and renders <Modal> only while it should be shown.
  interface Props {
    title?: string;
    onclose: () => void;
    children: Snippet;
  }
  let { title = '', onclose, children }: Props = $props();

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onclose();
    }
  }
  // Close only when the scrim itself is clicked, not the dialog inside it.
  function onBackdrop(e: MouseEvent) {
    if (e.target === e.currentTarget) onclose();
  }
</script>

<svelte:window onkeydown={onKeydown} />

<!-- The scrim is presentational; keyboard close is handled on the window above. -->
<div class="modal-backdrop" role="presentation" onclick={onBackdrop}>
  <div class="modal" role="dialog" aria-modal="true" aria-label={title}>
    <div class="modal-head">
      <span class="modal-title">{title}</span>
      <button class="btn icon" title="Close" onclick={onclose}>✕</button>
    </div>
    <div class="modal-body">
      {@render children()}
    </div>
  </div>
</div>
