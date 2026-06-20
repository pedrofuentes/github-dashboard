/**
 * React state binding for the dashboard layout (M10). Loads the persisted +
 * reconciled layout on mount, persists on every change, and resets to the
 * default while clearing storage.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { Repo } from '../types/fleet';
import type { DashboardTile } from '../types/dashboard';
import {
  DEFAULT_LAYOUT,
  loadDashboardLayout,
  resetDashboardLayout,
  saveDashboardLayout,
} from '../lib/dashboard-layout';

/** Public shape returned by {@link useDashboardLayout}. */
export interface UseDashboardLayoutResult {
  /** The current (loaded, validated, reconciled) tile layout. */
  layout: DashboardTile[];
  /** Replaces the layout and persists it. */
  setLayout: (next: DashboardTile[]) => void;
  /** Clears storage and restores the default layout. */
  reset: () => void;
}

/**
 * Manages the dashboard layout for the given fleet.
 *
 * @param repos - Repositories driving the default layout and reconciliation.
 */
export function useDashboardLayout(repos: Repo[]): UseDashboardLayoutResult {
  const [layout, setLayoutState] = useState<DashboardTile[]>(() => loadDashboardLayout(repos));

  // A stable identity for the fleet, independent of array reference or order, so
  // we only re-reconcile when the *set* of repos actually changes.
  const fleetKey = useMemo(
    () =>
      repos
        .map((repo) => repo.nameWithOwner)
        .sort()
        .join('\n'),
    [repos],
  );

  // The lazy initializer above ran against the fleet present at mount, which is
  // often empty while repos load asynchronously. When the fleet identity changes
  // afterwards, re-run the persisted-layout reconciliation so tiles appear (and
  // stale tiles drop) without clobbering anything on unrelated re-renders (#115).
  const previousFleetKey = useRef(fleetKey);
  useEffect(() => {
    if (previousFleetKey.current === fleetKey) {
      return;
    }
    previousFleetKey.current = fleetKey;
    setLayoutState(loadDashboardLayout(repos));
  }, [fleetKey, repos]);

  const setLayout = useCallback((next: DashboardTile[]) => {
    setLayoutState(next);
    saveDashboardLayout(next);
  }, []);

  const reset = useCallback(() => {
    resetDashboardLayout();
    setLayoutState(DEFAULT_LAYOUT(repos));
  }, [repos]);

  return { layout, setLayout, reset };
}
