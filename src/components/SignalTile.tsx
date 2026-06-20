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
import { SIGNAL_LABELS } from '../lib/grid-keyboard';
import type { MoveDirection, ResizeDimension } from '../lib/grid-keyboard';
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
  /**
   * Whether this tile is the grid's single roving tab stop. When false the
   * tile's controls are removed from the tab order (`tabindex="-1"`); arrow keys
   * on the active tile move the roving focus (see {@link DashboardView}). Tiles
   * rendered standalone default to active so they stay keyboard-reachable.
   */
  active?: boolean;
  /** When true, render the keyboard Move/Resize controls (edit mode). */
  editing?: boolean;
  /** Notifies the grid which tile took focus, so it can track the tab stop. */
  onTileFocus?: (tileId: string) => void;
  /** Moves this tile by one grid unit (keyboard reorder). */
  onMove?: (tileId: string, direction: MoveDirection) => void;
  /** Grows/shrinks this tile by one unit on a dimension (keyboard resize). */
  onResize?: (tileId: string, dimension: ResizeDimension, delta: number) => void;
  /**
   * 1-based grid column this tile occupies, surfaced as `aria-colindex` so the
   * cell is announced at its true position (SC 1.3.1) instead of always
   * "column 1". Omitted for standalone tiles outside a grid.
   */
  colIndex?: number;
  /** 1-based grid row this tile occupies, surfaced as `aria-rowindex`. */
  rowIndex?: number;
}

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

export function SignalTile({
  tile,
  repo,
  data,
  onActivate,
  active = true,
  editing = false,
  onTileFocus,
  onMove,
  onResize,
  colIndex,
  rowIndex,
}: SignalTileProps): ReactElement {
  const slice: SignalSlice | undefined = data[tile.signal];
  const status: SignalStatus = slice?.status ?? 'unknown';
  const signalLabel = SIGNAL_LABELS[tile.signal];
  const tileName = `${signalLabel} · ${repo.nameWithOwner}`;

  // Roving tabindex: only the grid's active tile is in the tab order; the rest
  // are reachable via the arrow keys handled by the grid (WAI-ARIA grid pattern).
  const rovingTabIndex = active ? 0 : -1;

  return (
    <article
      role="gridcell"
      data-status={status}
      aria-colindex={colIndex}
      aria-rowindex={rowIndex}
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
      {editing ? (
        // In edit mode the active tile exposes ~9 tabIndex=0 targets (activate
        // button + 8 Move/Resize controls). This is intentional WCAG-AA design,
        // not a roving-tabindex bug: each control is a distinct keyboard
        // affordance that needs to be reachable via Tab within the tile. When
        // the tile is inactive (rovingTabIndex === -1) all controls are removed
        // from the tab order, leaving the grid's single roving tab stop intact.
        <TileControls
          tileId={tile.i}
          tileName={tileName}
          tabIndex={rovingTabIndex}
          onMove={onMove}
          onResize={onResize}
        />
      ) : null}
      <button
        type="button"
        data-tile-activate={tile.i}
        tabIndex={rovingTabIndex}
        onClick={() => onActivate(repo)}
        onFocus={() => onTileFocus?.(tile.i)}
        aria-label={`View ${signalLabel} details for ${repo.nameWithOwner}`}
        className="absolute inset-0 rounded-md focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
      />
    </article>
  );
}

interface TileControlsProps {
  tileId: string;
  tileName: string;
  tabIndex: number;
  onMove?: (tileId: string, direction: MoveDirection) => void;
  onResize?: (tileId: string, dimension: ResizeDimension, delta: number) => void;
}

/** Per-tile Move/Resize affordance — the keyboard equivalent of pointer drag. */
function TileControls({
  tileId,
  tileName,
  tabIndex,
  onMove,
  onResize,
}: TileControlsProps): ReactElement {
  return (
    <div
      role="group"
      aria-label={`Reorder and resize ${tileName}`}
      className="relative z-20 mt-auto flex flex-wrap gap-1 pt-2"
    >
      <ControlButton
        label={`Move ${tileName} left`}
        tabIndex={tabIndex}
        onClick={() => onMove?.(tileId, 'left')}
      >
        ←
      </ControlButton>
      <ControlButton
        label={`Move ${tileName} right`}
        tabIndex={tabIndex}
        onClick={() => onMove?.(tileId, 'right')}
      >
        →
      </ControlButton>
      <ControlButton
        label={`Move ${tileName} up`}
        tabIndex={tabIndex}
        onClick={() => onMove?.(tileId, 'up')}
      >
        ↑
      </ControlButton>
      <ControlButton
        label={`Move ${tileName} down`}
        tabIndex={tabIndex}
        onClick={() => onMove?.(tileId, 'down')}
      >
        ↓
      </ControlButton>
      <ControlButton
        label={`Grow ${tileName} width`}
        tabIndex={tabIndex}
        onClick={() => onResize?.(tileId, 'width', 1)}
      >
        +W
      </ControlButton>
      <ControlButton
        label={`Shrink ${tileName} width`}
        tabIndex={tabIndex}
        onClick={() => onResize?.(tileId, 'width', -1)}
      >
        −W
      </ControlButton>
      <ControlButton
        label={`Grow ${tileName} height`}
        tabIndex={tabIndex}
        onClick={() => onResize?.(tileId, 'height', 1)}
      >
        +H
      </ControlButton>
      <ControlButton
        label={`Shrink ${tileName} height`}
        tabIndex={tabIndex}
        onClick={() => onResize?.(tileId, 'height', -1)}
      >
        −H
      </ControlButton>
    </div>
  );
}

interface ControlButtonProps {
  label: string;
  tabIndex: number;
  onClick: () => void;
  children: string;
}

function ControlButton({ label, tabIndex, onClick, children }: ControlButtonProps): ReactElement {
  return (
    <button
      type="button"
      aria-label={label}
      tabIndex={tabIndex}
      onClick={onClick}
      className="dashboard-tile-control inline-flex h-7 min-w-7 items-center justify-center rounded border border-slate-300 bg-white px-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700"
    >
      <span aria-hidden="true">{children}</span>
    </button>
  );
}
