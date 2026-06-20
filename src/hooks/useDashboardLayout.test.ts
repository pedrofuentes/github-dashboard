import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Repo } from '../types/fleet';
import { DEFAULT_LAYOUT } from '../lib/dashboard-layout';
import { useDashboardLayout } from './useDashboardLayout';

const STORAGE_KEY = 'fleet:dashboard-layout';

function makeRepo(nameWithOwner: string): Repo {
  const [owner, name] = nameWithOwner.split('/');
  return { nameWithOwner, owner, name, isPrivate: false };
}

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('useDashboardLayout', () => {
  it('loads the default layout when storage is empty', () => {
    const repos = [makeRepo('octo/a')];
    const { result } = renderHook(() => useDashboardLayout(repos));
    expect(result.current.layout).toEqual(DEFAULT_LAYOUT(repos));
  });

  it('loads a previously persisted layout', () => {
    const repos = [makeRepo('octo/a'), makeRepo('octo/b')];
    const stored = DEFAULT_LAYOUT(repos).filter((t) => t.repo === 'octo/a');
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));

    const { result } = renderHook(() => useDashboardLayout(repos));
    expect(result.current.layout).toEqual(stored);
  });

  it('updates layout state immediately but debounces the persisted write', () => {
    const repos = [makeRepo('octo/a')];
    const { result, unmount } = renderHook(() => useDashboardLayout(repos));

    const next = result.current.layout.map((t) => ({ ...t, visible: false }));
    act(() => {
      result.current.setLayout(next);
    });

    // State is responsive (synchronous) for the UI...
    expect(result.current.layout).toEqual(next);
    // ...but the localStorage write is deferred until the debounce settles.
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();

    // Unmount runs the effect cleanup → `persist.flush()`, which writes the
    // pending change synchronously. Asserting via this flush path proves the
    // debounced write eventually lands with the final state — without advancing
    // fake timers inside `act` (that flaked on the Linux CI runner — see #122).
    unmount();

    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')).toEqual(next);
  });

  it('coalesces a burst of rapid setLayout calls into a single persisted write', async () => {
    // Spy the persistence boundary (set up BEFORE render so the hook's debounced
    // `saveDashboardLayout` reference resolves to the spy). Asserting the boundary
    // is robust to platform differences in how `localStorage.setItem` is wrapped
    // under the memory shim used on Node 20 CI (see #122, LEARNINGS.md).
    const saveSpy = vi.spyOn(await import('../lib/dashboard-layout'), 'saveDashboardLayout');
    const repos = [makeRepo('octo/a')];
    const { result, unmount } = renderHook(() => useDashboardLayout(repos));
    const base = result.current.layout;

    // Simulate react-grid-layout firing onLayoutChange many times during a drag.
    act(() => {
      for (let y = 1; y <= 10; y += 1) {
        result.current.setLayout(base.map((t) => ({ ...t, y })));
      }
    });

    // No write yet — every call restarted the debounce timer.
    expect(saveSpy).not.toHaveBeenCalled();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();

    // Unmount runs the effect cleanup → `persist.flush()`, writing the single
    // pending debounced change. Await effects + microtasks so the flush settles
    // deterministically under Node 20's async cleanup on CI as well as on newer
    // local runtimes — never assert a synchronous spy count (see #122).
    await act(async () => {
      unmount();
    });

    // Exactly one coalesced write, carrying the final state.
    await waitFor(() => {
      expect(saveSpy).toHaveBeenCalledTimes(1);
      expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')).toEqual(
        base.map((t) => ({ ...t, y: 10 })),
      );
    });
  });

  it('reconciles the layout when the fleet loads after mount (#115)', () => {
    const { result, rerender } = renderHook(({ repos }) => useDashboardLayout(repos), {
      initialProps: { repos: [] as Repo[] },
    });
    // An empty fleet yields an empty default layout on first mount.
    expect(result.current.layout).toEqual([]);

    const repos = [makeRepo('octo/a')];
    rerender({ repos });

    // Once repos arrive asynchronously, the layout re-reconciles against them.
    expect(result.current.layout).toEqual(DEFAULT_LAYOUT(repos));
  });

  it('does not clobber the layout when the fleet identity is unchanged', () => {
    const repos = [makeRepo('octo/a'), makeRepo('octo/b')];
    const stored = DEFAULT_LAYOUT(repos).filter((t) => t.repo === 'octo/a');
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));

    const { result, rerender } = renderHook(({ r }) => useDashboardLayout(r), {
      initialProps: { r: repos },
    });
    expect(result.current.layout).toEqual(stored);

    // A new array reference with the same repos must not trigger re-reconciliation.
    rerender({ r: [...repos] });
    expect(result.current.layout).toEqual(stored);
  });

  it('reset restores the default layout and clears storage', () => {
    const repos = [makeRepo('octo/a')];
    // Simulate a previously persisted (non-default) layout in storage, so we can
    // assert reset clears it — no fake-timer advance needed to set this up.
    localStorage.setItem(STORAGE_KEY, JSON.stringify([]));

    const { result } = renderHook(() => useDashboardLayout(repos));
    expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();

    act(() => {
      result.current.reset();
    });

    expect(result.current.layout).toEqual(DEFAULT_LAYOUT(repos));
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('flushes the pending debounced write before reconciling on a fleet change (#126)', () => {
    vi.useFakeTimers();
    try {
      const repos = [makeRepo('octo/a')];
      const { result, rerender } = renderHook(({ r }) => useDashboardLayout(r), {
        initialProps: { r: repos },
      });

      // Simulate a drag: change the layout, scheduling a debounced persist.
      const dragged = result.current.layout.map((t) => ({ ...t, y: t.y + 10 }));
      act(() => {
        result.current.setLayout(dragged);
      });
      // The write is still pending — the debounce window has not elapsed.
      expect(localStorage.getItem(STORAGE_KEY)).toBeNull();

      // The fleet identity changes within the debounce window (a new repo loads),
      // triggering the reconcile effect. WITHOUT flushing first, reconcile would
      // read stale (empty) storage and clobber the just-dragged layout (#126).
      rerender({ r: [makeRepo('octo/a'), makeRepo('octo/b')] });

      // The pending drag write must have been flushed before reconcile read storage,
      // so the dragged layout is persisted (not lost) and survives reconciliation.
      expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')).toEqual(dragged);
      expect(result.current.layout).toEqual(dragged);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('flushes a pending debounced write on a hard page unload (#127)', () => {
    vi.useFakeTimers();
    try {
      const repos = [makeRepo('octo/a')];
      const { result } = renderHook(() => useDashboardLayout(repos));

      const next = result.current.layout.map((t) => ({ ...t, visible: false }));
      act(() => {
        result.current.setLayout(next);
      });
      // Still pending — the debounce window has not elapsed.
      expect(localStorage.getItem(STORAGE_KEY)).toBeNull();

      // A hard page close/navigate fires `beforeunload`; React never unmounts, so
      // only an explicit unload listener can flush the pending write before the
      // JS context is torn down (#127).
      act(() => {
        window.dispatchEvent(new Event('beforeunload'));
      });

      expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')).toEqual(next);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('flushes a pending debounced write on unmount so the last change is not lost', () => {
    vi.useFakeTimers();
    try {
      const repos = [makeRepo('octo/a')];
      const { result, unmount } = renderHook(() => useDashboardLayout(repos));

      const next = result.current.layout.map((t) => ({ ...t, visible: false }));
      act(() => {
        result.current.setLayout(next);
      });
      expect(localStorage.getItem(STORAGE_KEY)).toBeNull();

      unmount();

      expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')).toEqual(next);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });
});
