/**
 * Merges react-grid-layout pointer-edit geometry back onto the dashboard tile
 * model (M10 T3). react-grid-layout's `onLayoutChange` reports only the grid
 * geometry (`i`/`x`/`y`/`w`/`h`); this reattaches it to the richer
 * {@link DashboardTile} records the app persists, leaving non-geometry fields
 * (signal, repo, visible) untouched. Lives in its own module (not
 * `dashboard-layout.ts`, whose public API is frozen) so the React component file
 * stays component-only for fast-refresh.
 */
import type { Layout } from 'react-grid-layout';

import type { DashboardTile } from '../types/dashboard';

/**
 * Writes the geometry from a react-grid-layout `Layout` back onto matching
 * tiles, preserving every non-geometry field and any tile with no corresponding
 * grid item (e.g. hidden tiles, which never enter the grid). Tiles whose
 * geometry is unchanged keep their original reference so callers can cheaply
 * detect a no-op change (e.g. the onLayoutChange react-grid-layout fires on
 * mount or on a responsive breakpoint switch).
 */
export function mergeLayoutGeometry(tiles: DashboardTile[], layout: Layout): DashboardTile[] {
  const geometry = new Map(layout.map((item) => [item.i, item]));
  return tiles.map((tile) => {
    const next = geometry.get(tile.i);
    if (next === undefined) {
      return tile;
    }
    if (next.x === tile.x && next.y === tile.y && next.w === tile.w && next.h === tile.h) {
      return tile;
    }
    return { ...tile, x: next.x, y: next.y, w: next.w, h: next.h };
  });
}
