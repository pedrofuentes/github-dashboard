/**
 * FleetMatrix — the dense repos×signals overview (ADR-026). It is the scannable
 * default surface that replaces the free-form tile grid: rows are repositories
 * (worst-first), columns are the seven fleet signals, and every cell reuses the
 * exact same status atom the {@link FleetGrid} table renders, so the matrix and
 * the grid share ONE status vocabulary.
 *
 * Responsibilities owned here: accessible table semantics (`<th scope>`, a
 * named table, a sticky header), worst-first ordering via
 * {@link buildMatrixModel}, an optional drill-down hook (REC-8), collapsible
 * health groups (Broken/Warning/Healthy) with Healthy collapsed by default,
 * and the loading / empty / error states mirrored from {@link FleetGrid}.
 * The per-signal presentation lives entirely in the reused cell components —
 * this file never invents signal semantics.
 *
 * The `activity` signal has no slice on {@link RepoSignalData} (it self-fetches),
 * so its cell reuses the Dashboard's {@link ActivityTileBody} at the `compact`
 * tier, keeping the matrix consistent with the activity tile rather than
 * inventing a new activity vocabulary.
 */
import { memo, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import * as React from 'react';

import { useDensity } from '../hooks/useDensity';
import { SIGNAL_LABELS } from '../lib/grid-keyboard';
import { buildMatrixModel } from '../lib/matrix-model';
import type { RepoHealth } from '../lib/fleet-summary';
import type { TileSignalType } from '../types/dashboard';
import type { GetRowData, Repo, RepoSignalData } from '../types/fleet';
import { CiCell } from './columns/CiCell';
import { IssuesCell } from './columns/IssuesCell';
import { PullRequestsCell } from './columns/PullRequestsCell';
import { RepoCell } from './columns/RepoCell';
import { ReviewsCell } from './columns/ReviewsCell';
import { SecurityCell } from './columns/SecurityCell';
import { StaleCell } from './columns/StaleCell';
import { ActivityTileBody } from './tiles/bodies/ActivityTileBody';

const SKELETON_ROWS = 6;

/** Human-readable labels for health bands. */
const HEALTH_LABELS: Record<RepoHealth, string> = {
  broken: 'Broken',
  warning: 'Warning',
  healthy: 'Healthy',
};

interface FleetMatrixProps {
  /** Repositories to render (already adapted by `useRepos`). */
  repos: Repo[];
  /** Resolves per-repo signal data (same contract as the grid). */
  getRowData: GetRowData;
  /** Drill-down hook (REC-8): when provided, each row anchor becomes a button. */
  onRepoActivate?: (repo: Repo) => void;
  /** True while a fetch is in flight (skeletons on first load, busy on reload). */
  loading?: boolean;
  /** Fetch error message; renders an alert + retry instead of the table. */
  error?: string | null;
  /** Retry handler for the error state. */
  onRetry?: () => void;
}

/**
 * Renders the cell body for a single (repo, signal) pair by delegating to the
 * existing per-signal atom, so the matrix and grid share one status vocabulary.
 * The six data-backed signals read their slice from `data`; `activity` has no
 * slice and reuses the self-fetching {@link ActivityTileBody}.
 */
function renderSignalCell(signal: TileSignalType, repo: Repo, data: RepoSignalData): ReactNode {
  switch (signal) {
    case 'ci':
      return <CiCell slice={data.ci} />;
    case 'security':
      return <SecurityCell slice={data.security} />;
    case 'reviews':
      return <ReviewsCell slice={data.reviews} />;
    case 'pullRequests':
      return <PullRequestsCell slice={data.pullRequests} />;
    case 'issues':
      return <IssuesCell slice={data.issues} />;
    case 'stale':
      return <StaleCell slice={data.stale} />;
    case 'activity':
      return <ActivityTileBody repo={repo} size="compact" />;
  }
}

interface GroupHeaderProps {
  health: RepoHealth;
  count: number;
  isExpanded: boolean;
  onToggle: () => void;
  columnCount: number;
}

/**
 * A collapsible group header row for a health band. The entire row contains
 * a single cell spanning all columns with an accessible toggle button.
 */
function GroupHeader({ health, count, isExpanded, onToggle, columnCount }: GroupHeaderProps) {
  const label = HEALTH_LABELS[health];

  return (
    <tr className="border-b border-border bg-surface-raised">
      <td colSpan={columnCount} className="px-3 py-2">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={isExpanded}
          className="flex w-full items-center gap-2 rounded text-left text-sm font-medium text-text hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          <svg
            className="h-4 w-4 transition-transform motion-reduce:transition-none"
            style={{ transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          <span>
            {label} · {count}
          </span>
        </button>
      </td>
    </tr>
  );
}

interface MatrixRowProps {
  repo: Repo;
  signals: readonly TileSignalType[];
  getRowData: GetRowData;
  onRepoActivate?: (repo: Repo) => void;
  cellPaddingY: string;
}

/**
 * A single repo row, memoised so unrelated parent state (e.g. opening the
 * drill-down drawer) does not re-render every row. Like {@link FleetGrid}'s row,
 * it receives the stable `getRowData` function — not its result — so its props
 * stay shallow-equal across re-renders when nothing changed.
 */
const MatrixRow = memo(function MatrixRow({
  repo,
  signals,
  getRowData,
  onRepoActivate,
  cellPaddingY,
}: MatrixRowProps) {
  const data = getRowData(repo);
  return (
    <tr className="border-b border-border last:border-0 hover:bg-surface-hover">
      <th
        scope="row"
        className={`px-3 ${cellPaddingY} text-left align-middle font-normal text-text`}
      >
        {onRepoActivate ? (
          <button
            type="button"
            onClick={() => onRepoActivate(repo)}
            aria-label={`View details for ${repo.nameWithOwner}`}
            className="block w-full text-left rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            <RepoCell repo={repo} />
          </button>
        ) : (
          <RepoCell repo={repo} />
        )}
      </th>
      {signals.map((signal) => (
        <td
          key={signal}
          className={`px-3 ${cellPaddingY} text-center align-middle text-text-muted`}
        >
          {renderSignalCell(signal, repo, data)}
        </td>
      ))}
    </tr>
  );
});

export function FleetMatrix({
  repos,
  getRowData,
  onRepoActivate,
  loading = false,
  error = null,
  onRetry,
}: FleetMatrixProps) {
  const { density } = useDensity();
  const model = useMemo(() => buildMatrixModel(repos, getRowData), [repos, getRowData]);
  const { groups, signals, rows } = model;

  // Track which health bands are collapsed (Healthy collapsed by default)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<RepoHealth>>(
    () => new Set(['healthy']),
  );

  const toggleGroup = (health: RepoHealth) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(health)) {
        next.delete(health);
      } else {
        next.add(health);
      }
      return next;
    });
  };

  if (error !== null) {
    return (
      <section aria-label="Fleet matrix" className="flex flex-col gap-3">
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

  const showSkeleton = loading && rows.length === 0;
  const isEmpty = !showSkeleton && rows.length === 0;
  const totalColumns = signals.length + 1;
  const statusMessage = loading
    ? 'Loading repositories…'
    : `${rows.length} ${rows.length === 1 ? 'repository' : 'repositories'}`;

  // Map density to vertical cell padding (glanceable = tighter, balanced = current)
  const cellPaddingY = density === 'glanceable' ? 'py-1' : 'py-2';
  const skeletonPaddingY = density === 'glanceable' ? 'py-1.5' : 'py-2.5';

  return (
    <section aria-label="Fleet matrix" className="flex flex-col gap-3">
      <p role="status" aria-live="polite" className="text-sm text-text-muted">
        {statusMessage}
      </p>

      <div className="overflow-auto rounded-md border border-border">
        <table
          className="w-full border-collapse text-left text-sm"
          aria-label="Fleet matrix: repositories by signal"
        >
          <thead>
            <tr className="border-b border-border">
              <th
                scope="col"
                className="sticky top-0 z-10 bg-surface px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-text-muted"
              >
                Repository
              </th>
              {signals.map((signal) => (
                <th
                  key={signal}
                  scope="col"
                  className="sticky top-0 z-10 bg-surface px-3 py-2 text-center text-xs font-semibold uppercase tracking-wide text-text-muted"
                >
                  {SIGNAL_LABELS[signal]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody aria-busy={loading}>
            {showSkeleton ? (
              Array.from({ length: SKELETON_ROWS }, (_, rowIndex) => (
                <tr
                  key={`skeleton-${rowIndex}`}
                  aria-hidden="true"
                  className="border-b border-border last:border-0"
                >
                  {Array.from({ length: totalColumns }, (_, colIndex) => (
                    <td key={colIndex} className={`px-3 ${skeletonPaddingY}`}>
                      <span
                        className="block h-3 animate-pulse rounded bg-border motion-reduce:animate-none"
                        style={{ width: colIndex === 0 ? '14rem' : '2.5rem' }}
                      />
                    </td>
                  ))}
                </tr>
              ))
            ) : isEmpty ? (
              <tr>
                <td
                  colSpan={totalColumns}
                  className="px-3 py-10 text-center text-sm text-text-muted"
                >
                  No repositories found for this token.
                </td>
              </tr>
            ) : (
              groups.map(({ health, rows: groupRows }) => {
                const isExpanded = !collapsedGroups.has(health);
                return (
                  <React.Fragment key={health}>
                    <GroupHeader
                      health={health}
                      count={groupRows.length}
                      isExpanded={isExpanded}
                      onToggle={() => toggleGroup(health)}
                      columnCount={totalColumns}
                    />
                    {isExpanded &&
                      groupRows.map(({ repo }) => (
                        <MatrixRow
                          key={repo.nameWithOwner}
                          repo={repo}
                          signals={signals}
                          getRowData={getRowData}
                          onRepoActivate={onRepoActivate}
                          cellPaddingY={cellPaddingY}
                        />
                      ))}
                  </React.Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
