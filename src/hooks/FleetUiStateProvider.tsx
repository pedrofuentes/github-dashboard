import { useCallback, useMemo, useReducer } from 'react';
import type { ReactElement, ReactNode } from 'react';

import { FleetSelectionContext } from './useFleetSelection';
import type { FleetSelectionValue } from './useFleetSelection';

type SelectionAction =
  | { type: 'toggle'; id: string }
  | { type: 'selectAll'; ids: string[] }
  | { type: 'invert'; ids: string[] }
  | { type: 'clear' };

/**
 * Reducer over the selected-id set. Every branch returns a fresh `Set` and
 * never mutates `state` or the incoming `ids`, so prior snapshots stay stable
 * for memoised consumers and React change detection.
 */
function selectionReducer(
  state: ReadonlySet<string>,
  action: SelectionAction,
): ReadonlySet<string> {
  switch (action.type) {
    case 'toggle': {
      const next = new Set(state);
      if (next.has(action.id)) {
        next.delete(action.id);
      } else {
        next.add(action.id);
      }
      return next;
    }
    case 'selectAll':
      return new Set(action.ids);
    case 'invert': {
      const next = new Set(state);
      for (const id of action.ids) {
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
      }
      return next;
    }
    case 'clear':
      return new Set<string>();
  }
}

const EMPTY_SELECTION: ReadonlySet<string> = new Set<string>();

interface FleetUiStateProviderProps {
  children: ReactNode;
}

/**
 * Provides the shared fleet multi-selection state to its subtree. Lifting it
 * here means every view/component below shares ONE selection instance, the
 * foundation for a future multi-select bulk-action bar (no consumer yet).
 */
export function FleetUiStateProvider({ children }: FleetUiStateProviderProps): ReactElement {
  const [selected, dispatch] = useReducer(selectionReducer, EMPTY_SELECTION);

  const toggle = useCallback((id: string) => dispatch({ type: 'toggle', id }), []);
  const selectAll = useCallback((ids: string[]) => dispatch({ type: 'selectAll', ids }), []);
  const invert = useCallback((ids: string[]) => dispatch({ type: 'invert', ids }), []);
  const clear = useCallback(() => dispatch({ type: 'clear' }), []);
  const isSelected = useCallback((id: string) => selected.has(id), [selected]);

  const value = useMemo<FleetSelectionValue>(
    () => ({
      selected,
      selectedCount: selected.size,
      toggle,
      selectAll,
      invert,
      clear,
      isSelected,
    }),
    [selected, toggle, selectAll, invert, clear, isSelected],
  );

  return <FleetSelectionContext.Provider value={value}>{children}</FleetSelectionContext.Provider>;
}
