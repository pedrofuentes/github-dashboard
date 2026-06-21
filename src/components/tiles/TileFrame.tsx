/**
 * TileFrame — the shared shell every (repo, signal) dashboard tile renders
 * through (DESIGN-TILES §3, §5). It scales the Stream Deck key anatomy to a
 * resizable grid card: a top accent bar → header (repo + signal label + status
 * dot) → signal-specific body slot → optional footer, all wrapped in the
 * keyboard/a11y machinery the grid relies on.
 *
 * The frame owns the cross-cutting tile behavior so per-signal tiles only supply
 * a `tone`, a `status`, and a body: the `data-status` attribute, the WAI-ARIA
 * grid cell semantics (`aria-colindex`/`aria-rowindex`), the roving tab stop,
 * the whole-tile activate overlay button (button semantics, Enter/Space, the
 * sky-600 focus ring), and the edit-mode Move/Resize control rail.
 */
import type { ReactElement, ReactNode, RefObject } from 'react';

import type { MoveDirection, ResizeDimension } from '../../lib/grid-keyboard';
import type { Repo, SignalStatus } from '../../types/fleet';
import { AccentBar } from './AccentBar';
import { StatusDot } from './StatusDot';
import type { AccentTone, TileTier } from './types';

export interface TileFrameProps {
  /** The repo this tile belongs to (drives the header + accessible names). */
  repo: Repo;
  /** Human-readable signal label, e.g. `CI` (`SIGNAL_LABELS[signal]`). */
  signalLabel: string;
  /** Resolved status/identity accent (DESIGN-TILES §1.4) for the bar + dot. */
  tone: AccentTone;
  /** Data lifecycle status, surfaced as `data-status` for tests + the grid. */
  status: SignalStatus;
  /** Density tier the frame renders at (DESIGN-TILES §3.4). */
  size: TileTier;
  /** Stable tile id (`${repo}:${signal}`) for activate + control wiring. */
  tileId: string;
  /** Opens the drill-down for the tile. */
  onActivate: () => void;
  /**
   * Whether this tile is the grid's single roving tab stop. When false the
   * tile's controls leave the tab order (`tabindex="-1"`); arrow keys on the
   * active tile move the roving focus. Standalone tiles default to active.
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
  /** 1-based grid column, surfaced as `aria-colindex` (SC 1.3.1). */
  colIndex?: number;
  /** 1-based grid row, surfaced as `aria-rowindex`. */
  rowIndex?: number;
  /** Optional ref attached to the tile `<article>` (e.g. for `useTileSize`). */
  containerRef?: RefObject<HTMLElement>;
  /** Optional footer (meta / last-updated · deep link). Hidden when compact. */
  footer?: ReactNode;
  /** The signal-specific body content. */
  children: ReactNode;
}

export function TileFrame({
  repo,
  signalLabel,
  tone,
  status,
  size,
  tileId,
  onActivate,
  active = true,
  editing = false,
  onTileFocus,
  onMove,
  onResize,
  colIndex,
  rowIndex,
  containerRef,
  footer,
  children,
}: TileFrameProps): ReactElement {
  const tileName = `${signalLabel} · ${repo.nameWithOwner}`;

  // Roving tabindex: only the grid's active tile is in the tab order; the rest
  // are reachable via the arrow keys handled by the grid (WAI-ARIA grid pattern).
  const rovingTabIndex = active ? 0 : -1;

  // Compact keys drop the footer first (DESIGN-TILES §3.4) — the body's value
  // and status word are the last things to go.
  const showFooter = footer != null && size !== 'compact';

  return (
    <article
      ref={containerRef}
      role="gridcell"
      data-status={status}
      data-tile-size={size}
      aria-colindex={colIndex}
      aria-rowindex={rowIndex}
      className="relative flex h-full flex-col overflow-hidden rounded-md border border-border bg-surface shadow-sm"
    >
      <AccentBar tone={tone} />
      <div className="relative z-10 flex min-h-0 flex-1 flex-col gap-2 p-4">
        <header className="flex items-baseline justify-between gap-2">
          <h3 className="truncate text-sm font-semibold text-text" title={repo.nameWithOwner}>
            {repo.nameWithOwner}
          </h3>
          <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-text-muted">
            {signalLabel}
            <StatusDot tone={tone} />
          </span>
        </header>
        <div className="min-h-0 flex-1 text-sm text-text">{children}</div>
        {showFooter ? <footer className="text-xs text-text-muted">{footer}</footer> : null}
        {editing ? (
          // In edit mode the active tile exposes ~9 tabIndex=0 targets (activate
          // button + 8 Move/Resize controls). This is intentional WCAG-AA design,
          // not a roving-tabindex bug: each control is a distinct keyboard
          // affordance reachable via Tab within the tile. When the tile is
          // inactive (rovingTabIndex === -1) all controls leave the tab order,
          // leaving the grid's single roving tab stop intact.
          <TileControls
            tileId={tileId}
            tileName={tileName}
            tabIndex={rovingTabIndex}
            onMove={onMove}
            onResize={onResize}
          />
        ) : null}
      </div>
      <button
        type="button"
        data-tile-activate={tileId}
        tabIndex={rovingTabIndex}
        onClick={onActivate}
        onFocus={() => onTileFocus?.(tileId)}
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
      className="dashboard-tile-control inline-flex h-7 min-w-7 items-center justify-center rounded border border-border-strong bg-surface px-1.5 text-xs font-medium text-text hover:bg-surface-raised focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
    >
      <span aria-hidden="true">{children}</span>
    </button>
  );
}
