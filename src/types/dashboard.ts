/**
 * Shared types for the at-a-glance Dashboard view (M10).
 *
 * Like `src/types/fleet.ts`, this module is intentionally free of runtime
 * values so it emits no JS — behavior belongs in `src/lib/dashboard-layout.ts`.
 */

/** The seven per-repo signals that can each become a dashboard tile. */
export type TileSignalType =
  | 'ci'
  | 'security'
  | 'reviews'
  | 'pullRequests'
  | 'issues'
  | 'stale'
  | 'activity';

/**
 * One dashboard tile = one (repo, signal) pairing positioned on the grid.
 *
 * The geometry fields (`x`/`y`/`w`/`h`) mirror react-grid-layout's layout item
 * so a tile maps to a grid item with no transformation beyond field selection.
 */
export interface DashboardTile {
  /** Stable unique id, always `${repo}:${signal}`. */
  i: string;
  /** Which signal this tile renders. */
  signal: TileSignalType;
  /** The repo's `nameWithOwner`, e.g. `octocat/hello-world`. */
  repo: string;
  /** Column position in 12-col grid units (0-indexed from left). */
  x: number;
  /** Row position in grid units (0-indexed from top). */
  y: number;
  /** Width in grid units. */
  w: number;
  /** Height in grid units. */
  h: number;
  /** Whether the tile is shown (hidden tiles persist but drop out of the grid). */
  visible: boolean;
}
