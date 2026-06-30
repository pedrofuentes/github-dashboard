import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { GetRowData, Repo, RepoSignalData } from '../types/fleet';
import * as repoFilterQuery from '../lib/repo-filter-query';
import {
  EMPTY_QUERY,
  LEGACY_REPO_FILTER_KEY,
  STORAGE_KEY_V2,
  type RepoFilterQueryV2,
} from '../lib/repo-filter-query';
import { useRepoFilterQuery } from './useRepoFilterQuery';

const mkRepo = (owner: string, name: string, isPrivate = false): Repo => ({
  nameWithOwner: `${owner}/${name}`,
  owner,
  name,
  isPrivate,
});

const emptyFacets = (): RepoFilterQueryV2['facets'] => ({
  owners: [],
  health: [],
  ci: [],
  security: { grades: [], severities: [] },
  pullRequests: [],
  reviews: [],
  issues: [],
  stale: [],
  visibility: [],
});

const includeQuery = (names: string[]): RepoFilterQueryV2 => ({
  version: 2,
  text: '',
  repoSelection: { mode: 'include', names },
  facets: emptyFacets(),
});

const persist = (query: RepoFilterQueryV2): void => {
  localStorage.setItem(STORAGE_KEY_V2, JSON.stringify(query));
};

const readStored = (): RepoFilterQueryV2 | null => {
  const raw = localStorage.getItem(STORAGE_KEY_V2);
  return raw === null ? null : (JSON.parse(raw) as RepoFilterQueryV2);
};

// A small fleet with crafted signal data so derivedSelected reflects facets.
const repoA = mkRepo('octo', 'a'); // broken: failing CI
const repoB = mkRepo('octo', 'b'); // healthy: passing CI
const repoC = mkRepo('acme', 'c', true); // private, security F, reviews awaiting

const rowData: Record<string, RepoSignalData> = {
  'octo/a': {
    ci: { status: 'ready', conclusion: 'failure' },
    pullRequests: { status: 'ready', openCount: 2, externalCount: 0 },
  },
  'octo/b': {
    ci: { status: 'ready', conclusion: 'success' },
    issues: { status: 'ready', openCount: 9, overThreshold: true },
  },
  'acme/c': {
    security: { status: 'ready', grade: 'F', counts: { critical: 1, high: 0, medium: 0, low: 0 } },
    reviews: { status: 'ready', requestedCount: 1 },
    stale: { status: 'ready', staleCount: 1, staleItems: [] },
  },
};

const getRowData: GetRowData = (repo) => rowData[repo.nameWithOwner] ?? {};
const fleet = [repoA, repoB, repoC];

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('initial load', () => {
  it('defaults to EMPTY_QUERY when nothing is persisted (all repos selected, not active)', () => {
    const { result } = renderHook(() => useRepoFilterQuery(fleet, getRowData));
    expect(result.current.query).toEqual(EMPTY_QUERY);
    expect(result.current.isActive).toBe(false);
    expect([...result.current.derivedSelected].sort()).toEqual(['acme/c', 'octo/a', 'octo/b']);
  });

  it('reconciles a persisted query at mount, dropping pins no longer in the fleet', () => {
    persist(includeQuery(['octo/a', 'gone/x']));
    const { result } = renderHook(() => useRepoFilterQuery([repoA], getRowData));
    expect(result.current.query.repoSelection.names).toEqual(['octo/a']);
  });
});

describe('updaters change the query, persist, and recompute derivedSelected', () => {
  it('setText narrows by text and persists', () => {
    const { result } = renderHook(() => useRepoFilterQuery(fleet, getRowData));
    act(() => result.current.setText('acme'));
    expect(result.current.query.text).toBe('acme');
    expect(readStored()?.text).toBe('acme');
    expect([...result.current.derivedSelected]).toEqual(['acme/c']);
    expect(result.current.isActive).toBe(true);
  });

  it('toggleOwner adds then removes an owner facet and persists', () => {
    const { result } = renderHook(() => useRepoFilterQuery(fleet, getRowData));
    act(() => result.current.toggleOwner('acme'));
    expect(result.current.query.facets.owners).toEqual(['acme']);
    expect(readStored()?.facets.owners).toEqual(['acme']);
    expect([...result.current.derivedSelected]).toEqual(['acme/c']);
    act(() => result.current.toggleOwner('acme'));
    expect(result.current.query.facets.owners).toEqual([]);
  });

  it('toggleHealth filters by health band', () => {
    const { result } = renderHook(() => useRepoFilterQuery(fleet, getRowData));
    // All 3 test repos classify as 'broken'; none are 'warning', so filtering by
    // 'warning' must yield an empty selection — this discriminates from the
    // unfiltered state which returns all 3.
    act(() => result.current.toggleHealth('warning'));
    expect(result.current.query.facets.health).toEqual(['warning']);
    expect(result.current.isActive).toBe(true);
    expect(readStored()?.facets.health).toEqual(['warning']);
    expect([...result.current.derivedSelected]).toHaveLength(0);

    // Positive-hit case: 'broken' matches all 3 test repos
    act(() => result.current.toggleHealth('warning')); // clear
    act(() => result.current.toggleHealth('broken'));
    expect(result.current.query.facets.health).toEqual(['broken']);
    expect([...result.current.derivedSelected]).toHaveLength(3);
  });

  it('toggleCi filters by CI conclusion', () => {
    const { result } = renderHook(() => useRepoFilterQuery(fleet, getRowData));
    act(() => result.current.toggleCi('failure'));
    expect(result.current.query.facets.ci).toEqual(['failure']);
    expect(readStored()?.facets.ci).toEqual(['failure']);
    expect([...result.current.derivedSelected]).toEqual(['octo/a']);
  });

  it('toggleSecurityGrade filters by grade', () => {
    const { result } = renderHook(() => useRepoFilterQuery(fleet, getRowData));
    act(() => result.current.toggleSecurityGrade('F'));
    expect(result.current.query.facets.security.grades).toEqual(['F']);
    expect(readStored()?.facets.security.grades).toEqual(['F']);
    expect([...result.current.derivedSelected]).toEqual(['acme/c']);
  });

  it('setSecurityMaxGrade sets and clears the max grade', () => {
    const { result } = renderHook(() => useRepoFilterQuery(fleet, getRowData));
    act(() => result.current.setSecurityMaxGrade('C'));
    expect(result.current.query.facets.security.maxGrade).toBe('C');
    expect(readStored()?.facets.security.maxGrade).toBe('C');
    expect([...result.current.derivedSelected]).toEqual(['acme/c']);
    act(() => result.current.setSecurityMaxGrade(undefined));
    expect(result.current.query.facets.security.maxGrade).toBeUndefined();
    expect(readStored()?.facets.security.maxGrade).toBeUndefined();
  });

  it('toggleSecuritySeverity filters by severity presence', () => {
    const { result } = renderHook(() => useRepoFilterQuery(fleet, getRowData));
    act(() => result.current.toggleSecuritySeverity('critical'));
    expect(result.current.query.facets.security.severities).toEqual(['critical']);
    expect(readStored()?.facets.security.severities).toEqual(['critical']);
    expect([...result.current.derivedSelected]).toEqual(['acme/c']);
  });

  it('togglePullRequests filters by open PRs', () => {
    const { result } = renderHook(() => useRepoFilterQuery(fleet, getRowData));
    act(() => result.current.togglePullRequests('open'));
    expect(result.current.query.facets.pullRequests).toEqual(['open']);
    expect(readStored()?.facets.pullRequests).toEqual(['open']);
    expect([...result.current.derivedSelected]).toEqual(['octo/a']);
  });

  it('toggleReviewsAwaitingMe toggles the reviews facet', () => {
    const { result } = renderHook(() => useRepoFilterQuery(fleet, getRowData));
    act(() => result.current.toggleReviewsAwaitingMe());
    expect(result.current.query.facets.reviews).toEqual(['awaiting-me']);
    expect(readStored()?.facets.reviews).toEqual(['awaiting-me']);
    expect([...result.current.derivedSelected]).toEqual(['acme/c']);
    act(() => result.current.toggleReviewsAwaitingMe());
    expect(result.current.query.facets.reviews).toEqual([]);
    expect(readStored()?.facets.reviews).toEqual([]);
  });

  it('toggleIssues filters by issue options', () => {
    const { result } = renderHook(() => useRepoFilterQuery(fleet, getRowData));
    act(() => result.current.toggleIssues('over-threshold'));
    expect(result.current.query.facets.issues).toEqual(['over-threshold']);
    expect(readStored()?.facets.issues).toEqual(['over-threshold']);
    expect([...result.current.derivedSelected]).toEqual(['octo/b']);
  });

  it('toggleStale filters by stale options', () => {
    const { result } = renderHook(() => useRepoFilterQuery(fleet, getRowData));
    act(() => result.current.toggleStale('any'));
    expect(result.current.query.facets.stale).toEqual(['any']);
    expect(readStored()?.facets.stale).toEqual(['any']);
    expect([...result.current.derivedSelected]).toEqual(['acme/c']);
  });

  it('toggleVisibility filters by visibility', () => {
    const { result } = renderHook(() => useRepoFilterQuery(fleet, getRowData));
    act(() => result.current.toggleVisibility('private'));
    expect(result.current.query.facets.visibility).toEqual(['private']);
    expect(readStored()?.facets.visibility).toEqual(['private']);
    expect([...result.current.derivedSelected]).toEqual(['acme/c']);
  });

  it('setRepoSelection replaces the selection mode and names', () => {
    const { result } = renderHook(() => useRepoFilterQuery(fleet, getRowData));
    act(() => result.current.setRepoSelection({ mode: 'include', names: ['octo/a'] }));
    expect(result.current.query.repoSelection).toEqual({ mode: 'include', names: ['octo/a'] });
    expect([...result.current.derivedSelected]).toEqual(['octo/a']);
    expect(readStored()?.repoSelection.mode).toBe('include');
  });

  it('toggleRepoPin adds then removes a name from the current selection', () => {
    const { result } = renderHook(() => useRepoFilterQuery(fleet, getRowData));
    act(() => result.current.setRepoSelection({ mode: 'include', names: [] }));
    act(() => result.current.toggleRepoPin('octo/a'));
    expect(result.current.query.repoSelection.names).toEqual(['octo/a']);
    expect(readStored()?.repoSelection.names).toEqual(['octo/a']);
    act(() => result.current.toggleRepoPin('octo/a'));
    expect(result.current.query.repoSelection.names).toEqual([]);
    expect(readStored()?.repoSelection.names).toEqual([]);
  });
});

describe('clearAll', () => {
  it('resets the query to EMPTY_QUERY and persists', () => {
    const { result } = renderHook(() => useRepoFilterQuery(fleet, getRowData));
    act(() => result.current.setText('acme'));
    act(() => result.current.toggleOwner('acme'));
    expect(result.current.isActive).toBe(true);
    act(() => result.current.clearAll());
    expect(result.current.query).toEqual(EMPTY_QUERY);
    expect(result.current.isActive).toBe(false);
    expect(readStored()).toEqual(EMPTY_QUERY);
  });
});

describe('reconcile on fleet change', () => {
  it('drops absent repo pins when the fleet set changes', () => {
    persist(includeQuery(['octo/a', 'gone/x']));
    const { result, rerender } = renderHook(({ repos }) => useRepoFilterQuery(repos, getRowData), {
      initialProps: { repos: [] as Repo[] },
    });
    rerender({ repos: [repoA] });
    expect(result.current.query.repoSelection.names).toEqual(['octo/a']);
  });

  it('does NOT wipe persisted pins on a populated→empty transition (empty-fleet guard)', () => {
    persist(includeQuery(['octo/a']));
    const { rerender } = renderHook(({ repos }) => useRepoFilterQuery(repos, getRowData), {
      initialProps: { repos: [repoA] as Repo[] },
    });
    rerender({ repos: [] });
    expect(readStored()?.repoSelection.names).toEqual(['octo/a']);
  });
});

describe('availableOwners', () => {
  it('derives distinct owners with repo counts, sorted by owner', () => {
    const { result } = renderHook(() => useRepoFilterQuery([repoA, repoB, repoC], getRowData));
    expect(result.current.availableOwners).toEqual([
      { owner: 'acme', count: 1 },
      { owner: 'octo', count: 2 },
    ]);
  });

  it('is empty for an empty fleet', () => {
    const { result } = renderHook(() => useRepoFilterQuery([], getRowData));
    expect(result.current.availableOwners).toEqual([]);
  });
});

describe('immutability', () => {
  it('does not mutate the previous query when an updater runs', () => {
    const { result } = renderHook(() => useRepoFilterQuery(fleet, getRowData));
    const prev = result.current.query;
    act(() => result.current.toggleOwner('octo'));
    expect(result.current.query).not.toBe(prev);
    expect(prev.facets.owners).toEqual([]);
    expect(result.current.query.facets.owners).toEqual(['octo']);
  });
});

describe('derivedSelected memoization', () => {
  it('keeps the same Set when only getRowData identity changes, then updates for real signal changes', () => {
    const signalData = { ...rowData };
    const sameSignalData = { ...signalData };
    const changedSignalData: Record<string, RepoSignalData> = {
      ...signalData,
      'octo/a': {
        ...signalData['octo/a'],
        ci: { status: 'ready', conclusion: 'success' },
      },
    };
    const makeGetRowData =
      (data: Record<string, RepoSignalData>): GetRowData =>
      (repo) =>
        data[repo.nameWithOwner] ?? {};

    const { result, rerender } = renderHook(({ getData }) => useRepoFilterQuery(fleet, getData), {
      initialProps: { getData: makeGetRowData(signalData) },
    });
    act(() => result.current.toggleCi('failure'));
    expect([...result.current.derivedSelected]).toEqual(['octo/a']);
    const selectedBeforeAccessorChange = result.current.derivedSelected;

    rerender({ getData: makeGetRowData(sameSignalData) });
    expect(result.current.derivedSelected).toBe(selectedBeforeAccessorChange);

    rerender({ getData: makeGetRowData(changedSignalData) });
    expect(result.current.derivedSelected).not.toBe(selectedBeforeAccessorChange);
    expect([...result.current.derivedSelected]).toEqual([]);
  });
});

describe('applyQuery', () => {
  it('replaces the entire query atomically', () => {
    const { result } = renderHook(() => useRepoFilterQuery(fleet, getRowData));
    // Start with an empty query.
    expect(result.current.query).toEqual(EMPTY_QUERY);

    // Apply a complex saved query (e.g., from recent filters).
    const savedQuery: RepoFilterQueryV2 = {
      version: 2,
      text: 'search term',
      repoSelection: { mode: 'include', names: ['octo/a'] },
      facets: {
        ...emptyFacets(),
        health: ['broken'],
        visibility: ['private'],
      },
    };
    act(() => result.current.applyQuery(savedQuery));

    expect(result.current.query).toEqual(savedQuery);
    expect(result.current.isActive).toBe(true);
    expect(readStored()).toEqual(savedQuery);
  });

  it('reconciles pins when applying a query', () => {
    const { result } = renderHook(() => useRepoFilterQuery(fleet, getRowData));
    // Apply a query with a pin that doesn't exist in the fleet.
    const queryWithAbsentPin: RepoFilterQueryV2 = {
      ...EMPTY_QUERY,
      repoSelection: { mode: 'include', names: ['octo/a', 'nonexistent/repo'] },
    };
    act(() => result.current.applyQuery(queryWithAbsentPin));

    // Absent pin should be dropped.
    expect(result.current.query.repoSelection.names).toEqual(['octo/a']);
  });
});

describe('legacy migration observability', () => {
  it('warns when the migration save fails to persist', () => {
    localStorage.setItem(LEGACY_REPO_FILTER_KEY, JSON.stringify(['octo/a']));
    // Inject a store whose save always fails so migrateLegacyRepoFilter returns false.
    const failingSave = vi.fn(() => false);
    vi.spyOn(repoFilterQuery, 'createRepoFilterQueryStore').mockReturnValueOnce({
      load: () => EMPTY_QUERY,
      save: failingSave,
      clear: () => {},
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    renderHook(() => useRepoFilterQuery(fleet, getRowData));

    expect(warnSpy).toHaveBeenCalledWith('[repo-filter] legacy migration failed to persist');
  });

  it('does not warn when migration succeeds', () => {
    localStorage.setItem(LEGACY_REPO_FILTER_KEY, JSON.stringify(['octo/a']));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    renderHook(() => useRepoFilterQuery(fleet, getRowData));

    expect(warnSpy).not.toHaveBeenCalledWith('[repo-filter] legacy migration failed to persist');
  });
});
