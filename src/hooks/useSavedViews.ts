/**
 * React state binding for Saved Views — the CRUD consumer of the e1 saved-views
 * lib (`src/lib/saved-views.ts`). Loads the persisted state on mount and persists
 * on every change via {@link createSavedViewsStore}; the underlying ops are pure
 * and immutable, so this hook only owns the React state + persistence wiring.
 *
 * It also mirrors the lib's name validation for user-facing error messages and
 * reports storage failures instead of announcing success for dropped writes.
 */
import { useCallback, useRef, useState } from 'react';

import type { RepoFilterQueryV2 } from '../lib/repo-filter-query';
import type { FleetView } from '../lib/view-preference';
import {
  addSavedView,
  createSavedView,
  createSavedViewsStore,
  findSavedView,
  MAX_SAVED_VIEWS,
  removeSavedView,
  renameSavedView,
  updateSavedView,
  validateSavedViewName,
  type SavedView,
  type SavedViewsState,
} from '../lib/saved-views';

/** Caller input for {@link UseSavedViewsResult.create} (id + createdAt are filled). */
export interface CreateSavedViewInput {
  name: string;
  view: FleetView;
  filter: RepoFilterQueryV2;
  sort?: SavedView['sort'];
  density?: SavedView['density'];
}

/** Result of a validated mutation: `ok` plus an `error` message / the new view. */
export interface SavedViewMutationResult {
  ok: boolean;
  error?: string;
  view?: SavedView;
}

/** Public shape returned by {@link useSavedViews}. */
export interface UseSavedViewsResult {
  /** The current (loaded, validated) saved views. */
  views: SavedView[];
  /** Validates the name, then creates + persists a view (#436 boundary). */
  create: (input: CreateSavedViewInput) => SavedViewMutationResult;
  /** Validates the name, then renames + persists a view (#436 boundary). */
  rename: (id: string, name: string) => SavedViewMutationResult;
  /** Removes + persists the view with the given id (no-op if absent). */
  remove: (id: string) => SavedViewMutationResult;
  /** Merges a patch into the view with the given id, then persists. */
  update: (
    id: string,
    patch: Partial<Omit<SavedView, 'id' | 'createdAt'>>,
  ) => SavedViewMutationResult;
  /** Finds the view with the given id (or undefined). */
  find: (id: string) => SavedView | undefined;
}

/**
 * Validates a saved-view name at the consumer boundary (the lib's ops do not —
 * #436). Returns a human-readable error message, or null when the name is valid.
 */
export function validateViewName(name: string): string | null {
  return validateSavedViewName(name);
}

/**
 * Manages the user's saved views, persisting every change to localStorage.
 */
export function useSavedViews(): UseSavedViewsResult {
  // One store per hook instance, created lazily so it survives re-renders.
  const storeRef = useRef<ReturnType<typeof createSavedViewsStore>>();
  if (storeRef.current === undefined) {
    storeRef.current = createSavedViewsStore();
  }
  const store = storeRef.current;

  const [state, setState] = useState<SavedViewsState>(() => store.load());

  const commit = useCallback(
    (next: SavedViewsState): boolean => {
      if (!store.save(next)) return false;
      setState(next);
      return true;
    },
    [store],
  );

  const create = useCallback(
    (input: CreateSavedViewInput): SavedViewMutationResult => {
      const error = validateViewName(input.name);
      if (error !== null) {
        return { ok: false, error };
      }
      const view = createSavedView({ ...input, name: input.name.trim() });
      const next = addSavedView(state, view);
      if (next === null) {
        return { ok: false, error: `You can save at most ${MAX_SAVED_VIEWS} views.` };
      }
      if (!commit(next)) {
        return { ok: false, error: 'Could not save this view. Check browser storage.' };
      }
      return { ok: true, view };
    },
    [state, commit],
  );

  const rename = useCallback(
    (id: string, name: string): SavedViewMutationResult => {
      const error = validateViewName(name);
      if (error !== null) {
        return { ok: false, error };
      }
      const next = renameSavedView(state, id, name.trim());
      if (next === null) {
        return { ok: false, error: 'That view no longer exists.' };
      }
      if (!commit(next)) {
        return { ok: false, error: 'Could not save this view. Check browser storage.' };
      }
      return { ok: true, view: findSavedView(next, id) };
    },
    [state, commit],
  );

  const remove = useCallback(
    (id: string): SavedViewMutationResult => {
      const next = removeSavedView(state, id);
      if (next === null) {
        return { ok: false, error: 'That view no longer exists.' };
      }
      if (!commit(next)) {
        return { ok: false, error: 'Could not save this view. Check browser storage.' };
      }
      return { ok: true };
    },
    [state, commit],
  );

  const update = useCallback(
    (id: string, patch: Partial<Omit<SavedView, 'id' | 'createdAt'>>): SavedViewMutationResult => {
      if (patch.name !== undefined) {
        const error = validateViewName(patch.name);
        if (error !== null) {
          return { ok: false, error };
        }
      }
      const next = updateSavedView(state, id, patch);
      if (next === null) {
        return { ok: false, error: 'That view no longer exists.' };
      }
      if (!commit(next)) {
        return { ok: false, error: 'Could not save this view. Check browser storage.' };
      }
      return { ok: true, view: findSavedView(next, id) };
    },
    [state, commit],
  );

  const find = useCallback((id: string) => findSavedView(state, id), [state]);

  return { views: state.views, create, rename, remove, update, find };
}
