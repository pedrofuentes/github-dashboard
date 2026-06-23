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

/**
 * Legacy (v1) key: an unversioned bare `DashboardTile[]`. Kept for rollback —
 * the migration reads it but never deletes it.
 */
const STORAGE_KEY = 'fleet:dashboard-layout';
/** Current versioned key holding the `{ version, tiles }` envelope. */
const STORAGE_KEY_V2 = 'fleet:dashboard-view:v2';
/** Schema version of the persisted layout envelope at {@link STORAGE_KEY_V2}. */
const LAYOUT_VERSION = 2;

/** Signals in render order — one tile per repo is created per entry. */
const TILE_SIGNALS: readonly TileSignalType[] = [
  'ci',
  'security',
  'reviews',
  'pullRequests',
  'issues',
  'stale',
  'activity',
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
/**
 * Hard cap on how many tiles a stored layout may contain. Sized with headroom
 * above the fleet ceiling: 7 signals × 100 repos = 700 tiles, so a large fleet
 * persists rather than silently failing the schema cap (#200).
 */
export const MAX_TILES = 700;
/** Cap on the length of the `i` / `repo` strings (GitHub names are far shorter). */
export const MAX_STRING_LENGTH = 256;

const TileSignalSchema = z.enum([
  'ci',
  'security',
  'reviews',
  'pullRequests',
  'issues',
  'stale',
  'activity',
]);

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

/**
 * The forward-compatible persisted envelope (v2). Wrapping the tile array in a
 * versioned object lets future format changes be detected and migrated rather
 * than silently mis-parsed. `version` is pinned to {@link LAYOUT_VERSION}.
 */
const VersionedLayoutSchema = z.object({
  version: z.literal(LAYOUT_VERSION),
  tiles: DashboardLayoutSchema,
});

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
 * Reads the raw persisted tiles (pre-reconciliation), preferring the versioned
 * v2 envelope and transparently migrating a legacy v1 array on first read.
 *
 * Resolution order:
 *  1. v2 key present → parse the `{ version, tiles }` envelope; corrupt/invalid
 *     ⇒ `null` (the caller falls back to {@link DEFAULT_LAYOUT}).
 *  2. v2 absent, legacy v1 array present & valid → migrate: persist the v2
 *     envelope with the SAME tiles (so the on-screen layout is unchanged) and
 *     KEEP the legacy key for rollback. Returns the migrated tiles.
 *  3. Nothing valid stored ⇒ `null`.
 *
 * Never throws.
 */
function loadStoredTiles(): DashboardTile[] | null {
  const rawV2 = safeGet(STORAGE_KEY_V2);
  if (rawV2 !== null) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawV2);
    } catch {
      return null;
    }
    const result = VersionedLayoutSchema.safeParse(parsed);
    return result.success ? result.data.tiles : null;
  }

  const rawLegacy = safeGet(STORAGE_KEY);
  if (rawLegacy === null) {
    return null;
  }
  let parsedLegacy: unknown;
  try {
    parsedLegacy = JSON.parse(rawLegacy);
  } catch {
    return null;
  }
  const legacy = DashboardLayoutSchema.safeParse(parsedLegacy);
  if (!legacy.success) {
    return null;
  }
  // Migrate v1 → v2 on read: write the versioned envelope (same tiles) and leave
  // the legacy key in place for rollback. This is a storage-format change only.
  safeSet(STORAGE_KEY_V2, JSON.stringify({ version: LAYOUT_VERSION, tiles: legacy.data }));
  return legacy.data;
}

/**
 * Reads, validates, and reconciles the persisted layout against the current
 * fleet. Tiles for repos no longer present are dropped; tiles missing from the
 * stored layout (e.g. a newly added signal such as `activity` absent from an
 * older persisted layout) are appended from {@link DEFAULT_LAYOUT} so the grid
 * never silently omits a signal. Any missing/corrupt/invalid/empty-after-reconcile
 * result falls back to {@link DEFAULT_LAYOUT}. Never throws.
 */
export function loadDashboardLayout(repos: Repo[]): DashboardTile[] {
  const stored = loadStoredTiles();
  if (stored === null) {
    return DEFAULT_LAYOUT(repos);
  }

  const present = new Set(repos.map((repo) => repo.nameWithOwner));
  const reconciled = stored.filter((tile) => present.has(tile.repo));
  if (reconciled.length === 0) {
    return DEFAULT_LAYOUT(repos);
  }

  // Back-compat: for each repo already in the stored layout, append any signal
  // tile it predates — e.g. `activity`, absent from a layout persisted before
  // that tile shipped — keeping the stored geometry for the existing tiles. The
  // grid's vertical compaction resolves any overlap with the default positions.
  // Repos entirely absent from the stored layout are NOT introduced: repo
  // membership stays authoritative (a newly added fleet repo only appears on
  // reset), matching the pre-existing reconciliation contract.
  const storedIds = new Set(reconciled.map((tile) => tile.i));
  const reposInLayout = new Set(reconciled.map((tile) => tile.repo));
  const additions = DEFAULT_LAYOUT(repos).filter(
    (tile) => reposInLayout.has(tile.repo) && !storedIds.has(tile.i),
  );
  return additions.length === 0 ? reconciled : [...reconciled, ...additions];
}

/**
 * Persists the layout as the versioned v2 envelope (best-effort). Caller-supplied
 * tiles are re-validated against {@link DashboardLayoutSchema} first; an invalid
 * layout is skipped rather than written, so corrupt geometry never reaches
 * storage. The legacy v1 key is left untouched. Never throws.
 */
export function saveDashboardLayout(tiles: DashboardTile[]): void {
  if (!DashboardLayoutSchema.safeParse(tiles).success) {
    return;
  }
  safeSet(STORAGE_KEY_V2, JSON.stringify({ version: LAYOUT_VERSION, tiles }));
}

/**
 * Clears the persisted layout (best-effort). Removes BOTH the v2 envelope and
 * the legacy v1 key so an explicit reset truly restores {@link DEFAULT_LAYOUT}
 * rather than re-migrating the legacy layout on the next load.
 */
export function resetDashboardLayout(): void {
  safeRemove(STORAGE_KEY_V2);
  safeRemove(STORAGE_KEY);
}
