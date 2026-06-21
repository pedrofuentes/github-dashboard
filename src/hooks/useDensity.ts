/**
 * React binding for the tile density preference (DESIGN-TILES §density).
 * Initialises from the persisted {@link Density} and, on every `setDensity`,
 * persists + updates React state. Mirrors {@link useTheme} minus the
 * `matchMedia` branch — density has no OS-driven source to track.
 */
import { useCallback, useState } from 'react';

import { loadDensityPreference, saveDensityPreference } from '../lib/density-preference';
import type { Density } from '../lib/density-preference';

/** Public shape returned by {@link useDensity}. */
export interface UseDensityResult {
  /** The user's current tile density (`balanced` / `glanceable`). */
  density: Density;
  /** Persists + applies a new density. */
  setDensity: (density: Density) => void;
}

/** Manages the active tile density and keeps it in sync with localStorage. */
export function useDensity(): UseDensityResult {
  const [density, setDensityState] = useState<Density>(loadDensityPreference);

  const setDensity = useCallback((next: Density) => {
    saveDensityPreference(next);
    setDensityState(next);
  }, []);

  return { density, setDensity };
}
