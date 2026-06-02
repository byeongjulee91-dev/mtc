import type { Dir } from './tiling';

/**
 * A tiny shared bus so the side panels can act on the currently-focused
 * terminal pane without prop-drilling through the tiling tree. The focused
 * pane registers its sender here; panels call `bus.send(...)`.
 */
class Bus {
  /** Send text to the focused terminal session (optionally followed by Enter). */
  send: (text: string, enter?: boolean) => void = () => {};
  /**
   * Move terminal focus to the spatially adjacent pane (Alt+Arrow). The tiling
   * container registers this; the focused terminal's key handler calls it.
   */
  focusDir: (dir: Dir) => void = () => {};
  /** Whether at least one terminal pane is open. */
  hasFocus = $state(false);
  /**
   * Text currently being dragged from a side panel (a todo/query), or `null`
   * when no such drag is in progress. Terminal panes read this to accept the
   * drop and insert the text. We keep it here rather than relying solely on
   * `DataTransfer` because some WebViews (notably WebView2) strip custom MIME
   * types from `dataTransfer.types` during `dragover`, which would otherwise
   * make panes reject the drop (the "no-drop" cursor).
   */
  dragText = $state<string | null>(null);
}

export const bus = new Bus();

/**
 * dataTransfer MIME type used when dragging a todo/query from a side panel onto
 * a terminal pane. Scoping to a custom type means panes react only to our own
 * drags — not to arbitrary text or file drops.
 */
export const INSERT_DRAG_TYPE = 'application/x-mtc-insert';
