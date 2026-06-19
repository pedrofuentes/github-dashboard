/**
 * localStorage persistence for the Fleet grid's view preferences (sort &
 * filter). All access is defensive: storage can be unavailable, full, or
 * corrupt, and the grid must degrade to sensible defaults rather than crash.
 */
import type { FleetSortState, SortDirection } from '../types/fleet';

const SORT_KEY = 'fleet:sort';
const FILTER_KEY = 'fleet:filter';

/** Persisted, validated view preferences for the grid. */
export interface FleetPreferences {
  sort: FleetSortState | null;
  filter: string;
}

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Persistence is best-effort: ignore quota / disabled-storage failures.
  }
}

function isSortDirection(value: unknown): value is SortDirection {
  return value === 'asc' || value === 'desc';
}

function parseSort(raw: string | null): FleetSortState | null {
  if (raw === null) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return null;
  }
  const candidate = parsed as Record<string, unknown>;
  if (typeof candidate.columnId === 'string' && isSortDirection(candidate.direction)) {
    return { columnId: candidate.columnId, direction: candidate.direction };
  }
  return null;
}

/** Reads and validates the stored sort + filter, defaulting on any problem. */
export function loadFleetPreferences(): FleetPreferences {
  return {
    sort: parseSort(safeGet(SORT_KEY)),
    filter: safeGet(FILTER_KEY) ?? '',
  };
}

/** Persists the active sort as JSON (best-effort). */
export function saveFleetSort(sort: FleetSortState): void {
  safeSet(SORT_KEY, JSON.stringify(sort));
}

/** Persists the active name filter (best-effort). */
export function saveFleetFilter(filter: string): void {
  safeSet(FILTER_KEY, filter);
}
