import { describe, expect, it } from 'vitest';
import {
  flipTileVisibility,
  flipRepoVisibility,
  isAllHidden,
  groupTilesByRepo,
  applyVisibilityRule,
  setSignalVisibility,
  setAllVisibility,
  showOnlySignals,
  signalVisibilitySummary,
} from './tile-visibility';
import type { DashboardTile, TileSignalType } from '../types/dashboard';

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

// Rule-based transforms (the "d1" pure visibility layer) — operate across ALL
// repos at once so the customize UI can shape the board without per-tile clicks.
const ruleLayout: DashboardTile[] = [
  tile('octo/a', 'ci', true),
  tile('octo/a', 'security', false),
  tile('octo/b', 'ci', true),
  tile('octo/b', 'security', true),
];

describe('applyVisibilityRule', () => {
  it('sets visible on exactly the tiles matching the predicate', () => {
    const next = applyVisibilityRule(ruleLayout, (t) => t.repo === 'octo/a', false);
    expect(next.filter((t) => t.repo === 'octo/a').every((t) => !t.visible)).toBe(true);
    expect(next.filter((t) => t.repo === 'octo/b').every((t) => t.visible)).toBe(true);
  });
  it('is immutable: never mutates input, new objects for changed tiles, identity for unchanged', () => {
    const next = applyVisibilityRule(ruleLayout, (t) => t.signal === 'security', true);
    expect(ruleLayout[1].visible).toBe(false); // input untouched
    expect(next[1]).not.toBe(ruleLayout[1]); // changed tile is a fresh object
    expect(next[0]).toBe(ruleLayout[0]); // unchanged tile keeps identity
    expect(next).toHaveLength(ruleLayout.length);
  });
});

describe('setSignalVisibility', () => {
  it('shows/hides a signal across ALL repos, leaving other signals untouched', () => {
    const next = setSignalVisibility(ruleLayout, 'ci', false);
    expect(next.filter((t) => t.signal === 'ci').every((t) => !t.visible)).toBe(true);
    // security tiles keep their original mixed visibility
    expect(next.find((t) => t.i === 'octo/a:security')?.visible).toBe(false);
    expect(next.find((t) => t.i === 'octo/b:security')?.visible).toBe(true);
  });
  it('does not mutate the input layout', () => {
    setSignalVisibility(ruleLayout, 'ci', false);
    expect(ruleLayout.every((t) => t.i === 'octo/a:security' || t.visible)).toBe(true);
  });
});

describe('setAllVisibility', () => {
  it('hides every tile when false', () => {
    expect(setAllVisibility(ruleLayout, false).every((t) => !t.visible)).toBe(true);
  });
  it('shows every tile when true', () => {
    expect(setAllVisibility(ruleLayout, true).every((t) => t.visible)).toBe(true);
  });
  it('does not mutate the input layout', () => {
    setAllVisibility(ruleLayout, false);
    expect(ruleLayout.some((t) => t.visible)).toBe(true);
  });
});

describe('showOnlySignals', () => {
  it('makes a tile visible iff its signal is in the set', () => {
    const next = showOnlySignals(ruleLayout, new Set<TileSignalType>(['security']));
    expect(next.filter((t) => t.signal === 'security').every((t) => t.visible)).toBe(true);
    expect(next.filter((t) => t.signal === 'ci').every((t) => !t.visible)).toBe(true);
  });
  it('hides everything for an empty set', () => {
    expect(showOnlySignals(ruleLayout, new Set()).every((t) => !t.visible)).toBe(true);
  });
  it('is immutable: input untouched and unchanged tiles keep identity', () => {
    const next = showOnlySignals(ruleLayout, new Set<TileSignalType>(['ci']));
    expect(ruleLayout[3].visible).toBe(true); // input untouched
    expect(next[0]).toBe(ruleLayout[0]); // octo/a:ci already visible → same reference
  });
});

describe('signalVisibilitySummary', () => {
  it('reports shown/total per signal in first-seen signal order', () => {
    const summary = signalVisibilitySummary(ruleLayout);
    expect(summary).toEqual([
      { signal: 'ci', shown: 2, total: 2 },
      { signal: 'security', shown: 1, total: 2 },
    ]);
  });
  it('supports a tri-state read (all / none / some) per signal', () => {
    const summary = signalVisibilitySummary([
      tile('octo/a', 'ci', true),
      tile('octo/b', 'ci', true),
      tile('octo/a', 'issues', false),
      tile('octo/b', 'issues', false),
      tile('octo/a', 'stale', true),
      tile('octo/b', 'stale', false),
    ]);
    const bySignal = new Map(summary.map((s) => [s.signal, s]));
    expect(bySignal.get('ci')).toMatchObject({ shown: 2, total: 2 }); // all
    expect(bySignal.get('issues')).toMatchObject({ shown: 0, total: 2 }); // none
    expect(bySignal.get('stale')).toMatchObject({ shown: 1, total: 2 }); // some
  });
  it('returns an empty array for an empty layout', () => {
    expect(signalVisibilitySummary([])).toEqual([]);
  });
});
