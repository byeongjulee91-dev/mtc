import { describe, it, expect } from 'vitest';
import {
  leaf,
  splitPane,
  removePane,
  paneOrder,
  computeTiles,
  effectiveTiles,
  nudgeRatio,
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
