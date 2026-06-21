/**
 * localStorage persistence for the chosen tile density (DESIGN-TILES §density).
 * Mirrors the defensive pattern in `view-preference.ts` / `theme-preference.ts`:
 * every read is validated and every failure (unavailable / corrupt storage)
 * degrades to the default rather than throwing. The toggle persists the
 * preference now; tiles consume it in a later task.
 */

/** How densely the dashboard tiles present their content. */
export type Density = 'balanced' | 'glanceable';

const DENSITY_KEY = 'fleet:density';

/** Balanced stays the default so the existing tile detail is preserved. */
const DEFAULT_DENSITY: Density = 'balanced';

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

function isDensity(value: string | null): value is Density {
  return value === 'balanced' || value === 'glanceable';
}

/** Reads the stored density, defaulting to `'balanced'` on any problem. */
export function loadDensityPreference(): Density {
  const raw = safeGet(DENSITY_KEY);
  return isDensity(raw) ? raw : DEFAULT_DENSITY;
}

/** Persists the active density (best-effort). */
export function saveDensityPreference(density: Density): void {
  safeSet(DENSITY_KEY, density);
}
