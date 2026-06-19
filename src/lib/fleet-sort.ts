/**
 * Pure sort & filter helpers for the Fleet grid. No React, no DOM — fully unit
 * testable. The grid and its tests share these so ordering stays consistent.
 */
import type { FleetColumn, FleetSortState, GetRowData, Repo, SortValue } from '../types/fleet';

/** Frozen empty signal payload — the framework default until features fill it. */
export const EMPTY_SIGNAL_DATA = Object.freeze({});

/** Filters repos by a case-insensitive substring of `owner/repo`. */
export function filterRepos(repos: readonly Repo[], query: string): Repo[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') {
    return repos.slice();
  }
  return repos.filter((repo) => repo.nameWithOwner.toLowerCase().includes(needle));
}

/**
 * Compares two sort values: numerically when both are numbers, otherwise as
 * case-insensitive strings. Stable, locale-aware, and total over mixed types.
 */
export function compareSortValues(a: SortValue, b: SortValue): number {
  if (typeof a === 'number' && typeof b === 'number') {
    return a - b;
  }
  return String(a).localeCompare(String(b), undefined, { sensitivity: 'base' });
}

function sortValueFor(
  repo: Repo,
  column: FleetColumn | undefined,
  getRowData: GetRowData,
): SortValue {
  if (column?.getSortValue) {
    return column.getSortValue(repo, getRowData(repo));
  }
  return repo.nameWithOwner;
}

/**
 * Returns a new array sorted by `column` in `direction`. Sorting is stable:
 * repos with equal sort values keep their original order in both directions.
 * Falls back to `owner/repo` when the column has no `getSortValue`.
 */
export function sortRepos(
  repos: readonly Repo[],
  column: FleetColumn | undefined,
  direction: 'asc' | 'desc',
  getRowData: GetRowData,
): Repo[] {
  const factor = direction === 'desc' ? -1 : 1;
  return repos
    .map((repo, index) => ({ repo, index, value: sortValueFor(repo, column, getRowData) }))
    .sort((a, b) => {
      const cmp = compareSortValues(a.value, b.value);
      return cmp !== 0 ? cmp * factor : a.index - b.index;
    })
    .map((entry) => entry.repo);
}

/**
 * Picks the starting sort: a valid persisted sort over a sortable column wins;
 * otherwise the first sortable column (with its preferred direction), or the
 * very first column when none are sortable.
 */
export function resolveInitialSort(
  columns: readonly FleetColumn[],
  persisted: FleetSortState | null,
): FleetSortState {
  if (persisted) {
    const target = columns.find((column) => column.id === persisted.columnId);
    if (target?.sortable) {
      return { columnId: persisted.columnId, direction: persisted.direction };
    }
  }
  const fallback = columns.find((column) => column.sortable) ?? columns[0];
  return { columnId: fallback.id, direction: fallback.defaultSortDirection ?? 'asc' };
}

/**
 * Computes the next sort when a header is activated: toggles direction when the
 * same column is reselected, otherwise switches to the new column using its
 * preferred direction (ascending by default).
 */
export function nextSortState(
  current: FleetSortState,
  columnId: string,
  columns: readonly FleetColumn[],
): FleetSortState {
  if (columnId === current.columnId) {
    return { columnId, direction: current.direction === 'asc' ? 'desc' : 'asc' };
  }
  const target = columns.find((column) => column.id === columnId);
  return { columnId, direction: target?.defaultSortDirection ?? 'asc' };
}
