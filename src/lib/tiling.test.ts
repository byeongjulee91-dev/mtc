import { describe, it, expect } from 'vitest';
import {
  leaf,
  splitPane,
  removePane,
  paneOrder,
  computeTiles,
  computeDividers,
  setRatioAt,
  resizePane,
  effectiveTiles,
  nudgeRatio,
  equalize,
  leafCount,
  findNeighbor,
  type Box,
} from './tiling';

const AREA: Box = { left: 0, top: 0, width: 100, height: 100 };

function overlaps(a: Box, b: Box): boolean {
  return (
    a.left < b.left + b.width &&
    b.left < a.left + a.width &&
    a.top < b.top + b.height &&
    b.top < a.top + a.height
  );
}

describe('tiling', () => {
  it('single pane fills the whole area', () => {
    const tiles = computeTiles(leaf(1), AREA);
    expect(tiles.size).toBe(1);
    expect(tiles.get(1)).toEqual(AREA);
  });

  it('vertical split yields two non-overlapping panes covering the area', () => {
    const tree = splitPane(leaf(1), 1, 2, 'v');
    expect(paneOrder(tree)).toEqual([1, 2]);
    const tiles = computeTiles(tree, AREA);
    const a = tiles.get(1)!;
    const b = tiles.get(2)!;
    expect(a.width + b.width).toBeCloseTo(AREA.width);
    expect(b.left).toBeCloseTo(a.left + a.width);
    expect(a.height).toBe(100);
    expect(overlaps(a, b)).toBe(false);
  });

  it('horizontal split stacks panes', () => {
    const tree = splitPane(leaf(1), 1, 2, 'h');
    const tiles = computeTiles(tree, AREA);
    const a = tiles.get(1)!;
    const b = tiles.get(2)!;
    expect(a.height + b.height).toBeCloseTo(AREA.height);
    expect(b.top).toBeCloseTo(a.top + a.height);
  });

  it('removing a pane gives the sibling the full area', () => {
    const tree = splitPane(leaf(1), 1, 2, 'v');
    const after = removePane(tree, 2)!;
    const tiles = computeTiles(after, AREA);
    expect(tiles.size).toBe(1);
    expect(tiles.get(1)).toEqual(AREA);
  });

  it('removing the last pane empties the tree', () => {
    expect(removePane(leaf(1), 1)).toBeNull();
  });

  it('three panes stay non-overlapping and within bounds', () => {
    let tree = splitPane(leaf(1), 1, 2, 'v');
    tree = splitPane(tree, 2, 3, 'h');
    const tiles = computeTiles(tree, AREA);
    expect(tiles.size).toBe(3);
    const boxes = [...tiles.values()];
    for (const box of boxes) {
      expect(box.left).toBeGreaterThanOrEqual(AREA.left - 1e-9);
      expect(box.top).toBeGreaterThanOrEqual(AREA.top - 1e-9);
      expect(box.left + box.width).toBeLessThanOrEqual(AREA.left + AREA.width + 1e-9);
      expect(box.top + box.height).toBeLessThanOrEqual(AREA.top + AREA.height + 1e-9);
    }
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++)
        expect(overlaps(boxes[i], boxes[j])).toBe(false);
  });

  it('maximize returns the full area for the focused pane only', () => {
    let tree = splitPane(leaf(1), 1, 2, 'v');
    tree = splitPane(tree, 2, 3, 'h');
    expect(effectiveTiles(tree, null, AREA).size).toBe(3);
    const max = effectiveTiles(tree, 2, AREA);
    expect(max.size).toBe(1);
    expect(max.get(2)).toEqual(AREA);
    expect(effectiveTiles(null, null, AREA).size).toBe(0);
  });

  it('nudgeRatio adjusts the split and stays clamped', () => {
    const tree = splitPane(leaf(1), 1, 2, 'v') as Extract<ReturnType<typeof splitPane>, { type: 'split' }>;
    const wider = nudgeRatio(tree, 1, 0.2);
    expect((wider as typeof tree).ratio).toBeCloseTo(0.7);
    const clamped = nudgeRatio(tree, 1, 5);
    expect((clamped as typeof tree).ratio).toBeLessThanOrEqual(0.9);
  });

  it('equalize gives every pane the same area regardless of tree shape', () => {
    // Build a lopsided tree: [1 | (2 / (3 | 4))] then equalize to quarters.
    let tree = splitPane(leaf(1), 1, 2, 'v');
    tree = splitPane(tree, 2, 3, 'h');
    tree = splitPane(tree, 3, 4, 'v');
    expect(leafCount(tree)).toBe(4);

    const balanced = equalize(tree);
    const areas = [...computeTiles(balanced, AREA).values()].map((b) => b.width * b.height);
    expect(areas).toHaveLength(4);
    for (const a of areas) expect(a).toBeCloseTo(AREA.width * AREA.height * 0.25);
  });

  it('equalize sets a lone split back to half', () => {
    const tree = nudgeRatio(splitPane(leaf(1), 1, 2, 'v'), 1, 0.3);
    const balanced = equalize(tree) as Extract<typeof tree, { type: 'split' }>;
    expect(balanced.ratio).toBeCloseTo(0.5);
  });
});

describe('resizePane', () => {
  const widths = (tree: ReturnType<typeof splitPane>) =>
    Object.fromEntries([...computeTiles(tree, AREA)].map(([id, b]) => [id, b.width]));

  it('grows the focused pane toward a neighbour (Windows-Terminal semantics)', () => {
    // [A | B | C] === (v: A, (v: B, C)); focus the middle pane B.
    const tree = splitPane(splitPane(leaf(1), 1, 2, 'v'), 2, 3, 'v');
    expect(paneOrder(tree)).toEqual([1, 2, 3]); // A, B, C
    // Alt+Shift+Left grows B leftward (shrinks A) — moving the A|(B,C) divider,
    // NOT the nearer B|C one (which would wrongly shrink B).
    const left = resizePane(tree, 2, 'left', 0.1);
    const w = widths(left);
    expect(w[1]).toBeCloseTo(40); // A shrank 50 → 40
    expect(w[2]).toBeCloseTo(30); // B grew 25 → 30
    expect(w[3]).toBeCloseTo(30); // C grew with the column
    // Alt+Shift+Right grows B toward C — moving the inner B|C divider.
    const right = widths(resizePane(tree, 2, 'right', 0.1));
    expect(right[1]).toBeCloseTo(50); // A untouched
    expect(right[2]).toBeCloseTo(30); // B grew 25 → 30
    expect(right[3]).toBeCloseTo(20); // C shrank 25 → 20
  });

  it('shrinks the pane at a layout edge (only divider is on the far side)', () => {
    const tree = splitPane(leaf(1), 1, 2, 'v'); // [A | B]
    // A is at the left edge: Alt+Shift+Left has no left neighbour, so it shrinks A.
    expect(widths(resizePane(tree, 1, 'left', 0.1))[1]).toBeCloseTo(40);
    // Alt+Shift+Right grows A toward B.
    expect(widths(resizePane(tree, 1, 'right', 0.1))[1]).toBeCloseTo(60);
  });

  it('resizes vertically along a horizontal split', () => {
    // (h: A, (v: B, C)); focus B. Alt+Shift+Up grows the bottom column upward.
    const tree = splitPane(splitPane(leaf(1), 1, 2, 'h'), 2, 3, 'v');
    const b = computeTiles(resizePane(tree, 2, 'up', 0.1), AREA).get(2)!;
    expect(b.top).toBeCloseTo(40); // bottom column rose 50 → 40
    expect(b.height).toBeCloseTo(60); // and grew 50 → 60
  });

  it('is a no-op when no split of the matching axis exists', () => {
    const tree = splitPane(leaf(1), 1, 2, 'v'); // only a vertical divider
    expect(resizePane(tree, 1, 'up', 0.1)).toBe(tree); // up/down find nothing
  });

  it('clamps the resulting ratio', () => {
    const tree = splitPane(leaf(1), 1, 2, 'v');
    expect(widths(resizePane(tree, 1, 'right', 5))[1]).toBeCloseTo(90); // 0.5+5 → 0.9
  });
});

describe('computeDividers / setRatioAt', () => {
  it('yields one divider per split, all with a truthy path', () => {
    expect(computeDividers(leaf(1), AREA)).toEqual([]);
    const tree = splitPane(splitPane(leaf(1), 1, 2, 'v'), 2, 3, 'v'); // [A | B | C]
    const dividers = computeDividers(tree, AREA);
    expect(dividers).toHaveLength(2);
    for (const d of dividers) expect(d.path).toBeTruthy(); // never the falsy ''
    const root = dividers.find((d) => d.path === 'r')!;
    expect(root.dir).toBe('v');
    expect(root.pos).toBeCloseTo(50); // line at 50% of the full area
    const inner = dividers.find((d) => d.path === 'r1')!;
    expect(inner.pos).toBeCloseTo(75); // 50% + half of the right 50% region
  });

  it('sets the ratio of the split addressed by a path', () => {
    const tree = splitPane(splitPane(leaf(1), 1, 2, 'v'), 2, 3, 'v');
    // Move the inner B|C divider via its path.
    const after = setRatioAt(tree, 'r1', 0.3);
    const w = Object.fromEntries([...computeTiles(after, AREA)].map(([id, b]) => [id, b.width]));
    expect(w[1]).toBeCloseTo(50); // root untouched
    expect(w[2]).toBeCloseTo(15); // B = 50% * 0.3
    expect(w[3]).toBeCloseTo(35); // C = 50% * 0.7
    // Out-of-range values are clamped.
    const root = setRatioAt(tree, 'r', 5);
    expect(computeTiles(root, AREA).get(1)!.width).toBeCloseTo(90);
  });
});

describe('findNeighbor', () => {
  it('moves between side-by-side panes and stops at the edges', () => {
    const tiles = computeTiles(splitPane(leaf(1), 1, 2, 'v'), AREA); // [1 | 2]
    expect(findNeighbor(tiles, 1, 'right')).toBe(2);
    expect(findNeighbor(tiles, 2, 'left')).toBe(1);
    expect(findNeighbor(tiles, 1, 'left')).toBeNull();
    expect(findNeighbor(tiles, 2, 'right')).toBeNull();
    expect(findNeighbor(tiles, 1, 'up')).toBeNull();
    expect(findNeighbor(tiles, 1, 'down')).toBeNull();
  });

  it('moves between stacked panes', () => {
    const tiles = computeTiles(splitPane(leaf(1), 1, 2, 'h'), AREA); // [1 / 2]
    expect(findNeighbor(tiles, 1, 'down')).toBe(2);
    expect(findNeighbor(tiles, 2, 'up')).toBe(1);
    expect(findNeighbor(tiles, 1, 'right')).toBeNull();
  });

  it('navigates an L-shaped three-pane layout', () => {
    // [1 | (2 / 3)] — a tall left pane beside a stacked right column.
    let tree = splitPane(leaf(1), 1, 2, 'v');
    tree = splitPane(tree, 2, 3, 'h');
    const tiles = computeTiles(tree, AREA);
    expect(findNeighbor(tiles, 2, 'down')).toBe(3);
    expect(findNeighbor(tiles, 3, 'up')).toBe(2);
    expect(findNeighbor(tiles, 2, 'left')).toBe(1);
    expect(findNeighbor(tiles, 3, 'left')).toBe(1);
    expect(findNeighbor(tiles, 2, 'up')).toBeNull();
    expect(findNeighbor(tiles, 3, 'down')).toBeNull();
    // The tall left pane abuts both right panes — either is a valid neighbour.
    expect([2, 3]).toContain(findNeighbor(tiles, 1, 'right'));
  });

  it('breaks ties toward the larger shared edge span', () => {
    const tiles = new Map<number, Box>([
      [1, { left: 0, top: 0, width: 100, height: 50 }], // top, full width
      [2, { left: 0, top: 50, width: 70, height: 50 }], // bottom-left (wide)
      [3, { left: 70, top: 50, width: 30, height: 50 }], // bottom-right (narrow)
    ]);
    expect(findNeighbor(tiles, 1, 'down')).toBe(2);
  });

  it('returns null for a single pane or a missing source', () => {
    const tiles = computeTiles(leaf(1), AREA);
    expect(findNeighbor(tiles, 1, 'right')).toBeNull();
    expect(findNeighbor(tiles, 99, 'right')).toBeNull();
  });
});
