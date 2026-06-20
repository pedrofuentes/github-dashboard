/**
 * localStorage persistence for the chosen fleet view (grid vs at-a-glance
 * dashboard, M10). Mirrors the defensive pattern in `fleet-preferences.ts`:
 * every read is validated and every failure (unavailable / corrupt storage)
 * degrades to the default rather than throwing.
 */

/** The two ways the authenticated fleet can be presented. */
export type FleetView = 'grid' | 'dashboard';

const VIEW_KEY = 'fleet:view';

/** Grid stays the default so the existing table behaviour is preserved. */
const DEFAULT_VIEW: FleetView = 'grid';

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

function isFleetView(value: string | null): value is FleetView {
  return value === 'grid' || value === 'dashboard';
}

/** Reads the stored view, defaulting to `'grid'` on any problem. */
export function loadViewPreference(): FleetView {
  const raw = safeGet(VIEW_KEY);
  return isFleetView(raw) ? raw : DEFAULT_VIEW;
}

/** Persists the active view (best-effort). */
export function saveViewPreference(view: FleetView): void {
  safeSet(VIEW_KEY, view);
}
