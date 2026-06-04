import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import type { Profile } from './types';
import type { BuiltLayout } from './layout';
import {
  computeDividers,
  computeTiles,
  effectiveTiles,
  equalize,
  findNeighbor,
  leaf,
  leafCount,
  paneOrder,
  removePane,
  resizePane,
  setRatioAt,
  splitPane,
  type Box,
  type Dir,
  type PaneDivider,
  type TileNode,
} from './tiling';

/** Fractional tiling area (percent units) every pane layout is computed within. */
export const AREA: Box = { left: 0, top: 0, width: 100, height: 100 };

/** Fraction of a split that a single Alt+Shift+Arrow nudges its divider. */
const RESIZE_STEP = 0.03;

/**
 * Live tiling state for one workspace bucket (a project, or the "Unfiled"
 * bucket). One `PaneRuntime` exists per *visited* bucket in a run; switching
 * projects swaps which runtime is shown without unmounting the others, so their
 * PTY sessions stay warm. The persisted layout (see `layout.ts`) is what seeds a
 * runtime on first visit and what survives a restart.
 *
 * Mutating methods only touch this runtime; `CenterPanel` re-serializes the tree
 * to persistent storage after any structural change.
 */
export class PaneRuntime {
  tree = $state<TileNode | null>(null);
  /** Pane id → resolved profile (cwd already stamped). Reactive via SvelteMap. */
  panes = new SvelteMap<number, Profile>();
  focusedId = $state<number | null>(null);
  maximizedId = $state<number | null>(null);
  /**
   * Pane ids whose PTY is currently producing output ("busy"). Each pane sets
   * and clears its own id via an idle timer in `TerminalPane`: output keeps it
   * busy, a short silence clears it. Reactive (SvelteSet) so the left panel can
   * show a per-project "working" indicator. Kept in sync with `panes` — cleared
   * on `load`, pruned on `closePane`.
   */
  busyPanes = new SvelteSet<number>();
  /** Monotonic pane-id allocator (plain — never read reactively). */
  nextId = 1;

  /** No sessions open in this bucket. */
  get isEmpty(): boolean {
    return this.tree === null;
  }

  /** Number of open panes (live sessions) in this bucket. */
  get paneCount(): number {
    return this.tree ? leafCount(this.tree) : 0;
  }

  /** Number of panes currently busy (streaming output). */
  get busyCount(): number {
    return this.busyPanes.size;
  }

  /** Mark a pane busy/idle — driven by `TerminalPane`'s output idle timer. */
  setBusy(id: number, busy: boolean): void {
    if (busy) this.busyPanes.add(id);
    else this.busyPanes.delete(id);
  }

  /** Pane ids in reading order. */
  get order(): number[] {
    return this.tree ? paneOrder(this.tree) : [];
  }

  /** Effective per-pane boxes, honoring the maximize state. */
  get tiles(): Map<number, Box> {
    return effectiveTiles(this.tree, this.maximizedId, AREA);
  }

  /** Draggable split boundaries for the current layout — none while maximized
   *  (a single pane fills the area) or empty. */
  get dividers(): PaneDivider[] {
    if (this.tree === null || this.maximizedId !== null) return [];
    return computeDividers(this.tree, AREA);
  }

  /** Replace this runtime's contents from a freshly built layout. */
  load(built: BuiltLayout): void {
    this.panes.clear();
    this.busyPanes.clear();
    for (const [id, profile] of built.panes) this.panes.set(id, profile);
    this.tree = built.tree;
    this.nextId = built.nextId;
    this.focusedId = built.focusedId;
    this.maximizedId = null;
  }

  /** Add a pane running `profile`, splitting the focused pane (or seeding the
   *  root when empty). Returns the new pane id. */
  addPane(profile: Profile, dir: 'v' | 'h'): number {
    const id = this.nextId++;
    this.panes.set(id, profile);
    if (this.tree === null || this.focusedId === null) this.tree = leaf(id);
    else this.tree = splitPane(this.tree, this.focusedId, id, dir);
    this.focusedId = id;
    this.maximizedId = null;
    return id;
  }

  /** Split the focused pane, re-using its profile (so the same kind of session
   *  opens beside it). No-op when nothing is focused. */
  splitFocused(dir: 'v' | 'h'): void {
    if (this.focusedId === null) return;
    const profile = this.panes.get(this.focusedId);
    if (profile) this.addPane(profile, dir);
  }

  /** Close a pane; its sibling subtree takes over the freed space. */
  closePane(id: number): void {
    this.tree = this.tree ? removePane(this.tree, id) : null;
    this.panes.delete(id);
    this.busyPanes.delete(id);
    if (this.maximizedId === id) this.maximizedId = null;
    if (this.focusedId === id) {
      const ord = this.order;
      this.focusedId = ord.length ? ord[0] : null;
    }
  }

  closeFocused(): void {
    if (this.focusedId !== null) this.closePane(this.focusedId);
  }

  /** Maximize the focused pane, or restore if one is already maximized. */
  toggleMax(): void {
    if (this.focusedId === null) return;
    this.maximizedId = this.maximizedId === null ? this.focusedId : null;
  }

  /** Rebalance all splits so every pane gets equal area. */
  equalizePanes(): void {
    if (this.tree === null) return;
    this.tree = equalize(this.tree);
    this.maximizedId = null;
  }

  /** Resize the focused pane one step along `dir` (Alt+Shift+Arrow). Ignored
   *  while a pane is maximized — its divider isn't on screen to move. */
  resizeFocused(dir: Dir): void {
    if (this.focusedId === null || this.tree === null || this.maximizedId !== null) return;
    this.tree = resizePane(this.tree, this.focusedId, dir, RESIZE_STEP);
  }

  /** Set a split's ratio by its divider path (live divider drag). */
  setDividerRatio(path: string, ratio: number): void {
    if (this.tree === null) return;
    this.tree = setRatioAt(this.tree, path, ratio);
  }

  /** Move focus to the spatially adjacent pane (Alt+Arrow). While maximized the
   *  maximize follows so you flip through panes full-screen. */
  focusNeighbor(dir: Dir): void {
    if (this.focusedId === null || this.tree === null) return;
    const next = findNeighbor(computeTiles(this.tree, AREA), this.focusedId, dir);
    if (next === null) return;
    this.focusedId = next;
    if (this.maximizedId !== null) this.maximizedId = next;
  }
}
