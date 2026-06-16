import { describe, it, expect } from 'vitest';
import { buildLayout, serializeTree } from './layout';
import { leaf, type TileNode } from './tiling';
import type { LayoutNode, Profile } from './types';

const prof = (id: string): Profile => ({
  id,
  name: id,
  color: '#000',
  distro: '',
  cwd: '',
  command: '',
  shell: 'wsl',
});

const sample: LayoutNode = {
  kind: 'split',
  dir: 'v',
  ratio: 0.5,
  first: { kind: 'leaf', profileId: 'a' },
  second: {
    kind: 'split',
    dir: 'h',
    ratio: 0.4,
    first: { kind: 'leaf', profileId: 'b' },
    second: { kind: 'leaf', profileId: 'c' },
  },
};

const resolver = (profiles: Record<string, Profile>) => (id: string) => profiles[id] ?? null;
const identity = (p: Profile) => p;

describe('serializeTree', () => {
  it('returns null for an empty tree', () => {
    expect(serializeTree(null, new Map())).toBeNull();
  });

  it('serializes a leaf to its profile id', () => {
    const panes = new Map([[1, prof('a')]]);
    expect(serializeTree(leaf(1), panes)).toEqual({ kind: 'leaf', profileId: 'a' });
  });

  it('drops a leaf whose pane has no profile and collapses the split', () => {
    const tree: TileNode = {
      type: 'split',
      dir: 'v',
      ratio: 0.5,
      first: leaf(1),
      second: leaf(2),
    };
    // Only pane 2 has a profile; the split collapses to the survivor.
    const panes = new Map([[2, prof('b')]]);
    expect(serializeTree(tree, panes)).toEqual({ kind: 'leaf', profileId: 'b' });
  });
});

describe('buildLayout', () => {
  it('rebuilds a tree, assigning fresh sequential pane ids', () => {
    const profiles = { a: prof('a'), b: prof('b'), c: prof('c') };
    const built = buildLayout(sample, resolver(profiles), identity);
    expect(built.panes.size).toBe(3);
    expect([...built.panes.keys()]).toEqual([1, 2, 3]);
    expect(built.nextId).toBe(4);
    expect(built.focusedId).toBe(1); // first leaf in reading order
  });

  it('round-trips through serialize → build → serialize unchanged', () => {
    const profiles = { a: prof('a'), b: prof('b'), c: prof('c') };
    const built = buildLayout(sample, resolver(profiles), identity);
    expect(serializeTree(built.tree, built.panes)).toEqual(sample);
  });

  it('applies prepare() to each resolved profile (e.g. cwd stamp)', () => {
    const profiles = { a: prof('a'), b: prof('b'), c: prof('c') };
    const built = buildLayout(sample, resolver(profiles), (p) => ({ ...p, cwd: '/work' }));
    for (const profile of built.panes.values()) expect(profile.cwd).toBe('/work');
  });

  it('drops leaves whose profile no longer resolves and collapses splits', () => {
    const profiles = { a: prof('a'), c: prof('c') }; // 'b' was deleted
    const built = buildLayout(sample, resolver(profiles), identity);
    expect(built.panes.size).toBe(2);
    expect(serializeTree(built.tree, built.panes)).toEqual({
      kind: 'split',
      dir: 'v',
      ratio: 0.5,
      first: { kind: 'leaf', profileId: 'a' },
      second: { kind: 'leaf', profileId: 'c' },
    });
  });

  it('produces an empty result when no profiles resolve', () => {
    const built = buildLayout(sample, () => null, identity);
    expect(built.tree).toBeNull();
    expect(built.panes.size).toBe(0);
    expect(built.focusedId).toBeNull();
  });

  it('handles a null layout', () => {
    const built = buildLayout(null, resolver({}), identity);
    expect(built.tree).toBeNull();
    expect(built.nextId).toBe(1);
    expect(built.focusedId).toBeNull();
  });
});
