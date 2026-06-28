/**
 * React state binding for the Deck's row/column order.
 *
 * Holds the SPARSE saved orders (repo ids + signal ids) and derives the live,
 * reconciled orders against the current fleet on every render (so a new repo
 * appears automatically and a removed one drops — no effect needed). Mutators
 * move an item and persist the reconciled order; persistence is debounced and
 * flushed on unmount / page teardown, mirroring {@link useDashboardLayout}.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';

import { debounce } from '../lib/debounce';
import {
  loadDeckRepoOrder,
  loadDeckSignalOrder,
  moveInOrder,
  reconcileRepoOrder,
  reconcileSignalOrder,
  saveDeckRepoOrder,
  saveDeckSignalOrder,
} from '../lib/deck-order';
import type { TileSignalType } from '../types/dashboard';

/** Quiet period before an order change is written to storage (drag-friendly). */
const PERSIST_DEBOUNCE_MS = 300;

/** Public shape returned by {@link useDeckOrder}. */
export interface UseDeckOrderResult {
  /** Live repo (row) order — saved order reconciled against the fleet. */
  repoOrder: string[];
  /** Live signal (column) order — saved order reconciled against DECK_SIGNALS. */
  signalOrder: TileSignalType[];
  /** Moves the repo at `from` to `to` (row reorder) and persists. */
  moveRepo: (from: number, to: number) => void;
  /** Moves the signal at `from` to `to` (column reorder) and persists. */
  moveSignal: (from: number, to: number) => void;
  /** Clears both orders (restores fleet/default order) and clears storage. */
  reset: () => void;
}

/**
 * Manages the Deck's repo-row and signal-column order for the given fleet.
 *
 * @param fleet - The live fleet's `nameWithOwner` ids (drives row reconciliation).
 */
export function useDeckOrder(fleet: readonly string[]): UseDeckOrderResult {
  const [savedRepoOrder, setSavedRepoOrder] = useState<string[]>(() => loadDeckRepoOrder());
  const [savedSignalOrder, setSavedSignalOrder] = useState<TileSignalType[]>(() =>
    loadDeckSignalOrder(),
  );

  const repoOrder = useMemo(
    () => reconcileRepoOrder(savedRepoOrder, fleet),
    [savedRepoOrder, fleet],
  );
  const signalOrder = useMemo(() => reconcileSignalOrder(savedSignalOrder), [savedSignalOrder]);

  const persistRepo = useMemo(() => debounce(saveDeckRepoOrder, PERSIST_DEBOUNCE_MS), []);
  const persistSignal = useMemo(() => debounce(saveDeckSignalOrder, PERSIST_DEBOUNCE_MS), []);

  // Flush pending writes on unmount so the last reorder is never lost on a view
  // switch right after a drag.
  useEffect(
    () => () => {
      persistRepo.flush();
      persistSignal.flush();
    },
    [persistRepo, persistSignal],
  );

  // A hard page close/navigate does NOT unmount React, so flush on teardown /
  // backgrounding too (mirrors useDashboardLayout, per LEARNINGS).
  useEffect(() => {
    const flush = () => {
      persistRepo.flush();
      persistSignal.flush();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('beforeunload', flush);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [persistRepo, persistSignal]);

  const moveRepo = useCallback(
    (from: number, to: number) => {
      setSavedRepoOrder((prev) => {
        const next = moveInOrder(reconcileRepoOrder(prev, fleet), from, to);
        persistRepo(next);
        return next;
      });
    },
    [fleet, persistRepo],
  );

  const moveSignal = useCallback(
    (from: number, to: number) => {
      setSavedSignalOrder((prev) => {
        const next = moveInOrder(reconcileSignalOrder(prev), from, to);
        persistSignal(next);
        return next;
      });
    },
    [persistSignal],
  );

  const reset = useCallback(() => {
    persistRepo.cancel();
    persistSignal.cancel();
    saveDeckRepoOrder([]);
    saveDeckSignalOrder([]);
    setSavedRepoOrder([]);
    setSavedSignalOrder([]);
  }, [persistRepo, persistSignal]);

  return { repoOrder, signalOrder, moveRepo, moveSignal, reset };
}
