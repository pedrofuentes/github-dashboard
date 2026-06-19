/**
 * Visibility-driven revalidation hook.
 *
 * When the tab returns to `visible` (Page Visibility API), data that went stale
 * while it was backgrounded should be refreshed — but cheaply. Callers pair this
 * with conditional (`If-None-Match`) fetches so a foreground revalidation is
 * mostly free `304`s against the primary rate limit. Revalidations are throttled
 * by a minimum interval so rapid focus/blur cycles can't hammer the API.
 *
 * The hook never fires on mount and never fires for hidden transitions; it is
 * SSR/non-DOM safe (it simply never subscribes when there is no `document`).
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */
import { useEffect, useRef } from 'react';

import { onVisibilityChange } from '../lib/visibility';

/** Default minimum spacing between visibility-driven revalidations. */
export const DEFAULT_VISIBILITY_REVALIDATE_INTERVAL_MS = 45_000;

/** Options for {@link useVisibilityRevalidate}. */
export interface UseVisibilityRevalidateOptions {
  /**
   * Minimum milliseconds between revalidations (throttle). The first foreground
   * always fires; subsequent ones inside this window are suppressed. Defaults to
   * {@link DEFAULT_VISIBILITY_REVALIDATE_INTERVAL_MS}.
   */
  minIntervalMs?: number;
  /** Disable the subscription entirely (default `true`). */
  enabled?: boolean;
  /** Clock source, injectable for tests (defaults to `Date.now`). */
  now?: () => number;
}

/**
 * Invokes `onRevalidate` when the tab becomes visible again, throttled by a
 * minimum interval.
 *
 * The callback, throttle interval and clock are read through refs so updating
 * them does not resubscribe (and cannot drop a pending listener); the
 * subscription lifecycle depends only on `enabled`.
 *
 * @param onRevalidate - Called when the tab foregrounds past the throttle window
 * @param options - {@link UseVisibilityRevalidateOptions}
 */
export function useVisibilityRevalidate(
  onRevalidate: () => void,
  options: UseVisibilityRevalidateOptions = {},
): void {
  const {
    minIntervalMs = DEFAULT_VISIBILITY_REVALIDATE_INTERVAL_MS,
    enabled = true,
    now = Date.now,
  } = options;

  const onRevalidateRef = useRef(onRevalidate);
  const minIntervalRef = useRef(minIntervalMs);
  const nowRef = useRef(now);
  // -Infinity so the first foreground always fires, independent of the clock base.
  const lastRunRef = useRef(Number.NEGATIVE_INFINITY);

  onRevalidateRef.current = onRevalidate;
  minIntervalRef.current = minIntervalMs;
  nowRef.current = now;

  useEffect(() => {
    if (!enabled) return undefined;

    return onVisibilityChange((hidden) => {
      if (hidden) return; // only revalidate when the tab becomes visible
      const ts = nowRef.current();
      if (ts - lastRunRef.current < minIntervalRef.current) return; // throttled
      lastRunRef.current = ts;
      onRevalidateRef.current();
    });
  }, [enabled]);
}
