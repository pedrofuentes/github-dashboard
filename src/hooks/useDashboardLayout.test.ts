import { act, renderHook } from '@testing-library/react';
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

  it('updates layout state immediately but debounces the persisted write', async () => {
    vi.useFakeTimers();
    try {
      const repos = [makeRepo('octo/a')];
      const { result } = renderHook(() => useDashboardLayout(repos));

      const next = result.current.layout.map((t) => ({ ...t, visible: false }));
      act(() => {
        result.current.setLayout(next);
      });

      // State is responsive (synchronous) for the UI...
      expect(result.current.layout).toEqual(next);
      // ...but the localStorage write is deferred until the debounce settles.
      expect(localStorage.getItem(STORAGE_KEY)).toBeNull();

      // Async advance inside `act` so the debounced persist and any pending
      // React work flush deterministically before we assert (sync
      // `advanceTimersByTime` can flake under parallel CI workers — see #122).
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });

      expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')).toEqual(next);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('coalesces a burst of rapid setLayout calls into a single persisted write', async () => {
    vi.useFakeTimers();
    const setItemSpy = vi.spyOn(localStorage, 'setItem');
    try {
      const repos = [makeRepo('octo/a')];
      const { result } = renderHook(() => useDashboardLayout(repos));
      const base = result.current.layout;

      // Simulate react-grid-layout firing onLayoutChange many times during a drag.
      act(() => {
        for (let y = 1; y <= 10; y += 1) {
          result.current.setLayout(base.map((t) => ({ ...t, y })));
        }
      });

      // No write yet — every call restarted the debounce timer.
      expect(setItemSpy).not.toHaveBeenCalledWith(STORAGE_KEY, expect.anything());

      // Async advance inside `act` so the debounced persist flushes
      // deterministically before we assert (sync `advanceTimersByTime` can flake
      // under parallel CI workers — see #122).
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });

      const writes = setItemSpy.mock.calls.filter(([key]) => key === STORAGE_KEY);
      expect(writes).toHaveLength(1);
      // The single write carries the final state.
      const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
      expect(persisted).toEqual(base.map((t) => ({ ...t, y: 10 })));
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
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

  it('reset restores the default layout and clears storage', async () => {
    vi.useFakeTimers();
    try {
      const repos = [makeRepo('octo/a')];
      const { result } = renderHook(() => useDashboardLayout(repos));

      act(() => {
        result.current.setLayout([]);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });
      expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();

      act(() => {
        result.current.reset();
      });

      expect(result.current.layout).toEqual(DEFAULT_LAYOUT(repos));
      expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
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
