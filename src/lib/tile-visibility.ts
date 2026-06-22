import type { DashboardTile } from '../types/dashboard';

// Flips operate on the CURRENT layout array and never append, so MAX_TILES is
// structurally respected. Brand-new fleet repos are NOT introduced here — repo
// membership stays authoritative and a new repo only appears after a layout
// reset (see dashboard-layout.ts loadDashboardLayout). Not a bug.
export function flipTileVisibility(
  layout: DashboardTile[],
  tileId: string,
  visible: boolean,
): DashboardTile[] {
  return layout.map((tile) =>
    tile.i === tileId && tile.visible !== visible ? { ...tile, visible } : tile,
  );
}

export function flipRepoVisibility(
  layout: DashboardTile[],
  repo: string,
  visible: boolean,
): DashboardTile[] {
  return layout.map((tile) =>
    tile.repo === repo && tile.visible !== visible ? { ...tile, visible } : tile,
  );
}

export function isAllHidden(layout: DashboardTile[]): boolean {
  return !layout.some((tile) => tile.visible);
}

export function groupTilesByRepo(layout: DashboardTile[]): Map<string, DashboardTile[]> {
  const groups = new Map<string, DashboardTile[]>();
  for (const tile of layout) {
    const bucket = groups.get(tile.repo);
    if (bucket === undefined) groups.set(tile.repo, [tile]);
    else bucket.push(tile);
  }
  return groups;
}
