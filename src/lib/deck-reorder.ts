/**
 * Pure helpers for the Deck's drag reordering (used with `@dnd-kit/sortable`).
 *
 * Kept free of React / `@dnd-kit` so the index logic that maps a drag-end event
 * to a `moveRepo(from, to)` / `moveSignal(from, to)` call is unit-testable
 * without simulating real pointer/keyboard drag (which is unreliable in jsdom).
 */

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
