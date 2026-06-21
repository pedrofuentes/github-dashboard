/**
 * `useTileSize` — measures a tile's own rendered box and resolves the density
 * tier (DESIGN-TILES §3.4) the tile should render at. Backed by a
 * `ResizeObserver` so a tile reacts to react-grid-layout resizes without
 * threading `w`/`h` units through every component.
 *
 * The tier thresholds are pixel approximations of the §3.4 grid-unit triggers:
 * a compact key is ≲175px wide or ≲96px tall; an expanded card is ≳420px wide
 * (~5 grid columns) or ≳384px tall (~4 rows). The smallest dimension wins, so a
 * wide-but-short tile degrades to compact rather than over-claiming space.
 */
import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

import type { TileTier } from './types';

/** Tier used before the first measurement (and whenever measurement is absent). */
export const DEFAULT_TILE_TIER: TileTier = 'standard';

/** A tile this narrow/short collapses to the single-glyph compact key. */
const COMPACT_MAX_WIDTH = 175;
const COMPACT_MAX_HEIGHT = 96;

/** A tile this wide/tall unlocks the richest expanded visuals. */
const EXPANDED_MIN_WIDTH = 420;
const EXPANDED_MIN_HEIGHT = 384;

/**
 * Resolve a {@link TileTier} from a rendered pixel box. Compact takes priority
 * (degrade to the simpler representation when either dimension is tiny), then
 * expanded when either dimension is generous, otherwise the standard default.
 */
export function tierForSize(width: number, height: number): TileTier {
  if (width <= COMPACT_MAX_WIDTH || height <= COMPACT_MAX_HEIGHT) {
    return 'compact';
  }
  if (width >= EXPANDED_MIN_WIDTH || height >= EXPANDED_MIN_HEIGHT) {
    return 'expanded';
  }
  return 'standard';
}

/** What {@link useTileSize} returns: a ref to attach and the resolved tier. */
export interface UseTileSizeResult<T extends HTMLElement> {
  /** Attach to the element whose box drives the tier. */
  ref: RefObject<T>;
  /** The density tier for the element's current size. */
  tier: TileTier;
}

/**
 * Observe an element's size and report its {@link TileTier}. Attach the returned
 * `ref` to the element to measure. Falls back to {@link DEFAULT_TILE_TIER} when
 * `ResizeObserver` is unavailable (e.g. the jsdom test environment).
 */
export function useTileSize<T extends HTMLElement = HTMLElement>(): UseTileSizeResult<T> {
  const ref = useRef<T>(null);
  const [tier, setTier] = useState<TileTier>(DEFAULT_TILE_TIER);

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === 'undefined') {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) {
        return;
      }
      const { width, height } = entry.contentRect;
      setTier(tierForSize(width, height));
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return { ref, tier };
}
