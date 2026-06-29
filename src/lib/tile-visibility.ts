import type { DashboardTile, TileSignalType } from '../types/dashboard';

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

/** A pure predicate over a single tile — the unit a visibility rule acts on. */
export type TileVisibilityPredicate = (tile: DashboardTile) => boolean;

/**
 * The rule primitive the other transforms build on: returns a new layout with
 * `visible` applied to exactly the tiles for which `predicate` is true. Pure
 * (see {@link flipTileVisibility}): the input is never mutated, tiles whose flag
 * already equals `visible` keep their identity, and the array never grows.
 *
 * @param layout - The current dashboard layout (hidden tiles included).
 * @param predicate - Selects which tiles the rule targets.
 * @param visible - The flag to apply to the matched tiles.
 */
export function applyVisibilityRule(
  layout: DashboardTile[],
  predicate: TileVisibilityPredicate,
  visible: boolean,
): DashboardTile[] {
  return layout.map((tile) =>
    predicate(tile) && tile.visible !== visible ? { ...tile, visible } : tile,
  );
}

/**
 * Shows or hides one `signal` across ALL repos at once — the global signal rule
 * that replaces the per-repo checkbox grind. Pure (see {@link applyVisibilityRule}).
 *
 * @param layout - The current dashboard layout (hidden tiles included).
 * @param signal - The signal to flip across every repo.
 * @param visible - The flag to apply to that signal's tiles.
 */
export function setSignalVisibility(
  layout: DashboardTile[],
  signal: TileSignalType,
  visible: boolean,
): DashboardTile[] {
  return applyVisibilityRule(layout, (tile) => tile.signal === signal, visible);
}

/**
 * Shows or hides every tile — the bulk "Show all" / "Hide all" action. Pure
 * (see {@link applyVisibilityRule}).
 *
 * @param layout - The current dashboard layout (hidden tiles included).
 * @param visible - The flag to apply to every tile.
 */
export function setAllVisibility(layout: DashboardTile[], visible: boolean): DashboardTile[] {
  return applyVisibilityRule(layout, () => true, visible);
}

/**
 * Makes a tile visible iff its signal is in `signals`, hiding all others — the
 * "Show only…" bulk action. An empty set hides everything. Pure (see
 * {@link flipTileVisibility}): input untouched, unchanged tiles keep identity.
 *
 * @param layout - The current dashboard layout (hidden tiles included).
 * @param signals - The set of signals to keep visible.
 */
export function showOnlySignals(
  layout: DashboardTile[],
  signals: Set<TileSignalType>,
): DashboardTile[] {
  return layout.map((tile) => {
    const visible = signals.has(tile.signal);
    return tile.visible !== visible ? { ...tile, visible } : tile;
  });
}

/** Per-signal visibility tally driving the customize UI's tri-state toggles. */
export interface SignalVisibilitySummary {
  /** The signal this row counts. */
  signal: TileSignalType;
  /** How many of the signal's tiles are currently visible. */
  shown: number;
  /** Total tiles for the signal (visible or not). */
  total: number;
}

/**
 * Tallies `{ shown, total }` per signal so the customize UI can render a
 * tri-state (all / none / some) control for each signal. Signals appear in
 * first-seen order; signals with no tiles are omitted.
 *
 * @param layout - The dashboard layout to summarise (hidden tiles included).
 */
export function signalVisibilitySummary(layout: DashboardTile[]): SignalVisibilitySummary[] {
  const order: TileSignalType[] = [];
  const bySignal = new Map<TileSignalType, SignalVisibilitySummary>();
  for (const tile of layout) {
    let entry = bySignal.get(tile.signal);
    if (entry === undefined) {
      entry = { signal: tile.signal, shown: 0, total: 0 };
      bySignal.set(tile.signal, entry);
      order.push(tile.signal);
    }
    entry.total += 1;
    if (tile.visible) entry.shown += 1;
  }
  return order.map((signal) => bySignal.get(signal) as SignalVisibilitySummary);
}
