/**
 * Tests for the visibility-revalidation hook (src/hooks/useVisibilityRevalidate.ts).
 *
 * Drives the jsdom Page Visibility API: `document.hidden` is overridden with a
 * configurable getter so we can foreground/background the tab and assert the
 * hook fires `onRevalidate` only when the tab becomes visible, throttled by a
 * minimum interval, never on mount, and never after unmount.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_VISIBILITY_REVALIDATE_INTERVAL_MS,
  useVisibilityRevalidate,
} from './useVisibilityRevalidate';

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
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

beforeEach(() => {
  hiddenValue = false;
  defineHidden();
});

afterEach(() => {
  hiddenValue = false;
});

describe('useVisibilityRevalidate', () => {
  it('exposes a sane default throttle interval (30-60s)', () => {
    expect(DEFAULT_VISIBILITY_REVALIDATE_INTERVAL_MS).toBeGreaterThanOrEqual(30_000);
    expect(DEFAULT_VISIBILITY_REVALIDATE_INTERVAL_MS).toBeLessThanOrEqual(60_000);
  });

  it('does not fire on mount', () => {
    const onRevalidate = vi.fn();
    renderHook(() => useVisibilityRevalidate(onRevalidate));
    expect(onRevalidate).not.toHaveBeenCalled();
  });

  it('fires when the tab becomes visible and ignores hidden transitions', () => {
    const onRevalidate = vi.fn();
    renderHook(() => useVisibilityRevalidate(onRevalidate));

    setHidden(true);
    expect(onRevalidate).not.toHaveBeenCalled();

    setHidden(false);
    expect(onRevalidate).toHaveBeenCalledTimes(1);
  });

  it('throttles repeated revalidations within the minimum interval', () => {
    let clock = 0;
    const now = (): number => clock;
    const onRevalidate = vi.fn();
    renderHook(() => useVisibilityRevalidate(onRevalidate, { minIntervalMs: 45_000, now }));

    // First foreground always revalidates.
    setHidden(true);
    setHidden(false);
    expect(onRevalidate).toHaveBeenCalledTimes(1);

    // A second foreground inside the window is suppressed.
    clock = 44_000;
    setHidden(true);
    setHidden(false);
    expect(onRevalidate).toHaveBeenCalledTimes(1);

    // Past the window it revalidates again.
    clock = 90_000;
    setHidden(true);
    setHidden(false);
    expect(onRevalidate).toHaveBeenCalledTimes(2);
  });

  it('does nothing when disabled', () => {
    const onRevalidate = vi.fn();
    renderHook(() => useVisibilityRevalidate(onRevalidate, { enabled: false }));

    setHidden(true);
    setHidden(false);
    expect(onRevalidate).not.toHaveBeenCalled();
  });

  it('stops listening after unmount', () => {
    const onRevalidate = vi.fn();
    const { unmount } = renderHook(() => useVisibilityRevalidate(onRevalidate));

    unmount();
    setHidden(false);
    expect(onRevalidate).not.toHaveBeenCalled();
  });
});
