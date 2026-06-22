/**
 * React state binding for the presentational repo-scope filter (Phase 3).
 *
 * Mirrors `useDashboardLayout`: the selection is loaded + reconciled on mount,
 * persisted on every user-driven change, and re-reconciled whenever the fleet
 * *set* changes (tracked via a stable `fleetKey` plus a `previousFleetKey` ref).
 * The reconcile path differs from a plain change in one way: it persists the
 * reconciled selection only while the fleet is non-empty (the empty-fleet guard,
 * I2), so a transiently empty initial fleet — common while repos load async —
 * never wipes the saved filter. An empty selection means "all repos shown";
 * `isActive` reports whether a narrowing filter is currently in effect.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { Repo } from '../types/fleet';
import { loadRepoFilter, saveRepoFilter } from '../lib/repo-filter-preference';

/** Public shape returned by {@link useRepoFilter}. */
export interface UseRepoFilterResult {
  /** The currently selected repos (empty ⇒ all shown). */
  selected: Set<string>;
  /** Adds or removes one repo from the selection and persists. */
  toggleRepo: (repo: string) => void;
  /** Replaces the entire selection and persists. */
  setSelected: (repos: string[]) => void;
  /** Clears the selection (back to "all shown") and persists. */
  clear: () => void;
  /** True when a narrowing filter is active (`selected.size > 0`). */
  isActive: boolean;
}

/**
 * Manages the repo-scope filter for the given fleet.
 *
 * @param repos - Repositories used to reconcile the persisted selection.
 */
export function useRepoFilter(repos: Repo[]): UseRepoFilterResult {
  const [selected, setSelectedState] = useState<Set<string>>(() => new Set(loadRepoFilter(repos)));

  // A stable identity for the fleet, independent of array reference or order, so
  // we only re-reconcile when the *set* of repos actually changes.
  const fleetKey = useMemo(
    () =>
      repos
        .map((r) => r.nameWithOwner)
        .sort()
        .join('\n'),
    [repos],
  );

  // The lazy initializer above ran against the fleet present at mount, which is
  // often empty while repos load asynchronously. Re-reconcile when the fleet
  // identity changes so newly present repos survive and absent ones drop.
  const previousFleetKey = useRef(fleetKey);
  useEffect(() => {
    if (previousFleetKey.current === fleetKey) return;
    previousFleetKey.current = fleetKey;
    const reconciled = loadRepoFilter(repos);
    // Empty-fleet guard (I2): reconcile for DISPLAY but do not persist the
    // narrowed set until the fleet is confirmed non-empty, so a transiently
    // empty initial fleet never wipes the saved filter.
    if (repos.length > 0) saveRepoFilter(reconciled);
    setSelectedState(new Set(reconciled));
  }, [fleetKey, repos]);

  const commit = useCallback((next: Set<string>) => {
    saveRepoFilter([...next]);
    setSelectedState(next);
  }, []);

  const toggleRepo = useCallback((repo: string) => {
    setSelectedState((current) => {
      const next = new Set(current);
      if (next.has(repo)) next.delete(repo);
      else next.add(repo);
      saveRepoFilter([...next]);
      return next;
    });
  }, []);

  const setSelected = useCallback((next: string[]) => commit(new Set(next)), [commit]);
  const clear = useCallback(() => commit(new Set()), [commit]);

  return { selected, toggleRepo, setSelected, clear, isActive: selected.size > 0 };
}
