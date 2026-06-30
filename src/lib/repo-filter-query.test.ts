import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { GetRowData, Repo, RepoSignalData } from '../types/fleet';
import {
  EMPTY_QUERY,
  LEGACY_REPO_FILTER_KEY,
  RepoFilterQueryV2Schema,
  STORAGE_KEY_V2,
  createRepoFilterQueryStore,
  derivedSelectedSet,
  evaluateRepoFilterQuery,
  isQueryActive,
  migrateLegacyRepoFilter,
  type RepoFilterQueryV2,
} from './repo-filter-query';

const repo = (nameWithOwner: string, isPrivate = false): Repo => {
  const [owner = '', name = ''] = nameWithOwner.split('/');
  return { nameWithOwner, owner, name, isPrivate };
};

const getter =
  (map: Record<string, RepoSignalData>): GetRowData =>
  (r) =>
    map[r.nameWithOwner] ?? {};

/** Builds a query by shallow-merging overrides onto {@link EMPTY_QUERY}. */
function q(partial: {
  text?: string;
  repoSelection?: RepoFilterQueryV2['repoSelection'];
  facets?: Partial<RepoFilterQueryV2['facets']>;
}): RepoFilterQueryV2 {
  return {
    version: 2,
    text: partial.text ?? '',
    repoSelection: partial.repoSelection ?? { mode: 'all', names: [] },
    facets: { ...EMPTY_QUERY.facets, ...(partial.facets ?? {}) },
  };
}

describe('RepoFilterQueryV2Schema', () => {
  it('accepts EMPTY_QUERY', () => {
    expect(RepoFilterQueryV2Schema.safeParse(EMPTY_QUERY).success).toBe(true);
  });

  it('rejects a wrong version', () => {
    expect(RepoFilterQueryV2Schema.safeParse({ ...EMPTY_QUERY, version: 1 }).success).toBe(false);
  });

  it('rejects an unknown ci facet value', () => {
    const bad = { ...EMPTY_QUERY, facets: { ...EMPTY_QUERY.facets, ci: ['boom'] } };
    expect(RepoFilterQueryV2Schema.safeParse(bad).success).toBe(false);
  });

  it('rejects an over-long owners array', () => {
    const bad = {
      ...EMPTY_QUERY,
      facets: { ...EMPTY_QUERY.facets, owners: Array.from({ length: 1001 }, () => 'o') },
    };
    expect(RepoFilterQueryV2Schema.safeParse(bad).success).toBe(false);
  });

  it('rejects an invalid repoSelection mode', () => {
    const bad = { ...EMPTY_QUERY, repoSelection: { mode: 'nope', names: [] } };
    expect(RepoFilterQueryV2Schema.safeParse(bad).success).toBe(false);
  });
});

describe('persistence + migration', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('falls back to EMPTY_QUERY when nothing is stored', () => {
    expect(createRepoFilterQueryStore().load()).toEqual(EMPTY_QUERY);
  });

  it('round-trips a saved query', () => {
    const store = createRepoFilterQueryStore();
    store.save({ ...EMPTY_QUERY, text: 'foo' });
    expect(store.load().text).toBe('foo');
  });

  it('falls back to EMPTY_QUERY on corrupt v2 JSON', () => {
    localStorage.setItem(STORAGE_KEY_V2, '{bad');
    expect(createRepoFilterQueryStore().load()).toEqual(EMPTY_QUERY);
  });

  it('upgrades a bare string[] stored under the v2 key via the migrate hook', () => {
    localStorage.setItem(STORAGE_KEY_V2, JSON.stringify(['octo/a']));
    expect(createRepoFilterQueryStore().load().repoSelection).toEqual({
      mode: 'include',
      names: ['octo/a'],
    });
  });

  it('migrates a legacy string[] under the old key into an include query', () => {
    localStorage.setItem(LEGACY_REPO_FILTER_KEY, JSON.stringify(['octo/a', 'octo/b']));
    const store = createRepoFilterQueryStore();
    expect(migrateLegacyRepoFilter(store)).toBe(true);
    const loaded = store.load();
    expect(loaded.version).toBe(2);
    expect(loaded.repoSelection).toEqual({ mode: 'include', names: ['octo/a', 'octo/b'] });
    expect(loaded.facets).toEqual(EMPTY_QUERY.facets);
  });

  it('dedupes names while migrating the legacy selection', () => {
    localStorage.setItem(LEGACY_REPO_FILTER_KEY, JSON.stringify(['octo/a', 'octo/a']));
    const store = createRepoFilterQueryStore();
    migrateLegacyRepoFilter(store);
    expect(store.load().repoSelection.names).toEqual(['octo/a']);
  });

  it('treats an empty legacy selection as EMPTY_QUERY (all)', () => {
    localStorage.setItem(LEGACY_REPO_FILTER_KEY, JSON.stringify([]));
    const store = createRepoFilterQueryStore();
    migrateLegacyRepoFilter(store);
    expect(store.load()).toEqual(EMPTY_QUERY);
  });

  it('prefers an existing v2 payload over the legacy key', () => {
    const store = createRepoFilterQueryStore();
    store.save({ ...EMPTY_QUERY, text: 'kept' });
    localStorage.setItem(LEGACY_REPO_FILTER_KEY, JSON.stringify(['octo/a']));
    expect(migrateLegacyRepoFilter(store)).toBe(false);
    expect(store.load().text).toBe('kept');
  });

  it('keeps the legacy key for rollback after migrating', () => {
    localStorage.setItem(LEGACY_REPO_FILTER_KEY, JSON.stringify(['octo/a']));
    migrateLegacyRepoFilter(createRepoFilterQueryStore());
    expect(localStorage.getItem(LEGACY_REPO_FILTER_KEY)).not.toBeNull();
  });

  it('returns false on missing legacy data', () => {
    expect(migrateLegacyRepoFilter(createRepoFilterQueryStore())).toBe(false);
  });

  it('returns false on corrupt legacy JSON', () => {
    localStorage.setItem(LEGACY_REPO_FILTER_KEY, '{bad');
    expect(migrateLegacyRepoFilter(createRepoFilterQueryStore())).toBe(false);
  });

  it('returns false on a non-array legacy payload', () => {
    localStorage.setItem(LEGACY_REPO_FILTER_KEY, JSON.stringify({ nope: true }));
    expect(migrateLegacyRepoFilter(createRepoFilterQueryStore())).toBe(false);
  });

  it('returns false when store.save() fails (e.g., storage quota)', () => {
    // Stub a failing store.
    const failingStore = createRepoFilterQueryStore();
    const saveSpy = vi.fn(() => false);
    failingStore.save = saveSpy;

    localStorage.setItem(LEGACY_REPO_FILTER_KEY, JSON.stringify(['octo/a']));
    expect(migrateLegacyRepoFilter(failingStore)).toBe(false);

    // save was attempted once with the migrated query (not just silently skipped).
    expect(saveSpy).toHaveBeenCalledOnce();
    expect(saveSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        repoSelection: { mode: 'include', names: ['octo/a'] },
      }),
    );
    // Legacy key preserved — a failed save must not destroy the source data.
    expect(localStorage.getItem(LEGACY_REPO_FILTER_KEY)).toBe(JSON.stringify(['octo/a']));
  });
});

describe('EMPTY_QUERY', () => {
  it('is frozen to prevent mutation', () => {
    expect(Object.isFrozen(EMPTY_QUERY)).toBe(true);
  });

  it('has all nested repoSelection objects frozen', () => {
    expect(Object.isFrozen(EMPTY_QUERY.repoSelection)).toBe(true);
    expect(Object.isFrozen(EMPTY_QUERY.repoSelection.names)).toBe(true);
  });

  it('has all nested facets objects and arrays frozen', () => {
    expect(Object.isFrozen(EMPTY_QUERY.facets)).toBe(true);
    expect(Object.isFrozen(EMPTY_QUERY.facets.owners)).toBe(true);
    expect(Object.isFrozen(EMPTY_QUERY.facets.health)).toBe(true);
    expect(Object.isFrozen(EMPTY_QUERY.facets.ci)).toBe(true);
    expect(Object.isFrozen(EMPTY_QUERY.facets.security)).toBe(true);
    expect(Object.isFrozen(EMPTY_QUERY.facets.security.grades)).toBe(true);
    expect(Object.isFrozen(EMPTY_QUERY.facets.security.severities)).toBe(true);
    expect(Object.isFrozen(EMPTY_QUERY.facets.pullRequests)).toBe(true);
    expect(Object.isFrozen(EMPTY_QUERY.facets.reviews)).toBe(true);
    expect(Object.isFrozen(EMPTY_QUERY.facets.issues)).toBe(true);
    expect(Object.isFrozen(EMPTY_QUERY.facets.stale)).toBe(true);
    expect(Object.isFrozen(EMPTY_QUERY.facets.visibility)).toBe(true);
  });
});

describe('evaluateRepoFilterQuery', () => {
  it('matches all repos for an empty query', () => {
    const repos = [repo('o/a'), repo('o/b')];
    expect(evaluateRepoFilterQuery(EMPTY_QUERY, repos, () => ({}))).toEqual(
      new Set(['o/a', 'o/b']),
    );
  });

  it('owners facet narrows by owner (OR within a group)', () => {
    const repos = [repo('alice/a'), repo('bob/b'), repo('carol/c')];
    expect(
      evaluateRepoFilterQuery(q({ facets: { owners: ['alice', 'bob'] } }), repos, () => ({})),
    ).toEqual(new Set(['alice/a', 'bob/b']));
  });

  it('health facet reuses fleet-summary classification', () => {
    const repos = [repo('o/broken'), repo('o/warn'), repo('o/healthy')];
    const get = getter({
      'o/broken': { ci: { status: 'ready', conclusion: 'failure' } },
      'o/warn': { stale: { status: 'ready', staleCount: 2 } },
      'o/healthy': { ci: { status: 'ready', conclusion: 'success' } },
    });
    expect(evaluateRepoFilterQuery(q({ facets: { health: ['broken'] } }), repos, get)).toEqual(
      new Set(['o/broken']),
    );
    expect(evaluateRepoFilterQuery(q({ facets: { health: ['warning'] } }), repos, get)).toEqual(
      new Set(['o/warn']),
    );
    expect(evaluateRepoFilterQuery(q({ facets: { health: ['healthy'] } }), repos, get)).toEqual(
      new Set(['o/healthy']),
    );
  });

  it('ci facet matches only ready slices with the chosen conclusion', () => {
    const repos = [repo('o/fail'), repo('o/ok'), repo('o/loading')];
    const get = getter({
      'o/fail': { ci: { status: 'ready', conclusion: 'failure' } },
      'o/ok': { ci: { status: 'ready', conclusion: 'success' } },
      'o/loading': { ci: { status: 'loading', conclusion: 'failure' } },
    });
    expect(evaluateRepoFilterQuery(q({ facets: { ci: ['failure'] } }), repos, get)).toEqual(
      new Set(['o/fail']),
    );
  });

  it('security maxGrade C matches grades C..F (worse-or-equal)', () => {
    const grades = ['A', 'B', 'C', 'D', 'E', 'F'] as const;
    const repos = grades.map((g) => repo(`o/${g}`));
    const map: Record<string, RepoSignalData> = {};
    for (const g of grades) map[`o/${g}`] = { security: { status: 'ready', grade: g } };
    const facets = { security: { grades: [], maxGrade: 'C' as const, severities: [] } };
    expect(evaluateRepoFilterQuery(q({ facets }), repos, getter(map))).toEqual(
      new Set(['o/C', 'o/D', 'o/E', 'o/F']),
    );
  });

  it('security grades list matches the exact grades', () => {
    const repos = [repo('o/a'), repo('o/b')];
    const get = getter({
      'o/a': { security: { status: 'ready', grade: 'A' } },
      'o/b': { security: { status: 'ready', grade: 'B' } },
    });
    const facets = { security: { grades: ['A' as const], severities: [] } };
    expect(evaluateRepoFilterQuery(q({ facets }), repos, get)).toEqual(new Set(['o/a']));
  });

  it('security severities matches repos with a counted alert of that severity', () => {
    const repos = [repo('o/crit'), repo('o/low')];
    const get = getter({
      'o/crit': {
        security: { status: 'ready', counts: { critical: 1, high: 0, medium: 0, low: 0 } },
      },
      'o/low': {
        security: { status: 'ready', counts: { critical: 0, high: 0, medium: 0, low: 3 } },
      },
    });
    const facets = { security: { grades: [], severities: ['critical' as const] } };
    expect(evaluateRepoFilterQuery(q({ facets }), repos, get)).toEqual(new Set(['o/crit']));
  });

  it('security severities facet requires counts field (regression for !counts guard)', () => {
    const repos = [repo('o/no-counts')];
    const get = getter({
      'o/no-counts': { security: { status: 'ready', grade: 'A' } }, // no counts field
    });
    const facets = { security: { grades: [], severities: ['critical' as const] } };
    expect(evaluateRepoFilterQuery(q({ facets }), repos, get)).toEqual(new Set());
  });

  it('security truncated:true matches only truncated repos', () => {
    const repos = [repo('o/t'), repo('o/f')];
    const get = getter({
      'o/t': { security: { status: 'ready', grade: 'A', truncated: true } },
      'o/f': { security: { status: 'ready', grade: 'A' } },
    });
    const facets = { security: { grades: [], severities: [], truncated: true } };
    expect(evaluateRepoFilterQuery(q({ facets }), repos, get)).toEqual(new Set(['o/t']));
  });

  it('security facet requires a ready slice', () => {
    const repos = [repo('o/loading')];
    const get = getter({ 'o/loading': { security: { status: 'loading', grade: 'F' } } });
    const facets = { security: { grades: [], maxGrade: 'A' as const, severities: [] } };
    expect(evaluateRepoFilterQuery(q({ facets }), repos, get)).toEqual(new Set());
  });

  it('pullRequests facet matches open and external (OR within group)', () => {
    const repos = [repo('o/open'), repo('o/ext'), repo('o/none')];
    const get = getter({
      'o/open': { pullRequests: { status: 'ready', openCount: 3, externalCount: 0 } },
      'o/ext': { pullRequests: { status: 'ready', openCount: 1, externalCount: 1 } },
      'o/none': { pullRequests: { status: 'ready', openCount: 0, externalCount: 0 } },
    });
    expect(
      evaluateRepoFilterQuery(q({ facets: { pullRequests: ['external'] } }), repos, get),
    ).toEqual(new Set(['o/ext']));
    expect(evaluateRepoFilterQuery(q({ facets: { pullRequests: ['open'] } }), repos, get)).toEqual(
      new Set(['o/open', 'o/ext']),
    );
  });

  it('reviews awaiting-me matches repos with a pending request', () => {
    const repos = [repo('o/req'), repo('o/none')];
    const get = getter({
      'o/req': { reviews: { status: 'ready', requestedCount: 2 } },
      'o/none': { reviews: { status: 'ready', requestedCount: 0 } },
    });
    expect(
      evaluateRepoFilterQuery(q({ facets: { reviews: ['awaiting-me'] } }), repos, get),
    ).toEqual(new Set(['o/req']));
  });

  it('issues facet matches open and over-threshold', () => {
    const repos = [repo('o/over'), repo('o/open'), repo('o/none')];
    const get = getter({
      'o/over': { issues: { status: 'ready', openCount: 99, overThreshold: true } },
      'o/open': { issues: { status: 'ready', openCount: 2, overThreshold: false } },
      'o/none': { issues: { status: 'ready', openCount: 0, overThreshold: false } },
    });
    expect(
      evaluateRepoFilterQuery(q({ facets: { issues: ['over-threshold'] } }), repos, get),
    ).toEqual(new Set(['o/over']));
    expect(evaluateRepoFilterQuery(q({ facets: { issues: ['open'] } }), repos, get)).toEqual(
      new Set(['o/over', 'o/open']),
    );
  });

  it('stale facet matches by item type and by any', () => {
    const repos = [repo('o/pr'), repo('o/issue'), repo('o/none')];
    const get = getter({
      'o/pr': {
        stale: {
          status: 'ready',
          staleCount: 1,
          staleItems: [{ number: 1, title: 't', html_url: 'u', updated_at: 'd', type: 'pr' }],
        },
      },
      'o/issue': {
        stale: {
          status: 'ready',
          staleCount: 1,
          staleItems: [{ number: 2, title: 't', html_url: 'u', updated_at: 'd', type: 'issue' }],
        },
      },
      'o/none': { stale: { status: 'ready', staleCount: 0 } },
    });
    expect(evaluateRepoFilterQuery(q({ facets: { stale: ['pr'] } }), repos, get)).toEqual(
      new Set(['o/pr']),
    );
    expect(evaluateRepoFilterQuery(q({ facets: { stale: ['issue'] } }), repos, get)).toEqual(
      new Set(['o/issue']),
    );
    expect(evaluateRepoFilterQuery(q({ facets: { stale: ['any'] } }), repos, get)).toEqual(
      new Set(['o/pr', 'o/issue']),
    );
  });

  it('visibility facet matches private and public from the repo flag', () => {
    const repos = [repo('o/priv', true), repo('o/pub', false)];
    expect(
      evaluateRepoFilterQuery(q({ facets: { visibility: ['private'] } }), repos, () => ({})),
    ).toEqual(new Set(['o/priv']));
    expect(
      evaluateRepoFilterQuery(q({ facets: { visibility: ['public'] } }), repos, () => ({})),
    ).toEqual(new Set(['o/pub']));
  });

  it('ANDs across facet groups', () => {
    const repos = [repo('alice/broken'), repo('alice/ok'), repo('bob/broken')];
    const get = getter({
      'alice/broken': { ci: { status: 'ready', conclusion: 'failure' } },
      'alice/ok': { ci: { status: 'ready', conclusion: 'success' } },
      'bob/broken': { ci: { status: 'ready', conclusion: 'failure' } },
    });
    expect(
      evaluateRepoFilterQuery(q({ facets: { owners: ['alice'], health: ['broken'] } }), repos, get),
    ).toEqual(new Set(['alice/broken']));
  });

  it('text narrows by case-insensitive substring on name, owner and nameWithOwner', () => {
    const repos = [repo('alice/dashboard'), repo('bob/api')];
    expect(evaluateRepoFilterQuery(q({ text: 'DASH' }), repos, () => ({}))).toEqual(
      new Set(['alice/dashboard']),
    );
    expect(evaluateRepoFilterQuery(q({ text: 'bob' }), repos, () => ({}))).toEqual(
      new Set(['bob/api']),
    );
  });

  it('applies repoSelection include after facets (intersect)', () => {
    const repos = [repo('o/a'), repo('o/b'), repo('o/c')];
    expect(
      evaluateRepoFilterQuery(
        q({ repoSelection: { mode: 'include', names: ['o/a', 'o/c'] } }),
        repos,
        () => ({}),
      ),
    ).toEqual(new Set(['o/a', 'o/c']));
  });

  it('applies repoSelection exclude after facets (remove)', () => {
    const repos = [repo('o/a'), repo('o/b'), repo('o/c')];
    expect(
      evaluateRepoFilterQuery(
        q({ repoSelection: { mode: 'exclude', names: ['o/b'] } }),
        repos,
        () => ({}),
      ),
    ).toEqual(new Set(['o/a', 'o/c']));
  });

  it('repoSelection all pins nothing', () => {
    const repos = [repo('o/a'), repo('o/b')];
    expect(
      evaluateRepoFilterQuery(
        q({ repoSelection: { mode: 'all', names: ['o/a'] } }),
        repos,
        () => ({}),
      ),
    ).toEqual(new Set(['o/a', 'o/b']));
  });

  it('intersects facets with an include selection', () => {
    const repos = [repo('alice/a'), repo('bob/b')];
    expect(
      evaluateRepoFilterQuery(
        q({
          facets: { owners: ['alice', 'bob'] },
          repoSelection: { mode: 'include', names: ['alice/a'] },
        }),
        repos,
        () => ({}),
      ),
    ).toEqual(new Set(['alice/a']));
  });
});

describe('derivedSelectedSet', () => {
  it('aliases evaluateRepoFilterQuery', () => {
    const repos = [repo('o/a'), repo('o/b')];
    expect(derivedSelectedSet(q({ facets: { owners: ['o'] } }), repos, () => ({}))).toEqual(
      evaluateRepoFilterQuery(q({ facets: { owners: ['o'] } }), repos, () => ({})),
    );
  });
});

describe('isQueryActive', () => {
  it('is false for EMPTY_QUERY', () => {
    expect(isQueryActive(EMPTY_QUERY)).toBe(false);
  });

  it('is false for whitespace-only text', () => {
    expect(isQueryActive(q({ text: '   ' }))).toBe(false);
  });

  it('is true when text is set', () => {
    expect(isQueryActive(q({ text: 'x' }))).toBe(true);
  });

  it('is true when an array facet is set', () => {
    expect(isQueryActive(q({ facets: { health: ['broken'] } }))).toBe(true);
  });

  it('is true when the security maxGrade is set', () => {
    expect(
      isQueryActive(q({ facets: { security: { grades: [], severities: [], maxGrade: 'C' } } })),
    ).toBe(true);
  });

  it('is true for an include selection', () => {
    expect(isQueryActive(q({ repoSelection: { mode: 'include', names: [] } }))).toBe(true);
  });

  it('is true for an exclude selection with names', () => {
    expect(isQueryActive(q({ repoSelection: { mode: 'exclude', names: ['o/a'] } }))).toBe(true);
  });

  it('is false for an exclude selection with no names', () => {
    expect(isQueryActive(q({ repoSelection: { mode: 'exclude', names: [] } }))).toBe(false);
  });
});
