/**
 * SignalTile — one (repo, signal) tile for the at-a-glance Dashboard view (M10).
 *
 * The tile is a glanceable card that reuses the existing per-signal `*Cell`
 * atoms (so the icon + colour + text encoding stays in one place and remains
 * WCAG-AA, never colour alone). A left accent band reflects the slice's data
 * lifecycle status (loading / error / unknown / ready) as a redundant, non-colour
 * cue alongside `data-status`. The whole card is keyboard-activatable via an
 * overlay button (button semantics, Enter/Space, the sky-600 focus ring) that
 * calls `onActivate` to open the shared drill-down drawer; the overlay avoids
 * nesting interactive cell content inside a button.
 */
import type { ReactElement } from 'react';

import { cn } from '../lib/cn';
import type { DashboardTile, TileSignalType } from '../types/dashboard';
import type { Repo, RepoSignalData, SignalSlice, SignalStatus } from '../types/fleet';
import { CiCell } from './columns/CiCell';
import { IssuesCell } from './columns/IssuesCell';
import { PullRequestsCell } from './columns/PullRequestsCell';
import { ReviewsCell } from './columns/ReviewsCell';
import { SecurityCell } from './columns/SecurityCell';
import { StaleCell } from './columns/StaleCell';

export interface SignalTileProps {
  /** The (repo, signal) tile to render. */
  tile: DashboardTile;
  /** The repo this tile belongs to (passed to `onActivate`). */
  repo: Repo;
  /** The repo's aggregated signal slices (from `getRowData`). */
  data: RepoSignalData;
  /** Opens the drill-down for the tile's repo. */
  onActivate: (repo: Repo) => void;
}

/** Short, human-readable label for each signal. */
const SIGNAL_LABELS: Record<TileSignalType, string> = {
  ci: 'CI',
  security: 'Security',
  reviews: 'Reviews',
  pullRequests: 'Pull requests',
  issues: 'Issues',
  stale: 'Stale',
};

/** Left-accent colour per data lifecycle status (paired with `data-status`). */
const STATUS_ACCENT: Record<SignalStatus, string> = {
  loading: 'border-l-slate-300',
  error: 'border-l-red-500',
  unknown: 'border-l-slate-300',
  ready: 'border-l-sky-500',
};

/** Renders the matching signal cell, reusing the grid's presentational atoms. */
function SignalSummary({
  signal,
  data,
}: {
  signal: TileSignalType;
  data: RepoSignalData;
}): ReactElement {
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
  }
}

export function SignalTile({ tile, repo, data, onActivate }: SignalTileProps): ReactElement {
  const slice: SignalSlice | undefined = data[tile.signal];
  const status: SignalStatus = slice?.status ?? 'unknown';
  const signalLabel = SIGNAL_LABELS[tile.signal];

  return (
    <article
      data-status={status}
      className={cn(
        'relative flex h-full flex-col gap-2 overflow-hidden rounded-md border border-l-4 border-slate-200 bg-white p-4 shadow-sm',
        STATUS_ACCENT[status],
      )}
    >
      <header className="relative z-10 flex items-baseline justify-between gap-2">
        <h3 className="truncate text-sm font-semibold text-slate-900" title={repo.nameWithOwner}>
          {repo.nameWithOwner}
        </h3>
        <span className="shrink-0 text-xs font-medium uppercase tracking-wide text-slate-500">
          {signalLabel}
        </span>
      </header>
      <div className="relative z-10 text-sm text-slate-700">
        <SignalSummary signal={tile.signal} data={data} />
      </div>
      <button
        type="button"
        onClick={() => onActivate(repo)}
        aria-label={`View ${signalLabel} details for ${repo.nameWithOwner}`}
        className="absolute inset-0 rounded-md focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
      />
    </article>
  );
}
