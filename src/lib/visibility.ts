/**
 * Visibility-aware polling helpers built on the Page Visibility API.
 *
 * Polling a hidden tab wastes rate-limit budget for data nobody is looking at,
 * so callers pause when `document.hidden` is true and resume on
 * `visibilitychange`. All helpers are SSR/non-DOM safe (no-ops when `document`
 * is unavailable) and framework-agnostic.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */

/** Returns true when the tab is hidden. SSR/non-DOM safe (false off-DOM). */
export function isDocumentHidden(): boolean {
  return typeof document !== 'undefined' && document.hidden === true;
}

/** Handler invoked with the current hidden state on each visibility change. */
export type VisibilityHandler = (hidden: boolean) => void;

/**
 * Subscribes to `visibilitychange`.
 *
 * @param handler - Called with `document.hidden` on each change
 * @returns An unsubscribe function (a no-op when there is no `document`)
 */
export function onVisibilityChange(handler: VisibilityHandler): () => void {
  if (typeof document === 'undefined') {
    return () => {};
  }
  const listener = (): void => handler(document.hidden);
  document.addEventListener('visibilitychange', listener);
  return () => document.removeEventListener('visibilitychange', listener);
}

/** Configuration for {@link createVisibilityAwarePoller}. */
export interface VisibilityAwarePollerOptions {
  /** Interval between ticks, in milliseconds. */
  intervalMs: number;
  /** Called on each tick (only while the tab is visible). */
  onTick: () => void;
  /** Fire a tick immediately on `start()` when visible (default `false`). */
  immediate?: boolean;
  /** Fire a tick the moment the tab becomes visible again (default `true`). */
  runOnResume?: boolean;
}

/** A started/stoppable poller that pauses itself while the tab is hidden. */
export interface VisibilityAwarePoller {
  /** Begins polling (idempotent). Starts paused if the tab is already hidden. */
  start(): void;
  /** Stops polling and removes the visibility listener (idempotent). */
  stop(): void;
  /** True between `start()` and `stop()`. */
  isRunning(): boolean;
  /** True while running but paused because the tab is hidden. */
  isPaused(): boolean;
}

/**
 * Creates a poller that runs `onTick` every `intervalMs` while the tab is
 * visible and automatically pauses/resumes across `visibilitychange`.
 *
 * @param options - {@link VisibilityAwarePollerOptions}
 * @returns A {@link VisibilityAwarePoller}
 */
export function createVisibilityAwarePoller(
  options: VisibilityAwarePollerOptions,
): VisibilityAwarePoller {
  const { intervalMs, onTick, immediate = false, runOnResume = true } = options;

  let running = false;
  let timerId: ReturnType<typeof setInterval> | null = null;

  const startTimer = (): void => {
    if (timerId !== null) return;
    timerId = setInterval(() => {
      if (!isDocumentHidden()) onTick();
    }, intervalMs);
  };

  const clearTimer = (): void => {
    if (timerId !== null) {
      clearInterval(timerId);
      timerId = null;
    }
  };

  const handleVisibilityChange = (): void => {
    if (!running) return;
    if (isDocumentHidden()) {
      clearTimer();
      return;
    }
    // Became visible again.
    if (runOnResume) onTick();
    startTimer();
  };

  const start = (): void => {
    if (running) return;
    running = true;
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }
    if (isDocumentHidden()) return; // start paused; wait for visibility
    if (immediate) onTick();
    startTimer();
  };

  const stop = (): void => {
    running = false;
    clearTimer();
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    }
  };

  return {
    start,
    stop,
    isRunning: () => running,
    isPaused: () => running && isDocumentHidden(),
  };
}
