import { render, screen, act } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TileTier } from './types';
import { DEFAULT_TILE_TIER, tierForSize, useTileSize } from './useTileSize';

/** Captures the most recent ResizeObserver callback so tests can drive it. */
let lastObserverCallback: ResizeObserverCallback | null = null;
let observeCount = 0;
let disconnectCount = 0;

class MockResizeObserver {
  constructor(callback: ResizeObserverCallback) {
    lastObserverCallback = callback;
  }
  observe(): void {
    observeCount += 1;
  }
  unobserve(): void {}
  disconnect(): void {
    disconnectCount += 1;
  }
}

/** Drives the captured observer with a single fake entry of the given size. */
function emitSize(width: number, height: number): void {
  act(() => {
    lastObserverCallback?.(
      [{ contentRect: { width, height } } as ResizeObserverEntry],
      {} as ResizeObserver,
    );
  });
}

function Probe(): ReactElement {
  const { ref, tier } = useTileSize<HTMLDivElement>();
  return (
    <div ref={ref} data-testid="probe">
      {tier}
    </div>
  );
}

// Reset shared observer bookkeeping before each test. Resetting here (rather
// than in afterEach) keeps each test isolated regardless of when Testing
// Library's auto-cleanup unmount — which itself triggers a `disconnect` — runs
// relative to our own hooks.
beforeEach(() => {
  lastObserverCallback = null;
  observeCount = 0;
  disconnectCount = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('tierForSize', () => {
  it('returns compact for narrow widths', () => {
    expect(tierForSize(160, 300)).toBe<TileTier>('compact');
  });

  it('returns compact for short heights regardless of width', () => {
    expect(tierForSize(600, 80)).toBe<TileTier>('compact');
  });

  it('returns standard for mid-size dimensions', () => {
    expect(tierForSize(300, 200)).toBe<TileTier>('standard');
  });

  it('returns expanded for wide widths', () => {
    expect(tierForSize(500, 200)).toBe<TileTier>('expanded');
  });

  it('returns expanded for tall heights', () => {
    expect(tierForSize(300, 420)).toBe<TileTier>('expanded');
  });

  it('prefers compact over expanded when one dimension is tiny', () => {
    expect(tierForSize(600, 60)).toBe<TileTier>('compact');
  });
});

describe('useTileSize', () => {
  it('defaults to the standard tier', () => {
    expect(DEFAULT_TILE_TIER).toBe<TileTier>('standard');
  });

  it('starts at the default tier before any measurement', () => {
    vi.stubGlobal('ResizeObserver', MockResizeObserver);
    render(<Probe />);
    expect(screen.getByTestId('probe')).toHaveTextContent('standard');
  });

  it('observes the element and updates the tier when the size changes', () => {
    vi.stubGlobal('ResizeObserver', MockResizeObserver);
    render(<Probe />);
    expect(observeCount).toBe(1);

    emitSize(150, 300);
    expect(screen.getByTestId('probe')).toHaveTextContent('compact');

    emitSize(600, 500);
    expect(screen.getByTestId('probe')).toHaveTextContent('expanded');
  });

  it('disconnects the observer on unmount', () => {
    vi.stubGlobal('ResizeObserver', MockResizeObserver);
    const { unmount } = render(<Probe />);
    unmount();
    expect(disconnectCount).toBe(1);
  });

  it('falls back to the default tier when ResizeObserver is unavailable', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    render(<Probe />);
    expect(screen.getByTestId('probe')).toHaveTextContent('standard');
  });
});
