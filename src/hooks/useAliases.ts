/**
 * React state binding for per-repo display aliases (Phase 3 customization).
 * Loads + reconciles the persisted alias map on mount and, like
 * {@link useDashboardLayout}, re-reconciles it against the fleet whenever the
 * fleet *identity* changes — dropping aliases for repos no longer present.
 * Reconciliation on mount is display-only; a narrowed map is never persisted
 * until the fleet is confirmed non-empty (the I2 empty-fleet guard).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { Repo } from '../types/fleet';
import {
  clearAlias as clearAliasPref,
  loadAliases,
  saveAliases,
  setAlias as setAliasPref,
} from '../lib/alias-preference';

/** Public shape returned by {@link useAliases}. */
export interface UseAliasesResult {
  /** The current (loaded, validated, reconciled) repo→alias map. */
  aliases: Record<string, string>;
  /** Sets (or clears, when blank) the alias for a repo and persists it. */
  setAlias: (repo: string, alias: string) => void;
  /** Clears the alias for a repo and persists the result. */
  clearAlias: (repo: string) => void;
}

/** Drops aliases whose repo is no longer in the fleet. */
function reconcile(map: Record<string, string>, repos: Repo[]): Record<string, string> {
  const present = new Set(repos.map((r) => r.nameWithOwner));
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(map)) {
    if (present.has(key)) next[key] = value;
  }
  return next;
}

/**
 * Manages display aliases for the given fleet.
 *
 * @param repos - Repositories driving alias reconciliation.
 */
export function useAliases(repos: Repo[]): UseAliasesResult {
  // Reconcile against the fleet present at mount (display-only, never persisted
  // here) so a pre-populated fleet drops absent repos' aliases immediately,
  // mirroring useDashboardLayout's reconcile-on-init.
  const [aliases, setAliasesState] = useState<Record<string, string>>(() =>
    reconcile(loadAliases(), repos),
  );

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

  const previousFleetKey = useRef(fleetKey);
  useEffect(() => {
    if (previousFleetKey.current === fleetKey) return;
    previousFleetKey.current = fleetKey;
    const loaded = loadAliases();
    // Empty-fleet guard (I2): reconcile for DISPLAY but never PERSIST a
    // narrowed set until the fleet is confirmed non-empty — otherwise the
    // transiently-empty initial fleet would drop+re-persist every alias.
    if (repos.length === 0) {
      setAliasesState(loaded);
      return;
    }
    const reconciled = reconcile(loaded, repos);
    saveAliases(reconciled);
    setAliasesState(reconciled);
  }, [fleetKey, repos]);

  const setAlias = useCallback((repo: string, alias: string) => {
    setAliasesState(setAliasPref(repo, alias));
  }, []);
  const clearAlias = useCallback((repo: string) => {
    setAliasesState(clearAliasPref(repo));
  }, []);

  return { aliases, setAlias, clearAlias };
}
