/**
 * React state binding for the Deck's per-key tile visibility.
 *
 * State is seeded from {@link loadHiddenDeckKeys} on mount and persisted on
 * every real change. Mutators delegate to the pure `deck-visibility` lib;
 * when the lib returns the same Set instance (no-op), neither a persist nor a
 * re-render is triggered. All mutators are memoised with `useCallback` so
 * consumers can safely include them in dependency arrays.
 */
import { useCallback, useState } from 'react';

import type { TileSignalType } from '../types/dashboard';
import {
  loadHiddenDeckKeys,
  saveHiddenDeckKeys,
  toggleKey as libToggleKey,
  setSignalHidden,
  setRepoHidden,
  setAllHidden,
  showOnlySignals,
} from '../lib/deck-visibility';

/** Public shape returned by {@link useDeckVisibility}. */
export interface UseDeckVisibilityResult {
  /** The current hidden-keys set. An empty set means all tiles are visible. */
  hidden: Set<string>;
  /** Flips one (repo, signal) key's visibility. */
  toggleKey: (repo: string, signal: TileSignalType) => void;
  /** Hides or shows one signal across all given repos. */
  setSignal: (repos: readonly string[], signal: TileSignalType, hide: boolean) => void;
  /** Hides or shows all given signals for one repo. */
  setRepo: (repo: string, signals: readonly TileSignalType[], hide: boolean) => void;
  /** Bulk hide/show for the entire (repos × signals) grid. */
  setAll: (repos: readonly string[], signals: readonly TileSignalType[], hide: boolean) => void;
  /** Hides every (repo, signal) whose signal is NOT in `keep`. */
  showOnly: (
    repos: readonly string[],
    signals: readonly TileSignalType[],
    keep: Set<TileSignalType>,
  ) => void;
  /** Clears the hidden set and persists the empty state. */
  reset: () => void;
}

/**
 * Manages the Deck's hidden-tiles set.
 *
 * State is seeded from `loadHiddenDeckKeys()` on first mount. Each mutator
 * uses a functional `setState` update so it always operates on the latest
 * state, computes the next set via the pure lib, and — if the set changed —
 * persists it before updating React state. Same-instance returns from the lib
 * (no-op) skip both persist and re-render.
 */
export function useDeckVisibility(): UseDeckVisibilityResult {
  const [hidden, setHidden] = useState<Set<string>>(() => loadHiddenDeckKeys());

  const applyTransform = useCallback((transform: (prev: Set<string>) => Set<string>) => {
    setHidden((prev) => {
      const next = transform(prev);
      if (next === prev) return prev;
      saveHiddenDeckKeys(next);
      return next;
    });
  }, []);

  const toggleKey = useCallback(
    (repo: string, signal: TileSignalType) => {
      applyTransform((prev) => libToggleKey(prev, repo, signal));
    },
    [applyTransform],
  );

  const setSignal = useCallback(
    (repos: readonly string[], signal: TileSignalType, hide: boolean) => {
      applyTransform((prev) => setSignalHidden(prev, repos, signal, hide));
    },
    [applyTransform],
  );

  const setRepo = useCallback(
    (repo: string, signals: readonly TileSignalType[], hide: boolean) => {
      applyTransform((prev) => setRepoHidden(prev, repo, signals, hide));
    },
    [applyTransform],
  );

  const setAll = useCallback(
    (repos: readonly string[], signals: readonly TileSignalType[], hide: boolean) => {
      applyTransform((prev) => setAllHidden(prev, repos, signals, hide));
    },
    [applyTransform],
  );

  const showOnly = useCallback(
    (repos: readonly string[], signals: readonly TileSignalType[], keep: Set<TileSignalType>) => {
      applyTransform(() => showOnlySignals(repos, signals, keep));
    },
    [applyTransform],
  );

  const reset = useCallback(() => {
    applyTransform((prev) => (prev.size === 0 ? prev : new Set<string>()));
  }, [applyTransform]);

  return { hidden, toggleKey, setSignal, setRepo, setAll, showOnly, reset };
}
