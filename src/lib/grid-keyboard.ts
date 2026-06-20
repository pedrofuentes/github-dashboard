/**
 * Pure helpers for keyboard-accessible reorder/resize of the at-a-glance
 * Dashboard grid (M10 T4 — the WCAG 2.1 AA equivalent of T3's pointer drag).
 *
 * These functions are deliberately free of React/DOM so the geometry math
 * (clamping a tile inside the 12-column grid), the 2-D spatial focus navigation,
 * and the live-region announcement strings can be unit-tested in isolation; the
 * `DashboardView` component just wires them to `useDashboardLayout.setLayout` and
 * an `aria-live` region.
 */
import type { TileSignalType } from '../types/dashboard';

/** A keyboard move of the focused tile by one grid unit. */
export type MoveDirection = 'left' | 'right' | 'up' | 'down';

/** Which side of a tile a keyboard resize grows or shrinks. */
export type ResizeDimension = 'width' | 'height';

/** The geometry fields a move/resize operates on (a subset of a tile). */
export interface CellGeometry {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A tile's geometry plus its stable id, for spatial navigation. */
export interface CellPosition extends CellGeometry {
  i: string;
}

/** Smallest allowed tile size in grid units. */
const MIN_SIZE = 1;

/** Human-readable label per signal — shared by the tile UI and announcements. */
export const SIGNAL_LABELS: Record<TileSignalType, string> = {
  ci: 'CI',
  security: 'Security',
  reviews: 'Reviews',
  pullRequests: 'Pull requests',
  issues: 'Issues',
  stale: 'Stale',
};

/**
 * Moves a cell by one grid unit in `direction`, clamped to stay inside the grid:
 * never past the left/top edge and never past the right edge (`x + w <= cols`).
 * Downward movement is uncapped — the grid grows vertically.
 */
export function moveCell(cell: CellGeometry, direction: MoveDirection, cols: number): CellGeometry {
  switch (direction) {
    case 'left':
      return { ...cell, x: Math.max(0, cell.x - 1) };
    case 'right':
      return { ...cell, x: Math.min(Math.max(0, cols - cell.w), cell.x + 1) };
    case 'up':
      return { ...cell, y: Math.max(0, cell.y - 1) };
    case 'down':
      return { ...cell, y: cell.y + 1 };
  }
}

/**
 * Grows (`delta > 0`) or shrinks (`delta < 0`) a cell by one unit on the given
 * dimension. Width is clamped to at least one unit and at most the space left to
 * the grid's right edge (`cols - x`); height is clamped to at least one unit.
 */
export function resizeCell(
  cell: CellGeometry,
  dimension: ResizeDimension,
  delta: number,
  cols: number,
): CellGeometry {
  if (dimension === 'width') {
    const maxWidth = Math.max(MIN_SIZE, cols - cell.x);
    const w = Math.min(maxWidth, Math.max(MIN_SIZE, cell.w + delta));
    return { ...cell, w };
  }
  const h = Math.max(MIN_SIZE, cell.h + delta);
  return { ...cell, h };
}

interface Center {
  cx: number;
  cy: number;
}

function center(cell: CellGeometry): Center {
  return { cx: cell.x + cell.w / 2, cy: cell.y + cell.h / 2 };
}

/**
 * Finds the id of the nearest tile in `direction` from `currentId`, comparing
 * tile centres. Candidates must lie in the requested half-plane; ties prefer the
 * tile that is most aligned on the perpendicular axis (so ArrowRight from a tile
 * lands on the one directly to its right rather than a distant diagonal one).
 * Returns `null` when there is no tile in that direction.
 */
export function findNeighbor(
  cells: CellPosition[],
  currentId: string,
  direction: MoveDirection,
): string | null {
  const current = cells.find((cell) => cell.i === currentId);
  if (current === undefined) {
    return null;
  }
  const origin = center(current);

  let best: string | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const cell of cells) {
    if (cell.i === currentId) {
      continue;
    }
    const point = center(cell);
    const dx = point.cx - origin.cx;
    const dy = point.cy - origin.cy;

    let primary: number;
    let secondary: number;
    switch (direction) {
      case 'right':
        if (dx <= 0) continue;
        primary = dx;
        secondary = Math.abs(dy);
        break;
      case 'left':
        if (dx >= 0) continue;
        primary = -dx;
        secondary = Math.abs(dy);
        break;
      case 'down':
        if (dy <= 0) continue;
        primary = dy;
        secondary = Math.abs(dx);
        break;
      case 'up':
        if (dy >= 0) continue;
        primary = -dy;
        secondary = Math.abs(dx);
        break;
    }

    // Weight perpendicular drift so aligned neighbours win over diagonal ones.
    const score = primary + secondary * 2;
    if (score < bestScore) {
      bestScore = score;
      best = cell.i;
    }
  }

  return best;
}

/** Maps an `ArrowLeft/Right/Up/Down` key to a {@link MoveDirection}, else null. */
export function arrowDirection(key: string): MoveDirection | null {
  switch (key) {
    case 'ArrowLeft':
      return 'left';
    case 'ArrowRight':
      return 'right';
    case 'ArrowUp':
      return 'up';
    case 'ArrowDown':
      return 'down';
    default:
      return null;
  }
}

/** Builds the polite-announcement string for a keyboard move (1-indexed). */
export function formatMoveAnnouncement(label: string, repo: string, x: number, y: number): string {
  return `Moved ${label} · ${repo} to column ${x + 1}, row ${y + 1}`;
}

/** Builds the polite-announcement string for a keyboard resize. */
export function formatResizeAnnouncement(
  label: string,
  repo: string,
  w: number,
  h: number,
): string {
  return `Resized ${label} · ${repo} to ${w} by ${h}`;
}
