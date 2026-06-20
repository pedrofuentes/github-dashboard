/**
 * React state binding for the dashboard layout (M10). Loads the persisted +
 * reconciled layout on mount, persists on every change, and resets to the
 * default while clearing storage.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { Repo } from '../types/fleet';
import type { DashboardTile } from '../types/dashboard';
import { debounce } from '../lib/debounce';
import {
  DEFAULT_LAYOUT,
  loadDashboardLayout,
  resetDashboardLayout,
  saveDashboardLayout,
} from '../lib/dashboard-layout';

/** Quiet period before a layout change is written to storage (drag-friendly). */
const PERSIST_DEBOUNCE_MS = 300;

/** Public shape returned by {@link useDashboardLayout}. */
export interface UseDashboardLayoutResult {
  /** The current (loaded, validated, reconciled) tile layout. */
  layout: DashboardTile[];
  /** Replaces the layout immediately and persists it (debounced). */
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

  // react-grid-layout fires onLayoutChange ~30-60x/s during a drag. Keep the
  // in-memory layout immediate (responsive UI) but debounce the blocking
  // localStorage write so a drag coalesces to a single persist (#116).
  const persist = useMemo(() => debounce(saveDashboardLayout, PERSIST_DEBOUNCE_MS), []);

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
    // Commit any pending debounced write before reloading from storage. The
    // fleet can change within the 300 ms window right after a drag; reading
    // storage first would see the stale baseline and clobber the just-dragged
    // layout (tiles snap back). Flushing first makes the reload reflect it (#126).
    persist.flush();
    setLayoutState(loadDashboardLayout(repos));
  }, [fleetKey, repos, persist]);

  // Flush any pending write on React unmount so the last change is never lost
  // when the user switches views right after dragging a tile.
  useEffect(() => () => persist.flush(), [persist]);

  // A hard page close/navigate does NOT unmount React, so the unmount cleanup
  // above never runs and a drag within the debounce window would be lost. Flush
  // the pending write when the page is being torn down or backgrounded (#127).
  useEffect(() => {
    const flush = () => persist.flush();
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        flush();
      }
    };
    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('beforeunload', flush);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [persist]);

  const setLayout = useCallback(
    (next: DashboardTile[]) => {
      setLayoutState(next);
      persist(next);
    },
    [persist],
  );

  const reset = useCallback(() => {
    persist.cancel();
    resetDashboardLayout();
    setLayoutState(DEFAULT_LAYOUT(repos));
  }, [persist, repos]);

  return { layout, setLayout, reset };
}
