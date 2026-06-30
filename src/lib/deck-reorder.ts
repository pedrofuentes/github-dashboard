/**
 * Pure helpers for the Deck's drag reordering (used with `@dnd-kit/sortable`).
 *
 * Kept free of React / `@dnd-kit` so the index logic that maps a drag-end event
 * to a `moveRepo(from, to)` / `moveSignal(from, to)` call is unit-testable
 * without simulating real pointer/keyboard drag (which is unreliable in jsdom).
 */

import type { TileSignalType } from '../types/dashboard';

/** Namespace prefix for a column's sortable id, keeping it disjoint from repo ids. */
export const DECK_COLUMN_ID_PREFIX = 'col:';

/** The sortable id for a signal column (e.g. `col:ci`). */
export function deckColumnId(signal: TileSignalType): string {
  return `${DECK_COLUMN_ID_PREFIX}${signal}`;
}

/** A drag's resolved source + destination indices within an ordered id list. */
export interface ReorderIndices {
  from: number;
  to: number;
}

/**
 * Resolves the `{ from, to }` indices for a sortable drag end: the index of the
 * dragged item (`activeId`) and the index of the item it was dropped over
 * (`overId`) within `ids`. Returns `null` for a no-op — `overId` missing
 * (dropped outside), the same item, or either id absent — so the caller skips
 * the move. Ids are compared by string (matching `@dnd-kit`'s `UniqueIdentifier`,
 * which may be a string or number).
 */
export function reorderIndices(
  ids: readonly string[],
  activeId: string | number | null | undefined,
  overId: string | number | null | undefined,
): ReorderIndices | null {
  if (activeId == null || overId == null) {
    return null;
  }
  const active = String(activeId);
  const over = String(overId);
  if (active === over) {
    return null;
  }
  const from = ids.indexOf(active);
  const to = ids.indexOf(over);
  if (from === -1 || to === -1) {
    return null;
  }
  return { from, to };
}

/** What a Deck drag resolved to: a row (`repo`) move or a column (`column`) move. */
export interface DeckMove extends ReorderIndices {
  kind: 'repo' | 'column';
}

/**
 * Resolves a Deck drag end to a row or column move. The Deck's single
 * `DndContext` hosts two sortable axes — repo rows (ids = `nameWithOwner`) and
 * signal columns (ids namespaced, e.g. `col:ci`). The dragged id's membership
 * picks the axis: a `columnIds` member ⇒ a `column` move (indices within
 * `columnIds`), otherwise a `repo` move (indices within `repoIds`). Returns
 * `null` for any no-op (see {@link reorderIndices}) or when the active/over id
 * is absent from the selected axis list (indexOf = -1, including cross-axis drops).
 */
export function resolveDeckMove(
  repoIds: readonly string[],
  columnIds: readonly string[],
  activeId: string | number | null | undefined,
  overId: string | number | null | undefined,
): DeckMove | null {
  const active = activeId == null ? null : String(activeId);
  if (active !== null && columnIds.includes(active)) {
    const move = reorderIndices(columnIds, activeId, overId);
    return move === null ? null : { kind: 'column', ...move };
  }
  const move = reorderIndices(repoIds, activeId, overId);
  return move === null ? null : { kind: 'repo', ...move };
}
