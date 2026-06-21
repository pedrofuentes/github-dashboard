/**
 * SignalTile — one (repo, signal) tile for the at-a-glance Dashboard view (M10).
 *
 * The tile renders through the shared {@link TileFrame} shell (DESIGN-TILES §3):
 * a top accent bar reflecting the slice's data lifecycle status, a header, the
 * per-signal body, and the cross-cutting grid machinery (the `data-status`
 * attribute, roving tabindex, the whole-tile activate overlay, and the
 * edit-mode Move/Resize controls). The body dispatches to the bespoke
 * per-signal bodies in {@link SignalBody} (DESIGN-TILES §4, §6); the table view
 * keeps the compact `*Cell` atoms.
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
import { CiTileBody } from './tiles/bodies/CiTileBody';
import { ActivityTileBody } from './tiles/bodies/ActivityTileBody';
import { IssuesTileBody } from './tiles/bodies/IssuesTileBody';
import { PrsTileBody } from './tiles/bodies/PrsTileBody';
import { ReviewsTileBody } from './tiles/bodies/ReviewsTileBody';
import { SecurityTileBody } from './tiles/bodies/SecurityTileBody';
import { StaleTileBody } from './tiles/bodies/StaleTileBody';
import { TileFrame } from './tiles/TileFrame';
import type { AccentTone, SignalIconKind, TileTier } from './tiles/types';
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

/**
 * Frame accent for the Activity tile. Activity has no lifecycle slice in
 * {@link RepoSignalData} — the {@link ActivityTileBody} owns its own load states
 * — so the frame shows a stable identity rather than a data-driven status: a
 * `ready`-equivalent status and the `success` accent that matches the body's
 * activity ink (DESIGN-TILES §4.7).
 */
const ACTIVITY_STATUS: SignalStatus = 'ready';
const ACTIVITY_TONE: AccentTone = 'success';

/** Renders the matching bespoke per-signal body (DESIGN-TILES §4, §6). */
function SignalBody({
  signal,
  repo,
  data,
  size,
}: {
  signal: TileSignalType;
  repo: Repo;
  data: RepoSignalData;
  size: TileTier;
}): ReactElement {
  switch (signal) {
    case 'ci':
      return <CiTileBody repo={repo} data={data} size={size} />;
    case 'security':
      return <SecurityTileBody repo={repo} data={data} size={size} />;
    case 'pullRequests':
      return <PrsTileBody repo={repo} data={data} size={size} />;
    case 'reviews':
      return <ReviewsTileBody repo={repo} data={data} size={size} />;
    case 'issues':
      return <IssuesTileBody repo={repo} data={data} size={size} />;
    case 'stale':
      return <StaleTileBody repo={repo} data={data} size={size} />;
    case 'activity':
      // Activity self-fetches its own commit history via `useCommitActivity`
      // (no `RepoSignalData` slice), so it takes only `{ repo, size }`. The fetch
      // is lazy on-mount and one-shot — consistent with the per-repo signal
      // fetching and deliberately un-polled. Successor note: for very large
      // fleets a future on-view IntersectionObserver could defer the fetch until
      // the tile scrolls into view (out of scope here).
      return <ActivityTileBody repo={repo} size={size} />;
    default:
      // The switch is exhaustive over `TileSignalType`; this guards a malformed
      // runtime signal so the tile degrades to a neutral, labelled state rather
      // than throwing or rendering blank (DESIGN-TILES §3.6).
      return <span className="text-sm text-text-muted">Unknown signal</span>;
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
  const isActivity = tile.signal === 'activity';
  // Narrow inline (not via `isActivity`) so `data[...]` is keyed by a non-activity
  // signal — `RepoSignalData` has no `activity` slice; the body self-fetches.
  const slice: SignalSlice | undefined = tile.signal === 'activity' ? undefined : data[tile.signal];
  const status: SignalStatus = isActivity ? ACTIVITY_STATUS : (slice?.status ?? 'unknown');
  const signalLabel = SIGNAL_LABELS[tile.signal];
  const tone: AccentTone = isActivity ? ACTIVITY_TONE : iconKindTone(STATUS_ICON_KIND[status]);

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
      <SignalBody signal={tile.signal} repo={repo} data={data} size={tier} />
    </TileFrame>
  );
}
