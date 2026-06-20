/**
 * React state binding for the dashboard layout (M10). Loads the persisted +
 * reconciled layout on mount, persists on every change, and resets to the
 * default while clearing storage.
 */
import { useCallback, useState } from 'react';

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
