/**
 * React binding for the Deck's tile-size preference.
 *
 * Mirrors {@link useDensity}: every consumer (the Deck size control, the
 * {@link BoardView} grid, and the full-window bar's control) shares ONE
 * module-level reactive store via `useSyncExternalStore`. A `setSize` from any
 * instance persists the choice and notifies all subscribers, so the change is
 * reflected live everywhere.
 *
 * `localStorage` is the single source of truth: `getSnapshot` reads it (so a
 * value seeded before mount is honoured) and `setSize` writes it before
 * emitting. The snapshot is a primitive {@link DeckTileSize}, so React's
 * `Object.is` comparison stays stable across renders when nothing changed.
 */
import { useCallback, useSyncExternalStore } from 'react';

import { loadDeckTileSize, saveDeckTileSize } from '../lib/deck-tile-size';
import type { DeckTileSize } from '../lib/deck-tile-size';

/** Public shape returned by {@link useDeckTileSize}. */
export interface UseDeckTileSizeResult {
  /** The user's current Deck tile size. */
  size: DeckTileSize;
  /** Persists + applies a new size across every consumer. */
  setSize: (size: DeckTileSize) => void;
}

const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
  };
}

/** Reads the live size from storage — the store's single source of truth. */
function getSnapshot(): DeckTileSize {
  return loadDeckTileSize();
}

/** Persists the next size and notifies every subscriber (no-op if unchanged). */
function setSizeShared(next: DeckTileSize): void {
  if (next === getSnapshot()) {
    return;
  }
  saveDeckTileSize(next);
  emit();
}

/**
 * Test-only seam: drops all subscribers so a hook rendered in one test does not
 * leak its listener into the next. The actual size is reset by clearing
 * `localStorage` (the source of truth) in the suite's `beforeEach`.
 */
export function __resetDeckTileSizeStoreForTests(): void {
  listeners.clear();
}

/** Manages the active Deck tile size, shared across every consumer. */
export function useDeckTileSize(): UseDeckTileSizeResult {
  // The 3rd arg (server snapshot) mirrors getSnapshot: this app is client-only.
  const size = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const setSize = useCallback((next: DeckTileSize) => {
    setSizeShared(next);
  }, []);

  return { size, setSize };
}
