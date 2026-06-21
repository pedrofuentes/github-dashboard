/**
 * SignalTile — one (repo, signal) tile for the at-a-glance Dashboard view (M10).
 *
 * The tile renders through the shared {@link TileFrame} shell (DESIGN-TILES §3):
 * a top accent bar reflecting the slice's data lifecycle status, a header, the
 * per-signal body, and the cross-cutting grid machinery (the `data-status`
 * attribute, roving tabindex, the whole-tile activate overlay, and the
 * edit-mode Move/Resize controls). For now the body reuses the existing
 * per-signal `*Cell` atoms via {@link SignalSummary}; the bespoke per-signal
 * bodies replace it in later tile tasks (DESIGN-TILES §6).
 *
 * The accent moved from the old left band to the frame's top bar: the slice
 * lifecycle status maps to a `SignalIconKind` and then, via `iconKindTone`, to
 * the {@link AccentTone} the bar + status dot paint — always paired with the
 * redundant `data-status` attribute and the body's own text/glyph encoding.
 */
import type { ReactElement } from 'react';

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
import { TileFrame } from './tiles/TileFrame';
import type { AccentTone, SignalIconKind } from './tiles/types';
import { iconKindTone } from './tiles/types';
import { useTileSize } from './tiles/useTileSize';

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

/**
 * Map the data lifecycle status to the status glyph kind whose tone the accent
 * bar paints (DESIGN-TILES §3.6). The per-signal escalation accents (§1.4) land
 * with the bespoke bodies; for now the frame reflects the lifecycle state.
 */
const STATUS_ICON_KIND: Record<SignalStatus, SignalIconKind> = {
  loading: 'loading',
  error: 'failure',
  unknown: 'unknown',
  ready: 'info',
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
  const tone: AccentTone = iconKindTone(STATUS_ICON_KIND[status]);

  // The frame measures its own box to pick a density tier (DESIGN-TILES §3.4).
  const { ref, tier } = useTileSize<HTMLElement>();

  return (
    <TileFrame
      containerRef={ref}
      repo={repo}
      signalLabel={signalLabel}
      tone={tone}
      status={status}
      size={tier}
      tileId={tile.i}
      onActivate={() => onActivate(repo)}
      active={active}
      editing={editing}
      onTileFocus={onTileFocus}
      onMove={onMove}
      onResize={onResize}
      colIndex={colIndex}
      rowIndex={rowIndex}
    >
      <SignalSummary signal={tile.signal} data={data} />
    </TileFrame>
  );
}
