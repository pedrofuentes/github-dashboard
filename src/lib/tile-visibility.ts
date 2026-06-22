import type { DashboardTile } from '../types/dashboard';

// Flips operate on the CURRENT layout array and never append, so MAX_TILES is
// structurally respected. Brand-new fleet repos are NOT introduced here — repo
// membership stays authoritative and a new repo only appears after a layout
// reset (see dashboard-layout.ts loadDashboardLayout). Not a bug.
/**
 * Returns a new layout with one tile's `visible` flag set to `visible`, matched
 * by its unique `i`. Pure: the input array is never mutated and tiles whose flag
 * already equals `visible` keep their identity (referentially stable). Never
 * appends, so `MAX_TILES` (dashboard-layout.ts) is structurally respected.
 *
 * @param layout - The current dashboard layout (hidden tiles included).
 * @param tileId - The `i` of the tile to flip.
 * @param visible - The flag to apply to that tile.
 */
export function flipTileVisibility(
  layout: DashboardTile[],
  tileId: string,
  visible: boolean,
): DashboardTile[] {
  return layout.map((tile) =>
    tile.i === tileId && tile.visible !== visible ? { ...tile, visible } : tile,
  );
}

/**
 * Returns a new layout with every tile of `repo` set to `visible` — the group
 * hide/show toggle. Pure (see {@link flipTileVisibility}): the input is never
 * mutated, already-correct tiles keep their identity, and the array never grows.
 *
 * @param layout - The current dashboard layout (hidden tiles included).
 * @param repo - The `owner/name` whose tiles to flip.
 * @param visible - The flag to apply to that repo's tiles.
 */
export function flipRepoVisibility(
  layout: DashboardTile[],
  repo: string,
  visible: boolean,
): DashboardTile[] {
  return layout.map((tile) =>
    tile.repo === repo && tile.visible !== visible ? { ...tile, visible } : tile,
  );
}

/**
 * True when no tile in `layout` is visible — the "all hidden" empty state the
 * dashboard surfaces with a recovery prompt. An empty layout counts as hidden.
 *
 * @param layout - The dashboard layout to inspect.
 */
export function isAllHidden(layout: DashboardTile[]): boolean {
  return !layout.some((tile) => tile.visible);
}

/**
 * Buckets a layout into a `repo → tiles` map, preserving first-seen repo order
 * and each repo's tile order. Drives the CustomizePanel's per-repo fieldsets.
 *
 * @param layout - The dashboard layout to group (hidden tiles included).
 */
export function groupTilesByRepo(layout: DashboardTile[]): Map<string, DashboardTile[]> {
  const groups = new Map<string, DashboardTile[]>();
  for (const tile of layout) {
    const bucket = groups.get(tile.repo);
    if (bucket === undefined) groups.set(tile.repo, [tile]);
    else bucket.push(tile);
  }
  return groups;
}
