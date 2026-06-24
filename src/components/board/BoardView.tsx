/**
 * BoardView — the Stream Deck-style "board" surface for the fleet (T-d4).
 *
 * Where {@link FleetGrid} lays the fleet out as a repo-per-row table, this view
 * paints it as a wall of square keys: one {@link BoardKey} per (repo × signal)
 * pairing, in a responsive CSS grid. Each repo contributes the same six keys in
 * a fixed order (CI · Security · Reviews · Pull requests · Issues · Stale), so a
 * repo's row of keys reads identically across the fleet. The seventh signal,
 * `activity`, is intentionally excluded here — it has no {@link RepoSignalData}
 * slice and needs a separate commit-activity source.
 *
 * It is a drop-in sibling of the other top-level views: it mirrors their shared
 * loading (skeletons), error (alert + retry), and empty states, applies the same
 * `repoFilter` narrowing contract as {@link DashboardView} (`undefined` ⇒ all; a
 * defined Set keeps only repos whose `nameWithOwner` is in it — an empty Set
 * matches nothing), and exposes the same `onRepoActivate(repo)` drill-down hook.
 * The board is a labelled region; each key carries its own accessible name from
 * {@link BoardKey}, so the grid itself stays a plain styled container.
 */
import { useMemo } from 'react';
import type { ReactElement } from 'react';

import type { TileSignalType } from '../../types/dashboard';
import type { GetRowData, Repo } from '../../types/fleet';
import { BoardKey } from './BoardKey';

/**
 * The six signals every repo renders, in fixed left-to-right order. `activity`
 * is deliberately absent (no signal slice — out of scope for the board).
 */
const BOARD_SIGNALS: TileSignalType[] = [
  'ci',
  'security',
  'reviews',
  'pullRequests',
  'issues',
  'stale',
];

/** Placeholder keys shown while the fleet loads (two board rows of six). */
const SKELETON_KEYS = 12;

/**
 * Responsive Stream Deck grid: square keys that flow from two columns on the
 * narrowest viewport up to six on wide ones, so each repo's six keys settle onto
 * a single row at the widest breakpoint.
 */
const GRID_CLASS = 'grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6';

export interface BoardViewProps {
  /** Repositories to render (already adapted by `useRepos`). */
  repos: Repo[];
  /** Resolves the per-repo signal slices for each key. */
  getRowData: GetRowData;
  /** Drill-down hook: when provided, every key becomes an activation button. */
  onRepoActivate?: (repo: Repo) => void;
  /** True while a fetch is in flight (skeletons on first load, busy on reload). */
  loading?: boolean;
  /** Fetch error message; renders an alert + retry instead of the board. */
  error?: string | null;
  /** Retry handler for the error state. */
  onRetry?: () => void;
  /**
   * Active repo-scope selection (`undefined` ⇒ whole fleet). A narrowing filter:
   * when a Set is provided only repos whose `nameWithOwner` is in it are shown
   * (a defined-but-empty Set matches nothing ⇒ the filtered empty state).
   */
  repoFilter?: Set<string>;
}

export function BoardView({
  repos,
  getRowData,
  onRepoActivate,
  loading = false,
  error = null,
  onRetry,
  repoFilter,
}: BoardViewProps): ReactElement {
  // Presentational narrowing: `undefined` keeps the whole fleet; any defined Set
  // keeps only the repos it names (an empty Set matches nothing ⇒ 0 repos).
  const visibleRepos = useMemo(
    () =>
      repoFilter === undefined ? repos : repos.filter((repo) => repoFilter.has(repo.nameWithOwner)),
    [repos, repoFilter],
  );

  if (error !== null) {
    return (
      <section aria-label="Repository board" className="flex flex-col gap-3">
        <div
          role="alert"
          className="rounded-md border border-accent-failure bg-[color-mix(in_srgb,var(--color-failure)_10%,var(--color-surface))] px-4 py-3 text-sm text-accent-failure"
        >
          <p className="font-medium">Couldn’t load your repositories.</p>
          <p className="mt-1 text-accent-failure">{error}</p>
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="mt-3 inline-flex items-center rounded border border-accent-failure px-3 py-1 text-sm font-medium text-accent-failure hover:bg-[color-mix(in_srgb,var(--color-failure)_10%,var(--color-surface))] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-failure"
            >
              Retry
            </button>
          ) : null}
        </div>
      </section>
    );
  }

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
    <section aria-label="Repository board" className="flex flex-col gap-3">
      <p role="status" aria-live="polite" className="text-sm text-text-muted">
        {statusMessage}
      </p>

      {showSkeleton ? (
        <div aria-busy="true" aria-hidden="true" className={GRID_CLASS}>
          {Array.from({ length: SKELETON_KEYS }, (_, index) => (
            <span
              key={`skeleton-${index}`}
              data-part="skeleton"
              className="block aspect-square w-full animate-pulse rounded-2xl border border-border bg-surface motion-reduce:animate-none"
            />
          ))}
        </div>
      ) : isEmpty ? (
        <div className="flex flex-col items-center gap-2 rounded-md border border-border bg-surface px-4 py-10 text-center">
          <p className="text-sm text-text-muted">{emptyMessage}</p>
        </div>
      ) : (
        <div aria-busy={loading} className={GRID_CLASS}>
          {visibleRepos.flatMap((repo) => {
            const data = getRowData(repo);
            return BOARD_SIGNALS.map((signal) => (
              <BoardKey
                key={`${repo.nameWithOwner}:${signal}`}
                repo={repo}
                signal={signal}
                data={data}
                onActivate={onRepoActivate}
              />
            ));
          })}
        </div>
      )}
    </section>
  );
}
