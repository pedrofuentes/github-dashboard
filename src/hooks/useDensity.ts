/**
 * React binding for the tile density preference (DESIGN-TILES §density).
 *
 * Every `useDensity()` consumer (the Settings {@link DensityToggle}, the ⌘K
 * "Toggle density" command, the {@link FleetMatrix} cells, and every dashboard
 * `SignalTile`) shares ONE module-level reactive store via React's
 * `useSyncExternalStore`. A `setDensity` from any instance persists the choice
 * and notifies all subscribers, so the change is reflected live everywhere —
 * unlike a per-component `useState`, which only updated its own instance and
 * left the consumers stuck at their mount-time value.
 *
 * `localStorage` is the single source of truth: `getSnapshot` reads it (so a
 * value seeded before mount is honoured) and `setDensity` writes it before
 * emitting. The snapshot is a primitive {@link Density}, so React's `Object.is`
 * comparison stays stable across renders when nothing changed.
 */
import { useCallback, useSyncExternalStore } from 'react';

import { loadDensityPreference, saveDensityPreference } from '../lib/density-preference';
import type { Density } from '../lib/density-preference';

/** Public shape returned by {@link useDensity}. */
export interface UseDensityResult {
  /** The user's current tile density (`balanced` / `glanceable`). */
  density: Density;
  /** Persists + applies a new density across every consumer. */
  setDensity: (density: Density) => void;
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

/** Reads the live density from storage — the store's single source of truth. */
function getSnapshot(): Density {
  return loadDensityPreference();
}

/** Persists the next density and notifies every subscriber (no-op if unchanged). */
function setDensityShared(next: Density): void {
  if (next === getSnapshot()) {
    return;
  }
  saveDensityPreference(next);
  emit();
}

/**
 * Test-only seam: drops all subscribers so a hook rendered in one test does not
 * leak its listener into the next. The actual density is reset by clearing
 * `localStorage` (the source of truth) in the suite's `beforeEach`.
 */
export function __resetDensityStoreForTests(): void {
  listeners.clear();
}

/** Manages the active tile density, shared across every consumer. */
export function useDensity(): UseDensityResult {
  // The 3rd arg (server snapshot) mirrors getSnapshot: this app is client-only.
  const density = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const setDensity = useCallback((next: Density) => {
    setDensityShared(next);
  }, []);

  return { density, setDensity };
}
