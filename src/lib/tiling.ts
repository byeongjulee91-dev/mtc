/**
 * Binary space partition tree for tiling terminal panes.
 *
 * A leaf holds a paneId. An internal node splits its area between two children
 * either side-by-side ('v' — a vertical divider) or stacked ('h' — a horizontal
 * divider). Panes never overlap and always tile the full region.
 */

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export type TileNode = TileLeaf | TileSplit;

export interface TileLeaf {
  type: 'leaf';
  paneId: number;
}

export interface TileSplit {
  type: 'split';
  dir: 'v' | 'h';
  ratio: number;
  first: TileNode;
  second: TileNode;
}

export function leaf(paneId: number): TileLeaf {
  return { type: 'leaf', paneId };
}

/** Insert a new pane by splitting the leaf currently holding `targetId`. */
export function splitPane(
  root: TileNode,
  targetId: number,
  newId: number,
  dir: 'v' | 'h',
): TileNode {
  if (root.type === 'leaf') {
    if (root.paneId !== targetId) return root;
    return { type: 'split', dir, ratio: 0.5, first: leaf(targetId), second: leaf(newId) };
  }
  return {
    ...root,
    first: splitPane(root.first, targetId, newId, dir),
    second: splitPane(root.second, targetId, newId, dir),
  };
}

/** Remove a pane; the sibling subtree takes over the freed space. */
export function removePane(root: TileNode, paneId: number): TileNode | null {
  if (root.type === 'leaf') return root.paneId === paneId ? null : root;
  const first = removePane(root.first, paneId);
  const second = removePane(root.second, paneId);
  if (first === null) return second;
  if (second === null) return first;
  return { ...root, first, second };
}

/** All pane ids in left-to-right / top-to-bottom order. */
export function paneOrder(root: TileNode): number[] {
  if (root.type === 'leaf') return [root.paneId];
  return [...paneOrder(root.first), ...paneOrder(root.second)];
}

/** A spatial direction for Alt+Arrow focus navigation between panes. */
export type Dir = 'left' | 'right' | 'up' | 'down';

/**
 * Find the pane spatially adjacent to `fromId` in the given direction, using the
 * computed tile boxes. Returns the neighbor's id, or null when there is none (the
 * source is missing, or it is already at that edge). Powers Alt+Arrow focus moves.
 *
 * A candidate qualifies when it lies on the correct side of the source *and*
 * shares some span on the perpendicular axis. The nearest candidate along the
 * movement axis wins; a larger shared span breaks ties so the most "in-line" pane
 * is chosen when several abut the same edge.
 */
export function findNeighbor(tiles: Map<number, Box>, fromId: number, dir: Dir): number | null {
  const from = tiles.get(fromId);
  if (!from) return null;

  const fromRight = from.left + from.width;
  const fromBottom = from.top + from.height;
  const EPS = 1e-6;

  let best: number | null = null;
  let bestDist = Infinity;
  let bestSpan = -Infinity;

  for (const [id, b] of tiles) {
    if (id === fromId) continue;
    const bRight = b.left + b.width;
    const bBottom = b.top + b.height;

    let dist: number;
    let span: number;
    if (dir === 'right') {
      if (b.left < fromRight - EPS) continue;
      dist = b.left - fromRight;
      span = Math.min(fromBottom, bBottom) - Math.max(from.top, b.top);
    } else if (dir === 'left') {
      if (bRight > from.left + EPS) continue;
      dist = from.left - bRight;
      span = Math.min(fromBottom, bBottom) - Math.max(from.top, b.top);
    } else if (dir === 'down') {
      if (b.top < fromBottom - EPS) continue;
      dist = b.top - fromBottom;
      span = Math.min(fromRight, bRight) - Math.max(from.left, b.left);
    } else {
      if (bBottom > from.top + EPS) continue;
      dist = from.top - bBottom;
      span = Math.min(fromRight, bRight) - Math.max(from.left, b.left);
    }

    if (span <= EPS) continue; // must overlap on the perpendicular axis
    if (dist < bestDist - EPS || (dist <= bestDist + EPS && span > bestSpan)) {
      best = id;
      bestDist = dist;
      bestSpan = span;
    }
  }
  return best;
}

/** Adjust the split ratio of the parent of `paneId` by `delta` (clamped). */
export function nudgeRatio(root: TileNode, paneId: number, delta: number): TileNode {
  if (root.type === 'leaf') return root;
  const inFirst = paneOrder(root.first).includes(paneId);
  const inSecond = paneOrder(root.second).includes(paneId);
  if (inFirst && root.first.type === 'leaf') {
    return { ...root, ratio: clampRatio(root.ratio + delta) };
  }
  if (inSecond && root.second.type === 'leaf') {
    return { ...root, ratio: clampRatio(root.ratio - delta) };
  }
  return {
    ...root,
    first: nudgeRatio(root.first, paneId, delta),
    second: nudgeRatio(root.second, paneId, delta),
  };
}

function clampRatio(r: number): number {
  return Math.max(0.1, Math.min(0.9, r));
}

/** Compute a Box for each pane within `area` (fractional units, e.g. percentages). */
export function computeTiles(root: TileNode, area: Box): Map<number, Box> {
  const out = new Map<number, Box>();
  walk(root, area, out);
  return out;
}

/**
 * Effective geometry given the maximize state. A maximized pane takes the whole
 * area and the others are omitted (hidden); otherwise this is the normal tiling.
 */
export function effectiveTiles(
  root: TileNode | null,
  maximizedId: number | null,
  area: Box,
): Map<number, Box> {
  if (root === null) return new Map();
  if (maximizedId !== null && paneOrder(root).includes(maximizedId)) {
    return new Map([[maximizedId, area]]);
  }
  return computeTiles(root, area);
}

function walk(node: TileNode, area: Box, out: Map<number, Box>): void {
  if (node.type === 'leaf') {
    out.set(node.paneId, area);
    return;
  }
  if (node.dir === 'v') {
    const firstW = area.width * node.ratio;
    walk(node.first, { ...area, width: firstW }, out);
    walk(node.second, { ...area, left: area.left + firstW, width: area.width - firstW }, out);
  } else {
    const firstH = area.height * node.ratio;
    walk(node.first, { ...area, height: firstH }, out);
    walk(node.second, { ...area, top: area.top + firstH, height: area.height - firstH }, out);
  }
}
