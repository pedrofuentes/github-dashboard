import { render, screen, act } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TileTier } from './types';
import {
  DEFAULT_TILE_TIER,
  resetTileSizeWarningsForTesting,
  tierForSize,
  useTileSize,
} from './useTileSize';

/**
 * Test double for `ResizeObserver`. The hook now shares ONE observer across all
 * tiles (a module-level instance + an element→callback registry), so the double
 * tracks how many instances are constructed (`constructCount`) plus which
 * elements each observes, and `emitSize` targets a specific element so the
 * shared dispatcher can route the entry to the right tile.
 */
let lastObserverCallback: ResizeObserverCallback | null = null;
let constructCount = 0;
let observeCount = 0;
let unobserveCount = 0;
let disconnectCount = 0;
const observedElements = new Set<Element>();

class MockResizeObserver {
  constructor(callback: ResizeObserverCallback) {
    lastObserverCallback = callback;
    constructCount += 1;
  }
  observe(element: Element): void {
    observeCount += 1;
    observedElements.add(element);
  }
  unobserve(element: Element): void {
    unobserveCount += 1;
    observedElements.delete(element);
  }
  disconnect(): void {
    disconnectCount += 1;
    observedElements.clear();
  }
}

/**
 * Drives the shared observer with one fake entry for `target` (defaults to the
 * sole observed element). The entry carries a `target` so the shared dispatcher
 * can route the size to that element's registered callback.
 */
function emitSize(width: number, height: number, target?: Element): void {
  const element = target ?? [...observedElements][0];
  act(() => {
    lastObserverCallback?.(
      [{ target: element, contentRect: { width, height } } as unknown as ResizeObserverEntry],
      {} as ResizeObserver,
    );
  });
}

function Probe({ testId = 'probe' }: { testId?: string }): ReactElement {
  const { ref, tier } = useTileSize<HTMLDivElement>();
  return (
    <div ref={ref} data-testid={testId}>
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
  constructCount = 0;
  observeCount = 0;
  unobserveCount = 0;
  disconnectCount = 0;
  observedElements.clear();
  // Re-arm the module-level "ResizeObserver unavailable" warn-once guard so each
  // test sees a clean slate regardless of order (#359).
  resetTileSizeWarningsForTesting();
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

  // Exact-threshold cases lock the comparison operators (<= / >=) so an
  // off-by-one boundary mutation (e.g. <= → <) cannot pass undetected (#175 🟡#3).
  it('treats the exact compact width threshold (175) as compact, 176 as standard', () => {
    expect(tierForSize(175, 300)).toBe<TileTier>('compact');
    expect(tierForSize(176, 300)).toBe<TileTier>('standard');
  });

  it('treats the exact compact height threshold (96) as compact, 97 as standard', () => {
    expect(tierForSize(300, 96)).toBe<TileTier>('compact');
    expect(tierForSize(300, 97)).toBe<TileTier>('standard');
  });

  it('treats the exact expanded width threshold (420) as expanded, 419 as standard', () => {
    expect(tierForSize(420, 200)).toBe<TileTier>('expanded');
    expect(tierForSize(419, 200)).toBe<TileTier>('standard');
  });

  it('treats the exact expanded height threshold (384) as expanded, 383 as standard', () => {
    expect(tierForSize(300, 384)).toBe<TileTier>('expanded');
    expect(tierForSize(300, 383)).toBe<TileTier>('standard');
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

  it('unobserves the element and disconnects the shared observer on unmount', () => {
    vi.stubGlobal('ResizeObserver', MockResizeObserver);
    const { unmount } = render(<Probe />);
    unmount();
    expect(unobserveCount).toBe(1);
    expect(disconnectCount).toBe(1);
  });

  it('keeps the default tier when an unmeasured 0x0 box is reported on mount', () => {
    vi.stubGlobal('ResizeObserver', MockResizeObserver);
    render(<Probe />);

    // A 0x0 mount / grid-init / tab-reshow measurement must NOT misclassify the
    // tile as compact (#175 🟡#2): the tile keeps its current tier until a real
    // non-zero size arrives.
    emitSize(0, 0);
    expect(screen.getByTestId('probe')).toHaveTextContent('standard');
  });

  it('ignores a transient 0x0 measurement after a real size and keeps the last tier', () => {
    vi.stubGlobal('ResizeObserver', MockResizeObserver);
    render(<Probe />);

    emitSize(600, 500);
    expect(screen.getByTestId('probe')).toHaveTextContent('expanded');

    emitSize(0, 0);
    expect(screen.getByTestId('probe')).toHaveTextContent('expanded');
  });

  it('shares a single ResizeObserver instance across multiple tiles', () => {
    vi.stubGlobal('ResizeObserver', MockResizeObserver);
    render(
      <>
        <Probe testId="tile-a" />
        <Probe testId="tile-b" />
      </>,
    );

    // One observer for the whole fleet, but every tile is still observed (#175 🟡#1).
    expect(constructCount).toBe(1);
    expect(observeCount).toBe(2);
  });

  it('routes each shared-observer entry to its own tile by target element', () => {
    vi.stubGlobal('ResizeObserver', MockResizeObserver);
    render(
      <>
        <Probe testId="tile-a" />
        <Probe testId="tile-b" />
      </>,
    );

    const tileA = screen.getByTestId('tile-a');
    const tileB = screen.getByTestId('tile-b');
    emitSize(150, 300, tileA);
    emitSize(600, 500, tileB);

    expect(tileA).toHaveTextContent('compact');
    expect(tileB).toHaveTextContent('expanded');
  });

  it('ignores resize entries for elements that are not registered', () => {
    vi.stubGlobal('ResizeObserver', MockResizeObserver);
    render(<Probe />);

    const stranger = document.createElement('div');
    emitSize(150, 300, stranger);

    // The dispatcher skips unknown targets, so the registered probe is untouched.
    expect(screen.getByTestId('probe')).toHaveTextContent('standard');
  });

  it('falls back to the default tier and warns once when ResizeObserver is unavailable', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    render(<Probe />);

    expect(screen.getByTestId('probe')).toHaveTextContent('standard');
    // The degraded fallback (no resize observation → every tile is stuck at the
    // default tier) must be observable rather than silent (#176 🟢#4), and must
    // warn at most once even across a fleet of tiles.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatch(/ResizeObserver/);

    warn.mockRestore();
  });

  it('re-warns after resetTileSizeWarningsForTesting re-arms the once-only guard (#359)', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const first = render(<Probe />);
    expect(warn).toHaveBeenCalledTimes(1);
    first.unmount();

    // The module-level guard suppresses a SECOND warning across the fleet, so a
    // fresh mount on the same degraded environment stays silent...
    render(<Probe />);
    expect(warn).toHaveBeenCalledTimes(1);

    // ...until the test-reset hook re-arms it, after which the degraded path warns
    // again. This gives tests a deterministic way to exercise the warn-once path
    // in isolation instead of depending on being the first RO-absent render (#359).
    resetTileSizeWarningsForTesting();
    render(<Probe />);
    expect(warn).toHaveBeenCalledTimes(2);

    warn.mockRestore();
  });

  it('reconstructs a fresh shared observer after the last tile unmounts (no singleton leak)', () => {
    vi.stubGlobal('ResizeObserver', MockResizeObserver);

    const first = render(<Probe />);
    expect(constructCount).toBe(1);

    // Unmounting the only subscriber tears the shared observer down (last-out
    // disconnect + null-out the module singleton)...
    first.unmount();
    expect(disconnectCount).toBe(1);

    // ...so the next mount must lazily construct a BRAND-NEW observer rather than
    // reuse a stale, disconnected singleton. Asserting the reconstruct makes test
    // isolation explicit instead of depending solely on Testing-Library
    // auto-cleanup ordering (#346 🟢#3).
    render(<Probe />);
    expect(constructCount).toBe(2);
    expect(observeCount).toBe(2);
  });
});
