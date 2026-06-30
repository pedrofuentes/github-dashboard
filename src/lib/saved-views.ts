/**
 * Data model + persistence for Saved Views — named workspaces composing a repo
 * filter + target view + sort/grouping/density (ADR-028). This is the pure lib
 * layer; the CRUD UI + quick-switcher is a separate concern.
 *
 * It owns:
 *  - {@link SavedView}: the typed + Zod-validated shape, embedding a
 *    {@link RepoFilterQueryV2} and targeting a {@link FleetView}, with
 *    defensively bounded strings/arrays (mirroring `repo-filter-query.ts` /
 *    `dashboard-layout.ts` patterns).
 *  - Persistence via {@link createVersionedStore} under {@link STORAGE_KEY_V1},
 *    fallback `{ version: 1, views: [] }`, defensive.
 *  - Pure operations: {@link createSavedView}, {@link addSavedView},
 *    {@link removeSavedView}, {@link renameSavedView}, {@link updateSavedView},
 *    {@link findSavedView} — immutable, cap-enforced, unique-id-aware.
 */
import { z } from 'zod';

import type { RepoFilterQueryV2 } from './repo-filter-query';
import { RepoFilterQueryV2Schema } from './repo-filter-query';
import { FLEET_VIEWS, type FleetView } from './view-preference';
import { MAX_STRING_LENGTH } from './dashboard-layout';
import { createVersionedStore, type VersionedStore } from './versioned-storage';

/** Versioned key holding the persisted saved-views state. */
export const STORAGE_KEY_V1 = 'fleet:saved-views:v1';

/**
 * Defensive caps on the persisted state's unbounded arrays, mirroring
 * `repo-filter-query.ts` and `dashboard-layout.ts`. They bound a
 * corrupt/hostile payload — a malformed value fails the schema and degrades to
 * the fallback — not legitimate use.
 */
/** Cap on the number of saved views a user may have (generous headroom). */
export const MAX_SAVED_VIEWS = 50;
/** Cap on the length of a saved view's name. */
export const MAX_VIEW_NAME_LENGTH = 128;

const FleetViewSchema = z.enum(FLEET_VIEWS);

const SortSchema = z.object({
  columnId: z.string().min(1).max(MAX_STRING_LENGTH),
  direction: z.enum(['asc', 'desc']),
});

const DensitySchema = z.enum(['balanced', 'glanceable']);

/** Zod schema for {@link SavedView}; the persisted views must satisfy it. */
export const SavedViewSchema = z.object({
  id: z.string().min(1).max(MAX_STRING_LENGTH),
  name: z.string().min(1).max(MAX_VIEW_NAME_LENGTH),
  view: FleetViewSchema,
  filter: RepoFilterQueryV2Schema,
  sort: SortSchema.optional(),
  density: DensitySchema.optional(),
  createdAt: z.string().min(1).max(MAX_STRING_LENGTH),
});

/**
 * A named workspace composing a repo filter + target view + sort/grouping/density.
 * Persisted as part of {@link SavedViewsState}.
 */
export type SavedView = z.infer<typeof SavedViewSchema>;

/** The forward-compatible persisted envelope (v1). */
export const SavedViewsStateSchema = z.object({
  version: z.literal(1),
  views: z.array(SavedViewSchema).max(MAX_SAVED_VIEWS),
});

/** The top-level persisted state holding all saved views. */
export type SavedViewsState = z.infer<typeof SavedViewsStateSchema>;

export function validateSavedViewName(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return 'Enter a name for this view.';
  }
  if (trimmed.length > MAX_VIEW_NAME_LENGTH) {
    return `Name must be ${MAX_VIEW_NAME_LENGTH} characters or fewer.`;
  }

  // Defense-in-depth: reject control chars (U+0000–U+001F, U+007F),
  // bidi control/isolate chars (U+202A-U+202E, U+2066-U+2069), zero-width space
  // (U+200B), and BOM (U+FEFF) to prevent future non-React-sink issues.
  // ZWJ (U+200D) and ZWNJ (U+200C) are allowed for legitimate emoji/script uses.
  // eslint-disable-next-line no-control-regex
  const dangerousChars = /[\x00-\x1F\x7F\u200B\u202A-\u202E\u2066-\u2069\uFEFF]/;
  if (dangerousChars.test(trimmed)) {
    return 'Name contains invalid characters.';
  }

  return null;
}

/** ID generator signature (default: crypto.randomUUID). */
type IdGenerator = () => string;

/** Clock signature (default: () => new Date().toISOString()). */
type Clock = () => string;

/**
 * Builds a fresh "no views" state (no shared mutable state).
 */
function emptyState(): SavedViewsState {
  return { version: 1, views: [] };
}

/**
 * Creates a new {@link SavedView} with id and createdAt filled by the provided
 * generators (defaults to crypto.randomUUID and () => new Date().toISOString()).
 * The injectable generators enable deterministic testing without stubbing crypto.
 */
export function createSavedView(
  input: {
    name: string;
    view: FleetView;
    filter: RepoFilterQueryV2;
    sort?: SavedView['sort'];
    density?: SavedView['density'];
  },
  idGenerator: IdGenerator = () => crypto.randomUUID(),
  clock: Clock = () => new Date().toISOString(),
): SavedView {
  return {
    id: idGenerator(),
    name: input.name,
    view: input.view,
    filter: input.filter,
    ...(input.sort !== undefined && { sort: input.sort }),
    ...(input.density !== undefined && { density: input.density }),
    createdAt: clock(),
  };
}

/**
 * Adds a view to the state, enforcing the {@link MAX_SAVED_VIEWS} cap,
 * validating the view, and rejecting duplicates (by id). Returns a new state or
 * null on rejection; the original is unchanged.
 */
export function addSavedView(state: SavedViewsState, view: SavedView): SavedViewsState | null {
  if (!SavedViewSchema.safeParse(view).success) return null;
  if (state.views.length >= MAX_SAVED_VIEWS) return null;
  if (state.views.some((v) => v.id === view.id)) return null;
  return { ...state, views: [...state.views, view] };
}

/**
 * Removes the view with the given id. Returns a new state or null when the id is
 * not found; the original is unchanged.
 */
export function removeSavedView(state: SavedViewsState, id: string): SavedViewsState | null {
  const filtered = state.views.filter((v) => v.id !== id);
  if (filtered.length === state.views.length) return null;
  return { ...state, views: filtered };
}

/**
 * Renames the view with the given id. Returns a new state or null when the id is
 * not found / name is invalid; the original is unchanged.
 */
export function renameSavedView(
  state: SavedViewsState,
  id: string,
  name: string,
): SavedViewsState | null {
  if (validateSavedViewName(name) !== null) return null;
  const index = state.views.findIndex((v) => v.id === id);
  if (index === -1) return null;
  const updated = [...state.views];
  updated[index] = { ...updated[index], name: name.trim() };
  return { ...state, views: updated };
}

/**
 * Updates the view with the given id by merging the patch. Returns a new state
 * or null when the id is not found / patch is invalid; the original is unchanged.
 */
export function updateSavedView(
  state: SavedViewsState,
  id: string,
  patch: Partial<Omit<SavedView, 'id' | 'createdAt'>>,
): SavedViewsState | null {
  if (patch.name !== undefined && validateSavedViewName(patch.name) !== null) return null;
  const index = state.views.findIndex((v) => v.id === id);
  if (index === -1) return null;
  const updated = [...state.views];
  const candidate = {
    ...updated[index],
    ...patch,
    ...(patch.name !== undefined && { name: patch.name.trim() }),
  };
  const parsed = SavedViewSchema.safeParse(candidate);
  if (!parsed.success) return null;
  updated[index] = parsed.data;
  return { ...state, views: updated };
}

/**
 * Finds the view with the given id. Returns the view or undefined if not found.
 */
export function findSavedView(state: SavedViewsState, id: string): SavedView | undefined {
  return state.views.find((v) => v.id === id);
}

/**
 * Builds the defensive, versioned store for the saved-views state. All read/write
 * failures degrade to the fallback (`{ version: 1, views: [] }`) rather than throwing.
 */
export function createSavedViewsStore(): VersionedStore<SavedViewsState> {
  return createVersionedStore<SavedViewsState>({
    key: STORAGE_KEY_V1,
    schema: SavedViewsStateSchema,
    fallback: emptyState,
  });
}
