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
  it('persists the layout as JSON', () => {
    const repos = [makeRepo('octo/a')];
    const layout = DEFAULT_LAYOUT(repos);
    saveDashboardLayout(layout);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')).toEqual(layout);
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
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});

describe('resetDashboardLayout', () => {
  it('removes the stored layout key', () => {
    saveDashboardLayout(DEFAULT_LAYOUT([makeRepo('octo/a')]));
    expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();
    resetDashboardLayout();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('swallows localStorage.removeItem throwing', () => {
    vi.spyOn(localStorage, 'removeItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => resetDashboardLayout()).not.toThrow();
  });
});
