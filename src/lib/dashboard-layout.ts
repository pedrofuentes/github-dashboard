/**
 * Layout model + localStorage persistence for the at-a-glance Dashboard view
 * (M10). The dashboard renders one tile per (repo, signal); this module owns the
 * default layout, the react-grid-layout mapping, and defensive persistence.
 *
 * All storage access mirrors `src/lib/fleet-preferences.ts`: every read is
 * validated and every failure (unavailable / full / corrupt storage) degrades to
 * a sane default rather than throwing.
 */
import { z } from 'zod';

import type { Layout } from 'react-grid-layout';

import type { Repo } from '../types/fleet';
import type { DashboardTile, TileSignalType } from '../types/dashboard';

/** Namespaced key holding the persisted dashboard layout. */
const STORAGE_KEY = 'fleet:dashboard-layout';

/** Signals in render order — one tile per repo is created per entry. */
const TILE_SIGNALS: readonly TileSignalType[] = [
  'ci',
  'security',
  'reviews',
  'pullRequests',
  'issues',
  'stale',
];

/** Grid is 12 columns wide; tiles are a fixed 3×2 so 4 fit per row. */
const GRID_COLUMNS = 12;
const TILE_WIDTH = 3;
const TILE_HEIGHT = 2;
const TILES_PER_ROW = GRID_COLUMNS / TILE_WIDTH;

/**
 * Defensive caps for the persisted layout. These bound corrupt/hostile storage
 * so a malformed payload degrades to {@link DEFAULT_LAYOUT} instead of feeding
 * absurd geometry or an unbounded array into react-grid-layout.
 */
/** Upper bound on the row index a tile may occupy (generous: ~MAX_TILES rows). */
const MAX_GRID_ROWS = 1000;
/** Hard cap on how many tiles a stored layout may contain. */
export const MAX_TILES = 600;
/** Cap on the length of the `i` / `repo` strings (GitHub names are far shorter). */
export const MAX_STRING_LENGTH = 256;

const TileSignalSchema = z.enum(['ci', 'security', 'reviews', 'pullRequests', 'issues', 'stale']);

const DashboardTileSchema = z
  .object({
    i: z.string().min(1).max(MAX_STRING_LENGTH),
    signal: TileSignalSchema,
    repo: z.string().min(1).max(MAX_STRING_LENGTH),
    x: z.number().int().min(0).max(GRID_COLUMNS),
    y: z.number().int().min(0).max(MAX_GRID_ROWS),
    w: z.number().int().min(0).max(GRID_COLUMNS),
    h: z.number().int().min(0).max(MAX_GRID_ROWS),
    visible: z.boolean(),
  })
  .refine((tile) => tile.i === `${tile.repo}:${tile.signal}`, {
    message: 'tile id must equal `${repo}:${signal}`',
    path: ['i'],
  });

const DashboardLayoutSchema = z.array(DashboardTileSchema).max(MAX_TILES);

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Persistence is best-effort: ignore quota / disabled-storage failures.
  }
}

function safeRemove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Best-effort: ignore disabled-storage failures.
  }
}

/**
 * Builds the default layout: one tile per repo per signal, flowed
 * left-to-right on the 12-column grid. The caller's repo order is preserved
 * (the fleet passes repos pre-sorted "most-broken first"), so the grouping is
 * deterministic.
 */
export function DEFAULT_LAYOUT(repos: Repo[]): DashboardTile[] {
  const tiles: DashboardTile[] = [];
  let index = 0;
  for (const repo of repos) {
    for (const signal of TILE_SIGNALS) {
      const column = index % TILES_PER_ROW;
      const row = Math.floor(index / TILES_PER_ROW);
      tiles.push({
        i: `${repo.nameWithOwner}:${signal}`,
        signal,
        repo: repo.nameWithOwner,
        x: column * TILE_WIDTH,
        y: row * TILE_HEIGHT,
        w: TILE_WIDTH,
        h: TILE_HEIGHT,
        visible: true,
      });
      index += 1;
    }
  }
  return tiles;
}

/**
 * Maps tiles to react-grid-layout's `Layout` (a readonly array of layout
 * items), keeping only visible tiles and only the grid geometry fields.
 */
export function toRglLayout(tiles: DashboardTile[]): Layout {
  return tiles
    .filter((tile) => tile.visible)
    .map((tile) => ({ i: tile.i, x: tile.x, y: tile.y, w: tile.w, h: tile.h }));
}

/**
 * Reads, validates, and reconciles the persisted layout against the current
 * fleet. Tiles for repos no longer present are dropped; any
 * missing/corrupt/invalid/empty-after-reconcile result falls back to
 * {@link DEFAULT_LAYOUT}. Never throws.
 */
export function loadDashboardLayout(repos: Repo[]): DashboardTile[] {
  const raw = safeGet(STORAGE_KEY);
  if (raw === null) {
    return DEFAULT_LAYOUT(repos);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_LAYOUT(repos);
  }

  const result = DashboardLayoutSchema.safeParse(parsed);
  if (!result.success) {
    return DEFAULT_LAYOUT(repos);
  }

  const present = new Set(repos.map((repo) => repo.nameWithOwner));
  const reconciled = result.data.filter((tile) => present.has(tile.repo));
  if (reconciled.length === 0) {
    return DEFAULT_LAYOUT(repos);
  }
  return reconciled;
}

/**
 * Persists the layout as JSON (best-effort). Caller-supplied tiles are
 * re-validated against {@link DashboardLayoutSchema} first; an invalid layout
 * is skipped rather than written, so corrupt geometry never reaches storage.
 * Never throws.
 */
export function saveDashboardLayout(tiles: DashboardTile[]): void {
  if (!DashboardLayoutSchema.safeParse(tiles).success) {
    return;
  }
  safeSet(STORAGE_KEY, JSON.stringify(tiles));
}

/** Clears the persisted layout (best-effort). */
export function resetDashboardLayout(): void {
  safeRemove(STORAGE_KEY);
}
