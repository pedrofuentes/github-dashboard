/**
 * FleetGrid — the repo-per-row overview grid (PRD F1). It renders an accessible
 * table whose header row and body are driven entirely by a column registry, so
 * the signal features (#12-18) extend it by editing `columns/`, never this file.
 *
 * Responsibilities owned here: layout, click/keyboard sorting with `aria-sort`,
 * a client-side name filter, loading / empty / error states, an `aria-live`
 * status announcement, localStorage persistence of sort + filter, and an
 * optional drill-down hook (REC-8). Columns own only their cell + sort value.
 */
import { useId, useState } from 'react';
import type { ChangeEvent } from 'react';

import { loadFleetPreferences, saveFleetFilter, saveFleetSort } from '../lib/fleet-preferences';
import {
  EMPTY_SIGNAL_DATA,
  filterRepos,
  nextSortState,
  resolveInitialSort,
  sortRepos,
} from '../lib/fleet-sort';
import { cn } from '../lib/cn';
import type { FleetColumn, FleetSortState, GetRowData, Repo } from '../types/fleet';
import { fleetColumns } from './columns';

const SKELETON_ROWS = 6;

const defaultGetRowData: GetRowData = () => EMPTY_SIGNAL_DATA;

interface FleetGridProps {
  /** Repositories to render (already adapted by `useRepos`). */
  repos: Repo[];
  /** Column registry; defaults to the shipped MVP columns. */
  columns?: FleetColumn[];
  /** Resolves per-repo signal data; defaults to empty (framework baseline). */
  getRowData?: GetRowData;
  /** True while a fetch is in flight (skeletons on first load, busy on reload). */
  loading?: boolean;
  /** Fetch error message; renders an alert + retry instead of the table. */
  error?: string | null;
  /** Retry handler for the error state. */
  onRetry?: () => void;
  /** Drill-down hook (REC-8): when provided, each row anchor becomes a button. */
  onRepoActivate?: (repo: Repo) => void;
}

function alignClass(column: FleetColumn): string {
  if (column.align === 'center') {
    return 'text-center';
  }
  if (column.align === 'end') {
    return 'text-right';
  }
  return 'text-left';
}

export function FleetGrid({
  repos,
  columns = fleetColumns,
  getRowData = defaultGetRowData,
  loading = false,
  error = null,
  onRetry,
  onRepoActivate,
}: FleetGridProps) {
  const filterId = useId();
  const [preferences] = useState(loadFleetPreferences);
  const [sort, setSort] = useState<FleetSortState>(() =>
    resolveInitialSort(columns, preferences.sort),
  );
  const [filter, setFilter] = useState(preferences.filter);

  function handleSortActivate(columnId: string) {
    const next = nextSortState(sort, columnId, columns);
    setSort(next);
    saveFleetSort(next);
  }

  function handleFilterChange(event: ChangeEvent<HTMLInputElement>) {
    const value = event.target.value;
    setFilter(value);
    saveFleetFilter(value);
  }

  if (error !== null) {
    return (
      <section aria-label="Repository fleet" className="flex flex-col gap-3">
        <div
          role="alert"
          className="rounded-md border border-red-500/40 bg-red-950/40 px-4 py-3 text-sm text-red-200"
        >
          <p className="font-medium">Couldn’t load your repositories.</p>
          <p className="mt-1 text-red-300/90">{error}</p>
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="mt-3 inline-flex items-center rounded border border-red-400/50 px-3 py-1 text-sm font-medium text-red-100 hover:bg-red-900/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-300"
            >
              Retry
            </button>
          ) : null}
        </div>
      </section>
    );
  }

  const activeColumn = columns.find((column) => column.id === sort.columnId);
  const visibleRepos = sortRepos(
    filterRepos(repos, filter),
    activeColumn,
    sort.direction,
    getRowData,
  );
  const showSkeleton = loading && visibleRepos.length === 0;
  const isEmpty = !showSkeleton && visibleRepos.length === 0;
  const emptyMessage =
    repos.length === 0
      ? 'No repositories found for this token.'
      : 'No repositories match your filter.';
  const statusMessage = loading
    ? 'Loading repositories…'
    : `${visibleRepos.length} ${visibleRepos.length === 1 ? 'repository' : 'repositories'}`;

  return (
    <section aria-label="Repository fleet" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <div role="search" aria-label="Filter repositories" className="w-full max-w-xs">
          <label htmlFor={filterId} className="sr-only">
            Filter repositories by name
          </label>
          <input
            id={filterId}
            type="search"
            value={filter}
            onChange={handleFilterChange}
            placeholder="Filter repositories…"
            className="w-full rounded-md border border-slate-400 bg-white px-3 py-1.5 text-sm text-slate-900 placeholder:text-slate-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
          />
        </div>
        <p role="status" aria-live="polite" className="text-sm text-slate-600">
          {statusMessage}
        </p>
      </div>

      <div className="overflow-x-auto rounded-md border border-slate-800">
        <table
          className="w-full border-collapse text-left text-sm"
          aria-label="Repository fleet health"
        >
          <thead>
            <tr className="border-b border-slate-800">
              {columns.map((column) => {
                const isActive = sort.columnId === column.id;
                const ariaSort: 'ascending' | 'descending' | 'none' | undefined = column.sortable
                  ? isActive
                    ? sort.direction === 'asc'
                      ? 'ascending'
                      : 'descending'
                    : 'none'
                  : undefined;
                return (
                  <th
                    key={column.id}
                    scope="col"
                    aria-sort={ariaSort}
                    className={cn(
                      'px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-400',
                      alignClass(column),
                    )}
                  >
                    {column.sortable ? (
                      <button
                        type="button"
                        onClick={() => handleSortActivate(column.id)}
                        className="inline-flex items-center gap-1 rounded text-inherit hover:text-slate-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
                      >
                        <span>{column.header}</span>
                        {isActive ? (
                          <span aria-hidden="true">{sort.direction === 'asc' ? '▲' : '▼'}</span>
                        ) : null}
                      </button>
                    ) : (
                      <span>{column.header}</span>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody aria-busy={loading}>
            {showSkeleton ? (
              Array.from({ length: SKELETON_ROWS }, (_, rowIndex) => (
                <tr
                  key={`skeleton-${rowIndex}`}
                  aria-hidden="true"
                  className="border-b border-slate-800/60 last:border-0"
                >
                  {columns.map((column) => (
                    <td key={column.id} className="px-3 py-2.5">
                      <span
                        className="block h-3 animate-pulse rounded bg-slate-700/70"
                        style={{ width: column.isRowHeader ? '14rem' : '2.5rem' }}
                      />
                    </td>
                  ))}
                </tr>
              ))
            ) : isEmpty ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-3 py-10 text-center text-sm text-slate-400"
                >
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              visibleRepos.map((repo) => {
                const data = getRowData(repo);
                return (
                  <tr
                    key={repo.nameWithOwner}
                    className="border-b border-slate-800/60 last:border-0 hover:bg-slate-900/40"
                  >
                    {columns.map((column) => {
                      const content = column.render(repo, data);
                      if (column.isRowHeader) {
                        return (
                          <th
                            key={column.id}
                            scope="row"
                            className={cn(
                              'px-3 py-2 font-normal text-slate-100',
                              alignClass(column),
                            )}
                          >
                            {onRepoActivate ? (
                              <button
                                type="button"
                                onClick={() => onRepoActivate(repo)}
                                aria-label={`View details for ${repo.nameWithOwner}`}
                                className="block w-full text-left rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
                              >
                                {content}
                              </button>
                            ) : (
                              content
                            )}
                          </th>
                        );
                      }
                      return (
                        <td
                          key={column.id}
                          className={cn('px-3 py-2 text-slate-300', alignClass(column))}
                        >
                          {content}
                        </td>
                      );
                    })}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
