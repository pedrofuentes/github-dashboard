/**
 * React binding for the repo-owner display preference (whether repo labels
 * include their `owner/` segment).
 *
 * Every `useRepoOwner()` consumer (the Settings toggle, the ⌘K command, and
 * every place a repo label is rendered) shares ONE module-level reactive store
 * via React's `useSyncExternalStore`. A `setDisplay` from any instance persists
 * the choice and notifies all subscribers, so the change is reflected live
 * everywhere — unlike a per-component `useState`, which only updated its own
 * instance and left the consumers stuck at their mount-time value.
 *
 * `localStorage` is the single source of truth: `getSnapshot` reads it (so a
 * value seeded before mount is honoured) and `setDisplay` writes it before
 * emitting. The snapshot is a primitive {@link RepoOwnerDisplay}, so React's
 * `Object.is` comparison stays stable across renders when nothing changed.
 */
import { useCallback, useSyncExternalStore } from 'react';

import { loadRepoOwnerPreference, saveRepoOwnerPreference } from '../lib/repo-owner-preference';
import type { RepoOwnerDisplay } from '../lib/repo-owner-preference';

/** Public shape returned by {@link useRepoOwner}. */
export interface UseRepoOwnerResult {
  /** Whether repo labels currently `show` or `hide` the owner segment. */
  display: RepoOwnerDisplay;
  /** Persists + applies a new display across every consumer. */
  setDisplay: (display: RepoOwnerDisplay) => void;
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

/** Reads the live display from storage — the store's single source of truth. */
function getSnapshot(): RepoOwnerDisplay {
  return loadRepoOwnerPreference();
}

/** Persists the next display and notifies every subscriber (no-op if unchanged). */
function setDisplayShared(next: RepoOwnerDisplay): void {
  if (next === getSnapshot()) {
    return;
  }
  saveRepoOwnerPreference(next);
  emit();
}

/**
 * Test-only seam: drops all subscribers so a hook rendered in one test does not
 * leak its listener into the next. The actual display is reset by clearing
 * `localStorage` (the source of truth) in the suite's `beforeEach`.
 */
export function __resetRepoOwnerStoreForTests(): void {
  listeners.clear();
}

/** Manages the active repo-owner display, shared across every consumer. */
export function useRepoOwner(): UseRepoOwnerResult {
  // The 3rd arg (server snapshot) mirrors getSnapshot: this app is client-only.
  const display = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const setDisplay = useCallback((next: RepoOwnerDisplay) => {
    setDisplayShared(next);
  }, []);

  return { display, setDisplay };
}
