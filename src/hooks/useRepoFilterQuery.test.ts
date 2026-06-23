import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { GetRowData, Repo, RepoSignalData } from '../types/fleet';
import {
  EMPTY_QUERY,
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
    act(() => result.current.toggleHealth('broken'));
    expect(result.current.query.facets.health).toEqual(['broken']);
    expect([...result.current.derivedSelected].sort()).toEqual(['acme/c', 'octo/a', 'octo/b']);
  });

  it('toggleCi filters by CI conclusion', () => {
    const { result } = renderHook(() => useRepoFilterQuery(fleet, getRowData));
    act(() => result.current.toggleCi('failure'));
    expect(result.current.query.facets.ci).toEqual(['failure']);
    expect([...result.current.derivedSelected]).toEqual(['octo/a']);
  });

  it('toggleSecurityGrade filters by grade', () => {
    const { result } = renderHook(() => useRepoFilterQuery(fleet, getRowData));
    act(() => result.current.toggleSecurityGrade('F'));
    expect(result.current.query.facets.security.grades).toEqual(['F']);
    expect([...result.current.derivedSelected]).toEqual(['acme/c']);
  });

  it('setSecurityMaxGrade sets and clears the max grade', () => {
    const { result } = renderHook(() => useRepoFilterQuery(fleet, getRowData));
    act(() => result.current.setSecurityMaxGrade('C'));
    expect(result.current.query.facets.security.maxGrade).toBe('C');
    expect([...result.current.derivedSelected]).toEqual(['acme/c']);
    act(() => result.current.setSecurityMaxGrade(undefined));
    expect(result.current.query.facets.security.maxGrade).toBeUndefined();
  });

  it('toggleSecuritySeverity filters by severity presence', () => {
    const { result } = renderHook(() => useRepoFilterQuery(fleet, getRowData));
    act(() => result.current.toggleSecuritySeverity('critical'));
    expect(result.current.query.facets.security.severities).toEqual(['critical']);
    expect([...result.current.derivedSelected]).toEqual(['acme/c']);
  });

  it('togglePullRequests filters by open PRs', () => {
    const { result } = renderHook(() => useRepoFilterQuery(fleet, getRowData));
    act(() => result.current.togglePullRequests('open'));
    expect(result.current.query.facets.pullRequests).toEqual(['open']);
    expect([...result.current.derivedSelected]).toEqual(['octo/a']);
  });

  it('toggleReviewsAwaitingMe toggles the reviews facet', () => {
    const { result } = renderHook(() => useRepoFilterQuery(fleet, getRowData));
    act(() => result.current.toggleReviewsAwaitingMe());
    expect(result.current.query.facets.reviews).toEqual(['awaiting-me']);
    expect([...result.current.derivedSelected]).toEqual(['acme/c']);
    act(() => result.current.toggleReviewsAwaitingMe());
    expect(result.current.query.facets.reviews).toEqual([]);
  });

  it('toggleIssues filters by issue options', () => {
    const { result } = renderHook(() => useRepoFilterQuery(fleet, getRowData));
    act(() => result.current.toggleIssues('over-threshold'));
    expect(result.current.query.facets.issues).toEqual(['over-threshold']);
    expect([...result.current.derivedSelected]).toEqual(['octo/b']);
  });

  it('toggleStale filters by stale options', () => {
    const { result } = renderHook(() => useRepoFilterQuery(fleet, getRowData));
    act(() => result.current.toggleStale('any'));
    expect(result.current.query.facets.stale).toEqual(['any']);
    expect([...result.current.derivedSelected]).toEqual(['acme/c']);
  });

  it('toggleVisibility filters by visibility', () => {
    const { result } = renderHook(() => useRepoFilterQuery(fleet, getRowData));
    act(() => result.current.toggleVisibility('private'));
    expect(result.current.query.facets.visibility).toEqual(['private']);
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
    act(() => result.current.toggleRepoPin('octo/a'));
    expect(result.current.query.repoSelection.names).toEqual([]);
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
    const { result, rerender } = renderHook(
      ({ repos }) => useRepoFilterQuery(repos, getRowData),
      { initialProps: { repos: [] as Repo[] } },
    );
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
    const { result } = renderHook(() =>
      useRepoFilterQuery([repoA, repoB, repoC], getRowData),
    );
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
