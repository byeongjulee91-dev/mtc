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

/** Number of leaf panes in a subtree. */
export function leafCount(root: TileNode): number {
  if (root.type === 'leaf') return 1;
  return leafCount(root.first) + leafCount(root.second);
}

/**
 * Rebalance every split so all panes end up with equal area. At each node the
 * ratio is set to the fraction of leaves that live in the `first` subtree, which
 * makes each leaf occupy 1/N of the total area regardless of the tree shape.
 */
export function equalize(root: TileNode): TileNode {
  if (root.type === 'leaf') return root;
  const first = equalize(root.first);
  const second = equalize(root.second);
  const ratio = leafCount(first) / (leafCount(first) + leafCount(second));
  return { ...root, ratio, first, second };
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

/**
 * A draggable boundary between the two children of a split. `path` addresses the
 * split node (see `setRatioAt`); `pos` is the divider line's offset along its
 * axis (x for 'v', y for 'h') and `area` is the split's full region — a drag maps
 * the pointer within it to a ratio. Same fractional units as `computeTiles`.
 */
export interface PaneDivider {
  path: string;
  dir: 'v' | 'h';
  pos: number;
  area: Box;
}

/**
 * Enumerate every split's divider with the geometry a drag handle needs. The
 * root split is addressed by 'r'; each level appends '0' (first) or '1' (second).
 * Using a non-empty root token keeps every path truthy (no falsy-'' landmine).
 */
export function computeDividers(root: TileNode, area: Box, path = 'r'): PaneDivider[] {
  if (root.type === 'leaf') return [];
  const out: PaneDivider[] = [];
  if (root.dir === 'v') {
    const firstW = area.width * root.ratio;
    out.push({ path, dir: 'v', pos: area.left + firstW, area });
    out.push(...computeDividers(root.first, { ...area, width: firstW }, path + '0'));
    out.push(
      ...computeDividers(
        root.second,
        { ...area, left: area.left + firstW, width: area.width - firstW },
        path + '1',
      ),
    );
  } else {
    const firstH = area.height * root.ratio;
    out.push({ path, dir: 'h', pos: area.top + firstH, area });
    out.push(...computeDividers(root.first, { ...area, height: firstH }, path + '0'));
    out.push(
      ...computeDividers(
        root.second,
        { ...area, top: area.top + firstH, height: area.height - firstH },
        path + '1',
      ),
    );
  }
  return out;
}

/**
 * Set the ratio of the split addressed by `path` (from `computeDividers`). The
 * leading 'r' marks the root; each following '0'/'1' descends into first/second.
 * The ratio is clamped, so out-of-range drag values are safe.
 */
export function setRatioAt(root: TileNode, path: string, ratio: number): TileNode {
  const set = (node: TileNode, nav: string): TileNode => {
    if (node.type !== 'split') return node;
    if (nav === '') return { ...node, ratio: clampRatio(ratio) };
    const rest = nav.slice(1);
    return nav[0] === '0'
      ? { ...node, first: set(node.first, rest) }
      : { ...node, second: set(node.second, rest) };
  };
  return set(root, path.slice(1));
}

interface PathSplit {
  path: string;
  dir: 'v' | 'h';
  side: 'first' | 'second';
  ratio: number;
}

/** The splits from the root down to the leaf holding `paneId`, each tagged with
 *  the side the pane descends into. Empty when the pane isn't in the tree. */
function ancestorSplits(root: TileNode, paneId: number): PathSplit[] {
  const out: PathSplit[] = [];
  let node: TileNode = root;
  let path = 'r';
  while (node.type === 'split') {
    const inFirst = paneOrder(node.first).includes(paneId);
    const inSecond = !inFirst && paneOrder(node.second).includes(paneId);
    if (!inFirst && !inSecond) break;
    out.push({ path, dir: node.dir, side: inFirst ? 'first' : 'second', ratio: node.ratio });
    node = inFirst ? node.first : node.second;
    path += inFirst ? '0' : '1';
  }
  return out;
}

/**
 * Resize the focused pane one `step` along `dir`, Windows-Terminal style:
 * Left/Right move the nearest *vertical* divider, Up/Down the nearest
 * *horizontal* one. The pane grows when the arrow points toward a neighbour on
 * that side (right/down → the split where it's `first`; left/up → where it's
 * `second`) and shrinks at a layout edge, where the only divider of that axis is
 * on the far side. No-op when the pane has no split of the matching axis.
 */
export function resizePane(root: TileNode, paneId: number, dir: Dir, step: number): TileNode {
  const axis: 'v' | 'h' = dir === 'left' || dir === 'right' ? 'v' : 'h';
  const grow = dir === 'right' || dir === 'down';
  const wantSide: 'first' | 'second' = grow ? 'first' : 'second';
  const delta = grow ? step : -step;
  const splits = ancestorSplits(root, paneId).filter((s) => s.dir === axis);
  if (splits.length === 0) return root;
  // Nearest split (deepest = last) where the pane sits on the arrow's side; fall
  // back to the nearest split of this axis (edge case → the move shrinks it).
  const chosen =
    [...splits].reverse().find((s) => s.side === wantSide) ?? splits[splits.length - 1];
  return setRatioAt(root, chosen.path, chosen.ratio + delta);
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
