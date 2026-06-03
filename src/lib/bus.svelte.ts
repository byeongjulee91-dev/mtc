import type { Dir } from './tiling';

/**
 * A tiny shared bus so the side panels can act on the currently-focused
 * terminal pane without prop-drilling through the tiling tree. The focused
 * pane registers its sender here; panels call `bus.send(...)`.
 */
type Sender = (text: string, enter?: boolean) => void;

class Bus {
  /** Send text to the focused terminal session (optionally followed by Enter). */
  send: Sender = () => {};
  /**
   * Every open terminal's sender. Panes register on mount and unregister on
   * destroy so `sendAll` can broadcast to all sessions at once (e.g. `/clear`).
   */
  #senders = new Set<Sender>();
  /**
   * Move terminal focus to the spatially adjacent pane (Alt+Arrow). The tiling
   * container registers this; the focused terminal's key handler calls it.
   */
  focusDir: (dir: Dir) => void = () => {};
  /**
   * Resize the focused pane along an axis (Alt+Shift+Arrow): Left/Right move the
   * nearest vertical divider, Up/Down the nearest horizontal one. Registered by
   * the tiling container; the focused terminal's key handler calls it.
   */
  resizeDir: (dir: Dir) => void = () => {};
  /** Maximize / restore the focused pane (Alt+Enter). Registered by the tiling
   *  container; the focused terminal's key handler calls it. */
  toggleMax: () => void = () => {};
  /** Split the focused pane: 'v' side-by-side (Alt+Shift++), 'h' stacked
   *  (Alt+Shift+-). Same registration/call pattern as `focusDir`. */
  splitDir: (dir: 'v' | 'h') => void = () => {};
  /** Close the focused pane (Ctrl+W). Same registration/call pattern. */
  closeFocused: () => void = () => {};
  /**
   * Park a workspace bucket: kill its live sessions (freeing memory) while
   * keeping its persisted layout, so revisiting it re-spawns from scratch.
   * Registered by the tiling container; the left panel's park button calls it.
   * Parking the *active* bucket is a no-op (it would just respawn immediately).
   */
  parkProject: (key: string) => void = () => {};
  /**
   * Live (warm) session counts per workspace bucket key, kept in sync by the
   * tiling container. The left panel reads it to show a badge and a park button
   * on projects that currently hold running sessions.
   */
  liveCounts = $state<Record<string, number>>({});
  /** Whether at least one terminal pane is open in the active workspace. */
  hasFocus = $state(false);
  /**
   * The focused pane's terminal backend (`'wsl'` | `'powershell'` | `'cmd'`), or
   * `null` when no pane is focused. The skills panel reads it to gate inserts: a
   * WSL-discovered skill can't be used by a native PowerShell/cmd `claude`.
   */
  focusedShell = $state<'wsl' | 'powershell' | 'cmd' | null>(null);
  /**
   * Text currently being dragged from a side panel (a todo/query), or `null`
   * when no such drag is in progress. Terminal panes read this to accept the
   * drop and insert the text. We keep it here rather than relying solely on
   * `DataTransfer` because some WebViews (notably WebView2) strip custom MIME
   * types from `dataTransfer.types` during `dragover`, which would otherwise
   * make panes reject the drop (the "no-drop" cursor).
   */
  dragText = $state<string | null>(null);

  register(fn: Sender) {
    this.#senders.add(fn);
  }
  unregister(fn: Sender) {
    this.#senders.delete(fn);
  }
  /** Broadcast text to every open terminal session (optionally followed by Enter). */
  sendAll(text: string, enter = false) {
    for (const fn of this.#senders) fn(text, enter);
  }
}

export const bus = new Bus();

/**
 * dataTransfer MIME type used when dragging a todo/query from a side panel onto
 * a terminal pane. Scoping to a custom type means panes react only to our own
 * drags — not to arbitrary text or file drops.
 */
export const INSERT_DRAG_TYPE = 'application/x-mtc-insert';
