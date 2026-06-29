/**
 * `useTileSize` — measures a tile's own rendered box and resolves the density
 * tier (DESIGN-TILES §3.4) the tile should render at. Backed by a single
 * shared `ResizeObserver` (one module-level instance + an element→callback
 * registry) so a fleet of tiles reacts to react-grid-layout resizes without
 * spinning up one observer per tile or threading `w`/`h` units through every
 * component.
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

/** Per-element size callback the shared observer invokes when a tile resizes. */
type SizeCallback = (width: number, height: number) => void;

/**
 * Module-level registry + observer shared by every {@link useTileSize} caller.
 * A single `ResizeObserver` watches all subscribed tiles and dispatches each
 * entry to its element's callback, so a fleet of ~700 tiles costs one observer
 * instead of one-per-tile (#175 🟡#1). The observer is created lazily on the
 * first subscription and torn down when the last subscriber leaves, so the
 * module never holds a lingering observer once every tile has unmounted.
 */
const sizeRegistry = new Map<Element, SizeCallback>();
let sharedObserver: ResizeObserver | null = null;

function dispatchResize(entries: ResizeObserverEntry[]): void {
  for (const entry of entries) {
    const callback = sizeRegistry.get(entry.target);
    if (callback) {
      const { width, height } = entry.contentRect;
      callback(width, height);
    }
  }
}

function subscribeToSize(element: Element, callback: SizeCallback): () => void {
  sizeRegistry.set(element, callback);
  if (sharedObserver === null) {
    sharedObserver = new ResizeObserver(dispatchResize);
  }
  sharedObserver.observe(element);

  return () => {
    sizeRegistry.delete(element);
    sharedObserver?.unobserve(element);
    if (sizeRegistry.size === 0) {
      sharedObserver?.disconnect();
      sharedObserver = null;
    }
  };
}

/** What {@link useTileSize} returns: a ref to attach and the resolved tier. */
export interface UseTileSizeResult<T extends HTMLElement> {
  /** Attach to the element whose box drives the tier. */
  ref: RefObject<T>;
  /** The density tier for the element's current size. */
  tier: TileTier;
}

/**
 * One-time guard so the degraded fallback below logs at most once across a fleet
 * of tiles, rather than once per tile, when `ResizeObserver` is missing.
 */
let warnedResizeObserverUnavailable = false;

function warnResizeObserverUnavailable(): void {
  if (warnedResizeObserverUnavailable) {
    return;
  }
  warnedResizeObserverUnavailable = true;
  console.warn(
    'useTileSize: ResizeObserver is unavailable; tiles render at the default density tier and will not respond to resizes.',
  );
}

/**
 * Re-arm the module-level warn-once guard. The fallback above logs at most once
 * for the lifetime of the module, which makes the warning observable in
 * production but order-dependent under test (only the first RO-absent render
 * warns). Test setup calls this to reset the guard between cases so the degraded
 * path can be exercised deterministically in isolation (#359). Not used by app
 * code — the once-only behaviour is the intended runtime contract.
 */
export function resetTileSizeWarnings(): void {
  warnedResizeObserverUnavailable = false;
}

/**
 * Observe an element's size and report its {@link TileTier}. Attach the returned
 * `ref` to the element to measure. Falls back to {@link DEFAULT_TILE_TIER} when
 * `ResizeObserver` is unavailable (e.g. the jsdom test environment), warning once
 * so the degraded, resize-blind mode is observable rather than silent (#176).
 */
export function useTileSize<T extends HTMLElement = HTMLElement>(): UseTileSizeResult<T> {
  const ref = useRef<T>(null);
  const [tier, setTier] = useState<TileTier>(DEFAULT_TILE_TIER);

  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }
    if (typeof ResizeObserver === 'undefined') {
      warnResizeObserverUnavailable();
      return;
    }

    return subscribeToSize(element, (width, height) => {
      // 0x0 guard: a freshly mounted / grid-initializing / re-shown-tab element
      // can report an unmeasured 0x0 box before layout settles. Resolving it
      // would misclassify the tile as compact (width 0 <= 175) and flip
      // `data-tile-size` / drop the footer for a frame (#175 🟡#2). Keep the
      // current tier until a real, non-zero size arrives.
      if (width === 0 && height === 0) {
        return;
      }
      setTier(tierForSize(width, height));
    });
  }, []);

  return { ref, tier };
}
