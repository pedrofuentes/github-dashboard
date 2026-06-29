import { createContext, useContext } from 'react';

/**
 * Shared multi-selection state for the fleet UI. Repos are identified by their
 * `nameWithOwner`. This is the foundation for a future bulk-action bar; nothing
 * consumes it yet, so it must stay behaviour-free.
 */
export interface FleetSelectionValue {
  /** The currently-selected repo ids. Read-only — mutate via the actions. */
  selected: ReadonlySet<string>;
  selectedCount: number;
  /** Add `id` if absent, otherwise remove it. */
  toggle: (id: string) => void;
  /** Replace the whole selection with exactly `ids` (deduplicated). */
  selectAll: (ids: string[]) => void;
  /** Empty the selection. */
  clear: () => void;
  /**
   * Within the `ids` universe, select the currently-unselected and deselect the
   * currently-selected. Ids outside the universe are left untouched.
   */
  invert: (ids: string[]) => void;
  isSelected: (id: string) => boolean;
}

/**
 * Selection context. The default is `undefined` (rather than a stub) so that
 * {@link useFleetSelection} can detect "no provider above" and throw a helpful
 * error instead of silently handing back a misleading empty selection.
 *
 * Defined in this `.ts` module (separate from the provider component) so the
 * context object and hook can be exported without tripping the
 * `react-refresh/only-export-components` rule that applies to `.tsx` files.
 */
export const FleetSelectionContext = createContext<FleetSelectionValue | undefined>(undefined);

/** Access the shared fleet selection. Must be called within a `FleetUiStateProvider`. */
export function useFleetSelection(): FleetSelectionValue {
  const value = useContext(FleetSelectionContext);
  if (value === undefined) {
    throw new Error('useFleetSelection must be used within a FleetUiStateProvider');
  }
  return value;
}
