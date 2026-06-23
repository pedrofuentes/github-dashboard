import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Repo } from '../types/fleet';
import type { DashboardTile, TileSignalType } from '../types/dashboard';
import {
  DEFAULT_LAYOUT,
  loadDashboardLayout,
  MAX_STRING_LENGTH,
  MAX_TILES,
  resetDashboardLayout,
  saveDashboardLayout,
  toRglLayout,
} from './dashboard-layout';

const STORAGE_KEY = 'fleet:dashboard-layout';
const STORAGE_KEY_V2 = 'fleet:dashboard-view:v2';
const LAYOUT_VERSION = 2;

const SIGNALS: TileSignalType[] = [
  'ci',
  'security',
  'reviews',
  'pullRequests',
  'issues',
  'stale',
  'activity',
];

/** The six signals persisted before the Activity tile shipped (back-compat). */
const LEGACY_SIGNALS: TileSignalType[] = [
  'ci',
  'security',
  'reviews',
  'pullRequests',
  'issues',
  'stale',
];

/** Builds a pre-Activity (6-signal) persisted layout, as old clients stored it. */
function legacyLayout(repos: Repo[]): DashboardTile[] {
  const tiles: DashboardTile[] = [];
  let index = 0;
  for (const repo of repos) {
    for (const signal of LEGACY_SIGNALS) {
      tiles.push({
        i: `${repo.nameWithOwner}:${signal}`,
        signal,
        repo: repo.nameWithOwner,
        x: (index % 4) * 3,
        y: Math.floor(index / 4) * 2,
        w: 3,
        h: 2,
        visible: true,
      });
      index += 1;
    }
  }
  return tiles;
}

function makeRepo(nameWithOwner: string): Repo {
  const [owner, name] = nameWithOwner.split('/');
  return { nameWithOwner, owner, name, isPrivate: false };
}

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('DEFAULT_LAYOUT', () => {
  it('creates one tile per repo per signal', () => {
    const repos = [makeRepo('octo/a'), makeRepo('octo/b')];
    const layout = DEFAULT_LAYOUT(repos);
    expect(layout).toHaveLength(repos.length * SIGNALS.length);
  });

  it('returns an empty layout for no repos', () => {
    expect(DEFAULT_LAYOUT([])).toEqual([]);
  });

  it('preserves the caller repo order and the signal order per repo', () => {
    const repos = [makeRepo('octo/a'), makeRepo('octo/b')];
    const layout = DEFAULT_LAYOUT(repos);

    expect(layout.slice(0, SIGNALS.length).map((t) => t.repo)).toEqual(
      Array(SIGNALS.length).fill('octo/a'),
    );
    expect(layout.slice(0, SIGNALS.length).map((t) => t.signal)).toEqual(SIGNALS);
    expect(layout.slice(SIGNALS.length).map((t) => t.repo)).toEqual(
      Array(SIGNALS.length).fill('octo/b'),
    );
  });

  it('flows tiles left-to-right on a 12-column grid with a fixed tile size', () => {
    const repos = [makeRepo('octo/a'), makeRepo('octo/b')];
    const layout = DEFAULT_LAYOUT(repos);

    for (const tile of layout) {
      expect(tile.w).toBe(3);
      expect(tile.h).toBe(2);
      expect(tile.x % tile.w).toBe(0);
      expect(tile.x).toBeGreaterThanOrEqual(0);
      expect(tile.x + tile.w).toBeLessThanOrEqual(12);
      expect(tile.y % tile.h).toBe(0);
      expect(tile.visible).toBe(true);
    }

    // 12 / 3 = 4 tiles per row → index 0..3 on row 0, 4..7 on row 1.
    expect({ x: layout[0].x, y: layout[0].y }).toEqual({ x: 0, y: 0 });
    expect({ x: layout[3].x, y: layout[3].y }).toEqual({ x: 9, y: 0 });
    expect({ x: layout[4].x, y: layout[4].y }).toEqual({ x: 0, y: 2 });
  });

  it('assigns a stable, unique `${repo}:${signal}` id to every tile', () => {
    const repos = [makeRepo('octo/a'), makeRepo('octo/b')];
    const layout = DEFAULT_LAYOUT(repos);

    expect(layout[0].i).toBe('octo/a:ci');
    const ids = new Set(layout.map((t) => t.i));
    expect(ids.size).toBe(layout.length);
    for (const tile of layout) {
      expect(tile.i).toBe(`${tile.repo}:${tile.signal}`);
    }
  });
});

describe('toRglLayout', () => {
  it('maps tiles to react-grid-layout items keeping only the grid fields', () => {
    const tiles: DashboardTile[] = [
      { i: 'octo/a:ci', signal: 'ci', repo: 'octo/a', x: 0, y: 0, w: 3, h: 2, visible: true },
    ];
    expect(toRglLayout(tiles)).toEqual([{ i: 'octo/a:ci', x: 0, y: 0, w: 3, h: 2 }]);
  });

  it('omits tiles that are not visible', () => {
    const tiles: DashboardTile[] = [
      { i: 'octo/a:ci', signal: 'ci', repo: 'octo/a', x: 0, y: 0, w: 3, h: 2, visible: true },
      {
        i: 'octo/a:security',
        signal: 'security',
        repo: 'octo/a',
        x: 3,
        y: 0,
        w: 3,
        h: 2,
        visible: false,
      },
    ];
    const rgl = toRglLayout(tiles);
    expect(rgl).toHaveLength(1);
    expect(rgl[0].i).toBe('octo/a:ci');
  });
});

describe('loadDashboardLayout', () => {
  it('returns the default layout when nothing is stored', () => {
    const repos = [makeRepo('octo/a')];
    expect(loadDashboardLayout(repos)).toEqual(DEFAULT_LAYOUT(repos));
  });

  it('round-trips a saved layout', () => {
    const repos = [makeRepo('octo/a'), makeRepo('octo/b')];
    const saved = DEFAULT_LAYOUT(repos);
    saveDashboardLayout(saved);
    expect(loadDashboardLayout(repos)).toEqual(saved);
  });

  it('round-trips a large fleet above the legacy ~85-repo cap (#200)', () => {
    // 90 repos × 7 signals = 630 tiles — above the old MAX_TILES = 600 cap that
    // silently dropped persistence past ~85 repos. The layout must persist and
    // round-trip intact for the whole fleet.
    const repos = Array.from({ length: 90 }, (_, idx) => makeRepo(`octo/repo-${idx}`));
    const saved = DEFAULT_LAYOUT(repos);
    expect(saved).toHaveLength(repos.length * SIGNALS.length);
    expect(saved.length).toBeGreaterThan(600);
    // ...and still inside the headroom cap, so the schema persists rather than
    // rejecting the whole fleet (#200/#204): 90 × 7 = 630 ≤ MAX_TILES (700).
    expect(saved.length).toBeLessThanOrEqual(MAX_TILES);

    saveDashboardLayout(saved);

    // Persistence actually wrote (not silently skipped by the schema cap).
    expect(localStorage.getItem(STORAGE_KEY_V2)).not.toBeNull();
    expect(loadDashboardLayout(repos)).toEqual(saved);
  });

  it('falls back to the default on corrupt JSON', () => {
    const repos = [makeRepo('octo/a')];
    localStorage.setItem(STORAGE_KEY, '{not json');
    expect(loadDashboardLayout(repos)).toEqual(DEFAULT_LAYOUT(repos));
  });

  it('falls back to the default on an invalid stored shape', () => {
    const repos = [makeRepo('octo/a')];
    localStorage.setItem(STORAGE_KEY, JSON.stringify([{ i: 'x', signal: 'nope', repo: 5 }]));
    expect(loadDashboardLayout(repos)).toEqual(DEFAULT_LAYOUT(repos));
  });

  it('falls back to the default when the stored value is not an array', () => {
    const repos = [makeRepo('octo/a')];
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ not: 'an array' }));
    expect(loadDashboardLayout(repos)).toEqual(DEFAULT_LAYOUT(repos));
  });

  it('drops tiles whose repo is no longer in the fleet', () => {
    const repoA = makeRepo('octo/a');
    const repoB = makeRepo('octo/b');
    saveDashboardLayout(DEFAULT_LAYOUT([repoA, repoB]));

    const reconciled = loadDashboardLayout([repoA]);
    expect(reconciled.every((t) => t.repo === 'octo/a')).toBe(true);
    expect(reconciled).toEqual(DEFAULT_LAYOUT([repoA]));
  });

  it('falls back to the default when every stored tile is reconciled away', () => {
    saveDashboardLayout(DEFAULT_LAYOUT([makeRepo('octo/gone')]));
    const repos = [makeRepo('octo/here')];
    expect(loadDashboardLayout(repos)).toEqual(DEFAULT_LAYOUT(repos));
  });

  it('falls back to the default when localStorage.getItem throws', () => {
    const repos = [makeRepo('octo/a')];
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(loadDashboardLayout(repos)).toEqual(DEFAULT_LAYOUT(repos));
  });

  it('falls back to the default on negative grid geometry', () => {
    const repos = [makeRepo('octo/a')];
    const tile: DashboardTile = {
      i: 'octo/a:ci',
      signal: 'ci',
      repo: 'octo/a',
      x: -1,
      y: 0,
      w: 3,
      h: 2,
      visible: true,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify([tile]));
    expect(loadDashboardLayout(repos)).toEqual(DEFAULT_LAYOUT(repos));
  });

  it('falls back to the default on non-integer grid geometry', () => {
    const repos = [makeRepo('octo/a')];
    const tile = {
      i: 'octo/a:ci',
      signal: 'ci',
      repo: 'octo/a',
      x: 1.5,
      y: 0,
      w: 3,
      h: 2,
      visible: true,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify([tile]));
    expect(loadDashboardLayout(repos)).toEqual(DEFAULT_LAYOUT(repos));
  });

  it('falls back to the default when grid geometry exceeds the grid bounds', () => {
    const repos = [makeRepo('octo/a')];
    const tile: DashboardTile = {
      i: 'octo/a:ci',
      signal: 'ci',
      repo: 'octo/a',
      x: 9999,
      y: 0,
      w: 3,
      h: 2,
      visible: true,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify([tile]));
    expect(loadDashboardLayout(repos)).toEqual(DEFAULT_LAYOUT(repos));
  });

  it('falls back to the default when the stored array exceeds the tile cap', () => {
    const repos = [makeRepo('octo/a')];
    const oversized: DashboardTile[] = Array.from({ length: MAX_TILES + 1 }, (_, idx) => ({
      i: `octo/a:ci`,
      signal: 'ci',
      repo: 'octo/a',
      x: 0,
      y: idx,
      w: 3,
      h: 2,
      visible: true,
    }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(oversized));
    expect(loadDashboardLayout(repos)).toEqual(DEFAULT_LAYOUT(repos));
  });

  it('falls back to the default when a tile id does not equal `${repo}:${signal}`', () => {
    const repos = [makeRepo('octo/a')];
    const tile: DashboardTile = {
      i: 'octo/a:security',
      signal: 'ci',
      repo: 'octo/a',
      x: 0,
      y: 0,
      w: 3,
      h: 2,
      visible: true,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify([tile]));
    expect(loadDashboardLayout(repos)).toEqual(DEFAULT_LAYOUT(repos));
  });

  it('falls back to the default when the repo string exceeds the length cap', () => {
    const repos = [makeRepo('octo/a')];
    const repo = `octo/${'a'.repeat(MAX_STRING_LENGTH)}`;
    const tile: DashboardTile = {
      i: `${repo}:ci`,
      signal: 'ci',
      repo,
      x: 0,
      y: 0,
      w: 3,
      h: 2,
      visible: true,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify([tile]));
    expect(loadDashboardLayout(repos)).toEqual(DEFAULT_LAYOUT(repos));
  });

  it('migrates a legacy 6-signal layout by adding an activity tile per repo', () => {
    const repos = [makeRepo('octo/a'), makeRepo('octo/b')];
    const legacy = legacyLayout(repos);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(legacy));

    const loaded = loadDashboardLayout(repos);

    // Existing (legacy) tiles are preserved, never dropped.
    for (const tile of legacy) {
      expect(loaded.some((t) => t.i === tile.i)).toBe(true);
    }
    // An activity tile is added for every repo in the fleet.
    expect(loaded.some((t) => t.i === 'octo/a:activity' && t.signal === 'activity')).toBe(true);
    expect(loaded.some((t) => t.i === 'octo/b:activity' && t.signal === 'activity')).toBe(true);
    // Exactly one activity tile per repo — the merge adds only what is missing.
    expect(loaded.filter((t) => t.signal === 'activity')).toHaveLength(repos.length);
    expect(loaded).toHaveLength(legacy.length + repos.length);
  });

  it('does not reintroduce a fleet repo that is absent from the stored layout (#201)', () => {
    // Backfill is per-repo: it only completes the signal set for repos ALREADY in
    // the stored layout. A fleet repo with no stored tiles (e.g. one the user
    // removed every tile for) must stay out — repo membership is authoritative and
    // a removed repo only returns on an explicit reset, never via the activity
    // back-compat merge.
    const repoA = makeRepo('octo/a');
    const repoB = makeRepo('octo/b');
    saveDashboardLayout(DEFAULT_LAYOUT([repoA])); // only repo A persisted

    const loaded = loadDashboardLayout([repoA, repoB]); // B is in the fleet, not the layout

    expect(loaded.some((t) => t.repo === 'octo/b')).toBe(false);
    expect(loaded.every((t) => t.repo === 'octo/a')).toBe(true);
    expect(loaded).toEqual(DEFAULT_LAYOUT([repoA]));
  });

  it('partial migration: backfills activity only for the repos missing it (mixed 7+6) (#201)', () => {
    // A layout persisted across the activity rollout can be mixed: some repos
    // already carry all 7 signals while others still hold the legacy 6. The merge
    // must add the activity tile ONLY to the repos that lack it, never duplicating
    // it for repos that already migrated.
    const repoA = makeRepo('octo/a');
    const repoB = makeRepo('octo/b');
    const stored = [...DEFAULT_LAYOUT([repoA]), ...legacyLayout([repoB])]; // A: 7, B: 6
    saveDashboardLayout(stored);

    const loaded = loadDashboardLayout([repoA, repoB]);

    // Every stored tile survives; no repo loses a tile.
    for (const tile of stored) {
      expect(loaded.some((t) => t.i === tile.i)).toBe(true);
    }
    // Exactly one activity tile per repo — A's pre-existing one is untouched and
    // B gains the single missing one.
    expect(loaded.filter((t) => t.signal === 'activity')).toHaveLength(2);
    expect(loaded.filter((t) => t.repo === 'octo/a')).toHaveLength(SIGNALS.length);
    expect(loaded.filter((t) => t.repo === 'octo/b')).toHaveLength(SIGNALS.length);
    // Only B's activity tile is appended (A was already complete).
    expect(loaded).toHaveLength(stored.length + 1);
  });

  it('preserves a stored tile with a non-default custom position through reconciliation', () => {
    const repoA = makeRepo('octo/a');
    const repoB = makeRepo('octo/b');
    const stored = DEFAULT_LAYOUT([repoA, repoB]);
    // Move repoA's first tile to a deliberately non-default slot so a
    // "re-derive instead of preserve" regression would be detectable.
    const customIndex = stored.findIndex((t) => t.repo === 'octo/a' && t.signal === 'ci');
    const customTile: DashboardTile = { ...stored[customIndex], x: 6, y: 8 };
    stored[customIndex] = customTile;
    saveDashboardLayout(stored);

    const reconciled = loadDashboardLayout([repoA, repoB]);
    expect(reconciled).toEqual(stored);
    const survived = reconciled.find((t) => t.i === customTile.i);
    expect(survived).toEqual(customTile);
    expect({ x: survived?.x, y: survived?.y }).toEqual({ x: 6, y: 8 });
  });
});

describe('saveDashboardLayout', () => {
  it('persists the layout under the versioned v2 key as a {version, tiles} envelope', () => {
    const repos = [makeRepo('octo/a')];
    const layout = DEFAULT_LAYOUT(repos);
    saveDashboardLayout(layout);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY_V2) ?? 'null')).toEqual({
      version: LAYOUT_VERSION,
      tiles: layout,
    });
  });

  it('swallows localStorage.setItem throwing', () => {
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });
    expect(() => saveDashboardLayout(DEFAULT_LAYOUT([makeRepo('octo/a')]))).not.toThrow();
  });

  it('does not persist tiles that fail schema validation', () => {
    const invalid: DashboardTile[] = [
      { i: 'octo/a:ci', signal: 'ci', repo: 'octo/a', x: -5, y: 0, w: 3, h: 2, visible: true },
    ];
    saveDashboardLayout(invalid);
    expect(localStorage.getItem(STORAGE_KEY_V2)).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});

describe('resetDashboardLayout', () => {
  it('removes the versioned v2 key', () => {
    saveDashboardLayout(DEFAULT_LAYOUT([makeRepo('octo/a')]));
    expect(localStorage.getItem(STORAGE_KEY_V2)).not.toBeNull();
    resetDashboardLayout();
    expect(localStorage.getItem(STORAGE_KEY_V2)).toBeNull();
  });

  it('also clears the legacy v1 key so the default is truly restored', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_LAYOUT([makeRepo('octo/a')])));
    resetDashboardLayout();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(loadDashboardLayout([makeRepo('octo/a')])).toEqual(DEFAULT_LAYOUT([makeRepo('octo/a')]));
  });

  it('swallows localStorage.removeItem throwing', () => {
    vi.spyOn(localStorage, 'removeItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => resetDashboardLayout()).not.toThrow();
  });
});

describe('versioned layout migration (v1 → v2)', () => {
  it('loads a legacy v1 array unchanged (same tiles/positions) into the new shape', () => {
    const repos = [makeRepo('octo/a')];
    const legacy = DEFAULT_LAYOUT(repos);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(legacy));

    expect(loadDashboardLayout(repos)).toEqual(legacy);
  });

  it('persists a migrated v2 envelope on read while preserving the legacy key', () => {
    const repos = [makeRepo('octo/a')];
    const legacy = DEFAULT_LAYOUT(repos);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(legacy));

    loadDashboardLayout(repos);

    // v2 is written with the same tiles...
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY_V2) ?? 'null')).toEqual({
      version: LAYOUT_VERSION,
      tiles: legacy,
    });
    // ...and the legacy key is kept intact for rollback (NOT deleted).
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')).toEqual(legacy);
  });

  it('prefers the v2 envelope over the legacy key when both are present', () => {
    const repos = [makeRepo('octo/a')];
    const legacy = DEFAULT_LAYOUT(repos);
    const v2Tiles = legacy.map((tile) => (tile.signal === 'ci' ? { ...tile, x: 6, y: 8 } : tile));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(legacy));
    localStorage.setItem(
      STORAGE_KEY_V2,
      JSON.stringify({ version: LAYOUT_VERSION, tiles: v2Tiles }),
    );

    expect(loadDashboardLayout(repos)).toEqual(v2Tiles);
  });

  it('round-trips through the v2 envelope', () => {
    const repos = [makeRepo('octo/a'), makeRepo('octo/b')];
    const saved = DEFAULT_LAYOUT(repos);
    saveDashboardLayout(saved);
    expect(loadDashboardLayout(repos)).toEqual(saved);
  });

  it('falls back to the default on a corrupt v2 envelope', () => {
    const repos = [makeRepo('octo/a')];
    localStorage.setItem(STORAGE_KEY_V2, '{not json');
    expect(loadDashboardLayout(repos)).toEqual(DEFAULT_LAYOUT(repos));
  });

  it('falls back to the default on a v2 envelope with the wrong version', () => {
    const repos = [makeRepo('octo/a')];
    localStorage.setItem(
      STORAGE_KEY_V2,
      JSON.stringify({ version: 99, tiles: DEFAULT_LAYOUT(repos) }),
    );
    expect(loadDashboardLayout(repos)).toEqual(DEFAULT_LAYOUT(repos));
  });

  it('falls back to the default on a v2 envelope whose tiles are invalid', () => {
    const repos = [makeRepo('octo/a')];
    localStorage.setItem(
      STORAGE_KEY_V2,
      JSON.stringify({ version: LAYOUT_VERSION, tiles: [{ i: 'x', signal: 'nope' }] }),
    );
    expect(loadDashboardLayout(repos)).toEqual(DEFAULT_LAYOUT(repos));
  });
});
