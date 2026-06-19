import { describe, expect, it } from 'vitest';

import type { FleetColumn, Repo } from '../types/fleet';
import {
  EMPTY_SIGNAL_DATA,
  compareSortValues,
  filterRepos,
  nextSortState,
  resolveInitialSort,
  sortRepos,
} from './fleet-sort';

function repo(nameWithOwner: string, isPrivate = false): Repo {
  const slash = nameWithOwner.indexOf('/');
  return {
    nameWithOwner,
    owner: nameWithOwner.slice(0, slash),
    name: nameWithOwner.slice(slash + 1),
    isPrivate,
  };
}

const nameColumn: FleetColumn = {
  id: 'repo',
  header: 'Repository',
  sortable: true,
  defaultSortDirection: 'asc',
  getSortValue: (r) => r.nameWithOwner.toLowerCase(),
  render: (r) => r.nameWithOwner,
};

const scoreColumn: FleetColumn = {
  id: 'score',
  header: 'Score',
  sortable: true,
  defaultSortDirection: 'desc',
  getSortValue: (_r, data) => data.ci?.score ?? 0,
  render: () => null,
};

const plainColumn: FleetColumn = {
  id: 'plain',
  header: 'Plain',
  render: () => null,
};

describe('filterRepos', () => {
  const repos = [repo('octo/apple'), repo('octo/Banana'), repo('acme/cherry')];

  it('returns every repo for an empty or whitespace query', () => {
    expect(filterRepos(repos, '')).toHaveLength(3);
    expect(filterRepos(repos, '   ')).toHaveLength(3);
  });

  it('matches a case-insensitive substring of owner/repo', () => {
    expect(filterRepos(repos, 'banana').map((r) => r.nameWithOwner)).toEqual(['octo/Banana']);
    expect(filterRepos(repos, 'OCTO').map((r) => r.nameWithOwner)).toEqual([
      'octo/apple',
      'octo/Banana',
    ]);
  });

  it('returns an empty list when nothing matches', () => {
    expect(filterRepos(repos, 'zzz')).toEqual([]);
  });

  it('does not mutate the input array', () => {
    const input = [repo('octo/apple')];
    filterRepos(input, '');
    expect(input).toHaveLength(1);
  });
});

describe('compareSortValues', () => {
  it('orders numbers numerically', () => {
    expect(compareSortValues(2, 10)).toBeLessThan(0);
    expect(compareSortValues(10, 2)).toBeGreaterThan(0);
    expect(compareSortValues(5, 5)).toBe(0);
  });

  it('orders strings case-insensitively', () => {
    expect(compareSortValues('apple', 'Banana')).toBeLessThan(0);
    expect(compareSortValues('Zed', 'alpha')).toBeGreaterThan(0);
  });

  it('coerces mixed types to strings', () => {
    expect(compareSortValues('10', 9)).toBeLessThan(0); // numeric-aware string compare: 10 > 9? numeric:true => 9 < 10
  });
});

describe('sortRepos', () => {
  const repos = [repo('octo/zebra'), repo('octo/apple'), repo('octo/mango')];

  it('sorts ascending by the column sort value', () => {
    const sorted = sortRepos(repos, nameColumn, 'asc', () => EMPTY_SIGNAL_DATA);
    expect(sorted.map((r) => r.nameWithOwner)).toEqual(['octo/apple', 'octo/mango', 'octo/zebra']);
  });

  it('sorts descending', () => {
    const sorted = sortRepos(repos, nameColumn, 'desc', () => EMPTY_SIGNAL_DATA);
    expect(sorted.map((r) => r.nameWithOwner)).toEqual(['octo/zebra', 'octo/mango', 'octo/apple']);
  });

  it('uses the per-repo signal data for the sort value', () => {
    const scores: Record<string, number> = { 'octo/zebra': 1, 'octo/apple': 9, 'octo/mango': 5 };
    const sorted = sortRepos(repos, scoreColumn, 'desc', (r) => ({
      ci: { status: 'ready', score: scores[r.nameWithOwner] },
    }));
    expect(sorted.map((r) => r.nameWithOwner)).toEqual(['octo/apple', 'octo/mango', 'octo/zebra']);
  });

  it('falls back to nameWithOwner when the column has no getSortValue', () => {
    const sorted = sortRepos(repos, plainColumn, 'asc', () => EMPTY_SIGNAL_DATA);
    expect(sorted.map((r) => r.nameWithOwner)).toEqual(['octo/apple', 'octo/mango', 'octo/zebra']);
  });

  it('falls back to nameWithOwner when no column is active', () => {
    const sorted = sortRepos(repos, undefined, 'asc', () => EMPTY_SIGNAL_DATA);
    expect(sorted.map((r) => r.nameWithOwner)).toEqual(['octo/apple', 'octo/mango', 'octo/zebra']);
  });

  it('is stable for equal sort values regardless of direction', () => {
    const tied = [repo('octo/a'), repo('octo/b'), repo('octo/c')];
    const allEqual: FleetColumn = { ...scoreColumn, getSortValue: () => 0 };
    const asc = sortRepos(tied, allEqual, 'asc', () => EMPTY_SIGNAL_DATA);
    const desc = sortRepos(tied, allEqual, 'desc', () => EMPTY_SIGNAL_DATA);
    expect(asc.map((r) => r.nameWithOwner)).toEqual(['octo/a', 'octo/b', 'octo/c']);
    expect(desc.map((r) => r.nameWithOwner)).toEqual(['octo/a', 'octo/b', 'octo/c']);
  });

  it('does not mutate the input array', () => {
    const input = [repo('octo/zebra'), repo('octo/apple')];
    sortRepos(input, nameColumn, 'asc', () => EMPTY_SIGNAL_DATA);
    expect(input.map((r) => r.nameWithOwner)).toEqual(['octo/zebra', 'octo/apple']);
  });
});

describe('resolveInitialSort', () => {
  const columns = [nameColumn, plainColumn, scoreColumn];

  it('uses a valid persisted sort for a sortable column', () => {
    expect(resolveInitialSort(columns, { columnId: 'score', direction: 'asc' })).toEqual({
      columnId: 'score',
      direction: 'asc',
    });
  });

  it('ignores a persisted sort that targets a non-sortable column', () => {
    expect(resolveInitialSort(columns, { columnId: 'plain', direction: 'desc' })).toEqual({
      columnId: 'repo',
      direction: 'asc',
    });
  });

  it('ignores a persisted sort that targets an unknown column', () => {
    expect(resolveInitialSort(columns, { columnId: 'ghost', direction: 'desc' })).toEqual({
      columnId: 'repo',
      direction: 'asc',
    });
  });

  it('defaults to the first sortable column and its preferred direction', () => {
    expect(resolveInitialSort(columns, null)).toEqual({ columnId: 'repo', direction: 'asc' });
    expect(resolveInitialSort([scoreColumn, nameColumn], null)).toEqual({
      columnId: 'score',
      direction: 'desc',
    });
  });

  it('falls back to the first column when none are sortable', () => {
    expect(resolveInitialSort([plainColumn], null)).toEqual({
      columnId: 'plain',
      direction: 'asc',
    });
  });
});

describe('nextSortState', () => {
  const columns = [nameColumn, scoreColumn];

  it('toggles direction when the same column is reselected', () => {
    expect(nextSortState({ columnId: 'repo', direction: 'asc' }, 'repo', columns)).toEqual({
      columnId: 'repo',
      direction: 'desc',
    });
    expect(nextSortState({ columnId: 'repo', direction: 'desc' }, 'repo', columns)).toEqual({
      columnId: 'repo',
      direction: 'asc',
    });
  });

  it("uses the new column's preferred direction when switching columns", () => {
    expect(nextSortState({ columnId: 'repo', direction: 'asc' }, 'score', columns)).toEqual({
      columnId: 'score',
      direction: 'desc',
    });
  });

  it('defaults to ascending when the new column has no preferred direction', () => {
    expect(
      nextSortState({ columnId: 'score', direction: 'desc' }, 'repo', [
        scoreColumn,
        plainColumn,
        { ...nameColumn, defaultSortDirection: undefined },
      ]),
    ).toEqual({
      columnId: 'repo',
      direction: 'asc',
    });
  });
});
