/**
 * Tests for the visibility-aware polling helpers (src/lib/visibility.ts).
 *
 * Uses the jsdom `document` plus fake timers. `document.hidden` is overridden
 * with a configurable getter so we can simulate the tab being backgrounded and
 * foregrounded via the Page Visibility API.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createVisibilityAwarePoller, isDocumentHidden, onVisibilityChange } from './visibility';

let hiddenValue = false;

function defineHidden(): void {
  Object.defineProperty(document, 'hidden', {
    configurable: true,
    get: () => hiddenValue,
  });
}

/** Simulate a Page Visibility transition and notify listeners. */
function setHidden(value: boolean): void {
  hiddenValue = value;
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  hiddenValue = false;
  defineHidden();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  hiddenValue = false;
});

describe('isDocumentHidden', () => {
  it('reflects document.hidden', () => {
    hiddenValue = false;
    expect(isDocumentHidden()).toBe(false);
    hiddenValue = true;
    expect(isDocumentHidden()).toBe(true);
  });
});

describe('onVisibilityChange', () => {
  it('invokes the handler with the hidden flag and stops after unsubscribe', () => {
    const handler = vi.fn();
    const off = onVisibilityChange(handler);

    setHidden(true);
    expect(handler).toHaveBeenLastCalledWith(true);
    setHidden(false);
    expect(handler).toHaveBeenLastCalledWith(false);
    expect(handler).toHaveBeenCalledTimes(2);

    off();
    setHidden(true);
    expect(handler).toHaveBeenCalledTimes(2);
  });
});

describe('createVisibilityAwarePoller', () => {
  it('ticks on each interval while visible and stops after stop()', () => {
    const onTick = vi.fn();
    const poller = createVisibilityAwarePoller({ intervalMs: 1000, onTick });

    poller.start();
    expect(onTick).not.toHaveBeenCalled(); // immediate defaults to false
    expect(poller.isRunning()).toBe(true);

    vi.advanceTimersByTime(1000);
    expect(onTick).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2000);
    expect(onTick).toHaveBeenCalledTimes(3);

    poller.stop();
    expect(poller.isRunning()).toBe(false);
    vi.advanceTimersByTime(5000);
    expect(onTick).toHaveBeenCalledTimes(3);
  });

  it('ticks immediately on start when immediate is true', () => {
    const onTick = vi.fn();
    const poller = createVisibilityAwarePoller({ intervalMs: 1000, onTick, immediate: true });

    poller.start();
    expect(onTick).toHaveBeenCalledTimes(1);

    poller.stop();
  });

  it('pauses polling while the tab is hidden and resumes when visible', () => {
    const onTick = vi.fn();
    const poller = createVisibilityAwarePoller({ intervalMs: 1000, onTick });

    poller.start();
    vi.advanceTimersByTime(1000);
    expect(onTick).toHaveBeenCalledTimes(1);

    setHidden(true);
    expect(poller.isPaused()).toBe(true);
    vi.advanceTimersByTime(5000);
    expect(onTick).toHaveBeenCalledTimes(1); // no ticks while hidden

    setHidden(false);
    expect(poller.isPaused()).toBe(false);
    expect(onTick).toHaveBeenCalledTimes(2); // runOnResume tick (default)

    vi.advanceTimersByTime(1000);
    expect(onTick).toHaveBeenCalledTimes(3);

    poller.stop();
  });

  it('does not run on resume when runOnResume is false', () => {
    const onTick = vi.fn();
    const poller = createVisibilityAwarePoller({ intervalMs: 1000, onTick, runOnResume: false });

    poller.start();
    setHidden(true);
    vi.advanceTimersByTime(3000);
    setHidden(false);
    expect(onTick).not.toHaveBeenCalled(); // no resume tick

    vi.advanceTimersByTime(1000);
    expect(onTick).toHaveBeenCalledTimes(1);

    poller.stop();
  });

  it('starts paused when the tab is already hidden, then ticks once visible', () => {
    const onTick = vi.fn();
    const poller = createVisibilityAwarePoller({ intervalMs: 1000, onTick });

    hiddenValue = true;
    poller.start();
    expect(poller.isPaused()).toBe(true);
    vi.advanceTimersByTime(3000);
    expect(onTick).not.toHaveBeenCalled();

    setHidden(false);
    expect(onTick).toHaveBeenCalledTimes(1); // runOnResume tick

    poller.stop();
  });

  it('is idempotent: calling start twice does not double the interval', () => {
    const onTick = vi.fn();
    const poller = createVisibilityAwarePoller({ intervalMs: 1000, onTick });

    poller.start();
    poller.start();
    vi.advanceTimersByTime(1000);
    expect(onTick).toHaveBeenCalledTimes(1);

    poller.stop();
  });

  it('removes its visibility listener on stop so it no longer reacts', () => {
    const onTick = vi.fn();
    const poller = createVisibilityAwarePoller({ intervalMs: 1000, onTick });

    poller.start();
    poller.stop();

    setHidden(true);
    setHidden(false);
    vi.advanceTimersByTime(5000);
    expect(onTick).not.toHaveBeenCalled();
  });
});
