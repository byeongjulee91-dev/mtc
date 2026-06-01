import { describe, it, expect } from 'vitest';
import {
  leaf,
  splitPane,
  removePane,
  paneOrder,
  computeTiles,
  effectiveTiles,
  nudgeRatio,
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
