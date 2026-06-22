import { describe, expect, it } from 'vitest';
import {
  flipTileVisibility,
  flipRepoVisibility,
  isAllHidden,
  groupTilesByRepo,
} from './tile-visibility';
import type { DashboardTile } from '../types/dashboard';

const tile = (repo: string, signal: DashboardTile['signal'], visible: boolean): DashboardTile => ({
  i: `${repo}:${signal}`,
  signal,
  repo,
  x: 0,
  y: 0,
  w: 3,
  h: 2,
  visible,
});
const layout: DashboardTile[] = [
  tile('octo/a', 'ci', true),
  tile('octo/a', 'security', true),
  tile('octo/b', 'ci', true),
];

describe('flipTileVisibility', () => {
  it('hides exactly the targeted tile, preserving array length and other fields', () => {
    const next = flipTileVisibility(layout, 'octo/a:ci', false);
    expect(next).toHaveLength(3);
    expect(next.find((t) => t.i === 'octo/a:ci')?.visible).toBe(false);
    expect(next.find((t) => t.i === 'octo/a:security')?.visible).toBe(true);
  });
  it('returns the same reference for unchanged tiles (cheap no-op detection)', () => {
    const next = flipTileVisibility(layout, 'octo/a:ci', false);
    expect(next.find((t) => t.i === 'octo/b:ci')).toBe(layout[2]);
  });
  it('is idempotent when the flag already matches', () => {
    const next = flipTileVisibility(layout, 'octo/a:ci', true);
    expect(next).toEqual(layout);
  });
});

describe('flipRepoVisibility', () => {
  it('flips every tile of one repo, leaving other repos untouched', () => {
    const next = flipRepoVisibility(layout, 'octo/a', false);
    expect(next.filter((t) => t.repo === 'octo/a').every((t) => !t.visible)).toBe(true);
    expect(next.find((t) => t.repo === 'octo/b')?.visible).toBe(true);
  });
  it('preserves array length and tile referential identity (structural contract)', () => {
    const next = flipRepoVisibility(layout, 'octo/a', false);
    // Never appends/drops (MAX_TILES stays structurally respected, like the sibling flip).
    expect(next).toHaveLength(layout.length);
    // A flipped tile is a NEW object (immutable update, not in-place mutation)...
    expect(next.find((t) => t.i === 'octo/a:ci')).not.toBe(layout[0]);
    // ...while an UNCHANGED tile keeps referential identity (cheap no-op detection).
    expect(next.find((t) => t.i === 'octo/b:ci')).toBe(layout[2]);
  });
  it('is idempotent when the flag already matches', () => {
    const next = flipRepoVisibility(layout, 'octo/a', true);
    expect(next).toEqual(layout);
  });
});

describe('isAllHidden', () => {
  it('is true only when no tile is visible', () => {
    expect(isAllHidden(layout)).toBe(false);
    expect(isAllHidden(layout.map((t) => ({ ...t, visible: false })))).toBe(true);
  });
  it('is true for an empty layout', () => {
    expect(isAllHidden([])).toBe(true);
  });
});

describe('groupTilesByRepo', () => {
  it('groups in first-seen repo order, preserving tile order', () => {
    const grouped = groupTilesByRepo(layout);
    expect([...grouped.keys()]).toEqual(['octo/a', 'octo/b']);
    expect(grouped.get('octo/a')?.map((t) => t.signal)).toEqual(['ci', 'security']);
  });
});
