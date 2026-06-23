/**
 * Recent repo-filter queries. Persists the last 5 DISTINCT non-empty queries
 * to `fleet:repo-filter:recent:v1` using {@link createVersionedStore}. The list
 * is capped, deduped, and defensively validated on load — a corrupt payload
 * degrades to an empty array. {@link EMPTY_QUERY} is never recorded.
 */
import { z } from 'zod';

import {
  isQueryActive,
  RepoFilterQueryV2Schema,
  type RepoFilterQueryV2,
} from './repo-filter-query';
import { createVersionedStore, type VersionedStore } from './versioned-storage';

/** Versioned key holding the persisted recent queries. */
export const RECENT_FILTERS_STORAGE_KEY = 'fleet:repo-filter:recent:v1';

/** Maximum number of recent queries to retain. */
export const MAX_RECENT_FILTERS = 5;

/** Schema for the persisted recent-filters array (capped and Zod-validated). */
const RecentFiltersSchema = z.array(RepoFilterQueryV2Schema).max(MAX_RECENT_FILTERS);

/** Returns a fresh empty array. */
function emptyRecent(): RepoFilterQueryV2[] {
  return [];
}

/** Builds the defensive, versioned store for recent queries. */
export function createRecentFiltersStore(): VersionedStore<RepoFilterQueryV2[]> {
  return createVersionedStore<RepoFilterQueryV2[]>({
    key: RECENT_FILTERS_STORAGE_KEY,
    schema: RecentFiltersSchema,
    fallback: emptyRecent,
  });
}

/** Singleton store instance for the convenience helpers below. */
const storeInstance = createRecentFiltersStore();

/**
 * Loads the persisted recent queries. Returns an empty array on any failure.
 * Defensive: validates schema and caps at {@link MAX_RECENT_FILTERS}.
 */
export function loadRecentFilters(): RepoFilterQueryV2[] {
  return storeInstance.load();
}

/**
 * Deep-equality check for two queries: compares all fields structurally. Used
 * for deduplication, so two queries with the same content are considered equal.
 */
function queriesEqual(a: RepoFilterQueryV2, b: RepoFilterQueryV2): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Adds a non-empty query to the recent list: deduplicates (moves existing to
 * front), prepends new queries (most recent first), and caps at 5. Does NOT
 * record {@link EMPTY_QUERY} (the canonical "all repos shown" state). Persists
 * synchronously; never throws.
 *
 * @param query - The query to record. Must be active (non-empty) to be saved.
 */
export function addRecentFilter(query: RepoFilterQueryV2): void {
  // Don't record EMPTY_QUERY or inactive queries
  if (!isQueryActive(query)) {
    return;
  }

  const recents = loadRecentFilters();

  // Remove existing duplicate (if any), so re-adding moves it to the front
  const filtered = recents.filter((q) => !queriesEqual(q, query));

  // Prepend the new query (most recent first) and cap at MAX_RECENT_FILTERS
  const updated = [query, ...filtered].slice(0, MAX_RECENT_FILTERS);

  storeInstance.save(updated);
}
