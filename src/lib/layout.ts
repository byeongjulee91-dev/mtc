/**
 * Conversions between the live tiling tree (`TileNode`, keyed by numeric pane
 * ids) and the persisted `LayoutNode` tree (keyed by stable profile ids).
 *
 * The runtime tree is what `CenterPanel` mutates as the user splits/closes
 * panes; the persisted form is what survives a restart. A persisted leaf only
 * remembers *which profile* spawned the pane, so on restore each leaf is
 * re-spawned into a fresh session.
 */

import type { LayoutNode } from './types';
import type { Profile } from './types';
import { leaf, paneOrder, type TileNode } from './tiling';

/**
 * Serialize a live tiling tree into a persistable `LayoutNode`, looking up each
 * leaf's profile in `panes`. Leaves whose pane has no profile (shouldn't
 * happen) are dropped, and a split that loses a child collapses to its
 * survivor. Returns `null` for an empty/all-dropped tree.
 */
export function serializeTree(
  tree: TileNode | null,
  panes: ReadonlyMap<number, Profile>,
): LayoutNode | null {
  if (!tree) return null;
  if (tree.type === 'leaf') {
    const profile = panes.get(tree.paneId);
    return profile ? { kind: 'leaf', profileId: profile.id } : null;
  }
  const first = serializeTree(tree.first, panes);
  const second = serializeTree(tree.second, panes);
  if (!first) return second;
  if (!second) return first;
  return { kind: 'split', dir: tree.dir, ratio: tree.ratio, first, second };
}

/** Result of rebuilding a runtime tree from a persisted layout. */
export interface BuiltLayout {
  tree: TileNode | null;
  /** Fresh pane id → resolved profile (with the project cwd already applied). */
  panes: Map<number, Profile>;
  /** Next free pane id (one past the highest assigned). */
  nextId: number;
  /** Pane to focus initially (first in reading order), or null when empty. */
  focusedId: number | null;
}

/**
 * Rebuild a live tiling tree from a persisted `LayoutNode`. `resolve` maps a
 * stored profile id to a current `Profile` (or null if it was deleted); a leaf
 * that fails to resolve is dropped and its split collapses to the survivor.
 * Each resolved profile is passed through `prepare` (e.g. to stamp the project
 * cwd) before being stored against a freshly allocated pane id.
 */
export function buildLayout(
  layout: LayoutNode | null,
  resolve: (profileId: string) => Profile | null,
  prepare: (profile: Profile) => Profile,
): BuiltLayout {
  const panes = new Map<number, Profile>();
  let nextId = 1;

  function walk(node: LayoutNode): TileNode | null {
    if (node.kind === 'leaf') {
      const profile = resolve(node.profileId);
      if (!profile) return null;
      const id = nextId++;
      panes.set(id, prepare(profile));
      return leaf(id);
    }
    const first = walk(node.first);
    const second = walk(node.second);
    if (!first) return second;
    if (!second) return first;
    return { type: 'split', dir: node.dir, ratio: node.ratio, first, second };
  }

  const tree = layout ? walk(layout) : null;
  const focusedId = tree ? paneOrder(tree)[0] ?? null : null;
  return { tree, panes, nextId, focusedId };
}
