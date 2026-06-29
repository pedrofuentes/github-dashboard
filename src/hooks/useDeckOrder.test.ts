import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DECK_SIGNALS } from '../lib/deck-visibility';
import { loadDeckRepoOrder, loadDeckSignalOrder } from '../lib/deck-order';
import { useDeckOrder } from './useDeckOrder';

const fleet = ['octo/a', 'octo/b', 'octo/c'];

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('useDeckOrder', () => {
  it('defaults to fleet order and DECK_SIGNALS when nothing is stored', () => {
    const { result } = renderHook(() => useDeckOrder(fleet));
    expect(result.current.repoOrder).toEqual(fleet);
    expect(result.current.signalOrder).toEqual(DECK_SIGNALS);
  });

  it('reconciles a stored repo order against the live fleet', () => {
    const { result } = renderHook(() => useDeckOrder(fleet));
    act(() => {
      result.current.moveRepo(0, 2); // a -> after c
    });
    expect(result.current.repoOrder).toEqual(['octo/b', 'octo/c', 'octo/a']);
  });

  it('persists a repo move (reconciled, sparse) to storage', async () => {
    const { result, unmount } = renderHook(() => useDeckOrder(fleet));
    act(() => {
      result.current.moveRepo(2, 0); // c -> front
    });
    // Flush the debounced write on unmount, then assert the stored value.
    await act(async () => {
      unmount();
    });
    expect(loadDeckRepoOrder()).toEqual(['octo/c', 'octo/a', 'octo/b']);
  });

  it('reorders signal columns via moveSignal and persists', async () => {
    const { result, unmount } = renderHook(() => useDeckOrder(fleet));
    act(() => {
      result.current.moveSignal(0, 5); // ci -> last
    });
    expect(result.current.signalOrder).toEqual([
      'security',
      'reviews',
      'pullRequests',
      'issues',
      'stale',
      'ci',
    ]);
    await act(async () => {
      unmount();
    });
    expect(loadDeckSignalOrder()).toEqual([
      'security',
      'reviews',
      'pullRequests',
      'issues',
      'stale',
      'ci',
    ]);
  });

  it('appends a newly-added fleet repo at the end of a saved order', () => {
    const { result, rerender } = renderHook(({ f }) => useDeckOrder(f), {
      initialProps: { f: fleet },
    });
    act(() => {
      result.current.moveRepo(2, 0); // c, a, b
    });
    rerender({ f: [...fleet, 'octo/d'] });
    expect(result.current.repoOrder).toEqual(['octo/c', 'octo/a', 'octo/b', 'octo/d']);
  });

  it('reset() restores fleet/default order and clears storage', async () => {
    const { result, unmount } = renderHook(() => useDeckOrder(fleet));
    act(() => {
      result.current.moveRepo(0, 2);
      result.current.moveSignal(0, 3);
    });
    act(() => {
      result.current.reset();
    });
    expect(result.current.repoOrder).toEqual(fleet);
    expect(result.current.signalOrder).toEqual(DECK_SIGNALS);
    await act(async () => {
      unmount();
    });
    expect(loadDeckRepoOrder()).toEqual([]);
    expect(loadDeckSignalOrder()).toEqual([]);
  });
});

describe('useDeckOrder — hydration from persisted order (#626)', () => {
  it('hydrates repoOrder from a pre-populated fleet:deck-repo-order on mount', () => {
    // Seed localStorage BEFORE renderHook so the lazy useState initializer picks it up.
    localStorage.setItem('fleet:deck-repo-order', JSON.stringify(['octo/c', 'octo/a', 'octo/b']));
    const { result } = renderHook(() => useDeckOrder(fleet));
    expect(result.current.repoOrder).toEqual(['octo/c', 'octo/a', 'octo/b']);
  });

  it('hydrates signalOrder from a pre-populated fleet:deck-signal-order on mount', () => {
    const stored = ['stale', 'ci', 'security', 'reviews', 'pullRequests', 'issues'];
    localStorage.setItem('fleet:deck-signal-order', JSON.stringify(stored));
    const { result } = renderHook(() => useDeckOrder(fleet));
    expect(result.current.signalOrder).toEqual(stored);
  });

  it('reconciles a persisted repo order that contains stale entries against the fleet', () => {
    // 'octo/z' is not in the live fleet and must be pruned; 'octo/b' is missing
    // from the saved order and must be appended after the known entries.
    localStorage.setItem('fleet:deck-repo-order', JSON.stringify(['octo/c', 'octo/z', 'octo/a']));
    const { result } = renderHook(() => useDeckOrder(fleet));
    expect(result.current.repoOrder).toEqual(['octo/c', 'octo/a', 'octo/b']);
  });
});

describe('useDeckOrder — page-teardown flush paths (#627)', () => {
  it('flushes a pending debounced repo move on beforeunload', () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useDeckOrder(fleet));
      act(() => {
        result.current.moveRepo(2, 0); // c → front
      });
      // Debounce not yet elapsed — storage still empty.
      expect(loadDeckRepoOrder()).toEqual([]);

      // A hard page close fires beforeunload; React never unmounts, so only the
      // explicit listener flushes the pending write (mirrors useDashboardLayout).
      act(() => {
        window.dispatchEvent(new Event('beforeunload'));
      });
      expect(loadDeckRepoOrder()).toEqual(['octo/c', 'octo/a', 'octo/b']);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('flushes a pending debounced signal move on beforeunload', () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useDeckOrder(fleet));
      act(() => {
        result.current.moveSignal(0, 5); // ci → last
      });
      expect(loadDeckSignalOrder()).toEqual([]);

      act(() => {
        window.dispatchEvent(new Event('beforeunload'));
      });
      expect(loadDeckSignalOrder()).toEqual([
        'security',
        'reviews',
        'pullRequests',
        'issues',
        'stale',
        'ci',
      ]);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('flushes a pending debounced repo move on visibilitychange → hidden', () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useDeckOrder(fleet));
      act(() => {
        result.current.moveRepo(0, 2); // a → last
      });
      expect(loadDeckRepoOrder()).toEqual([]);

      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'));
      });
      expect(loadDeckRepoOrder()).toEqual(['octo/b', 'octo/c', 'octo/a']);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('does not flush on visibilitychange → visible (only hidden tears down the page)', () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useDeckOrder(fleet));
      act(() => {
        result.current.moveRepo(0, 2);
      });
      expect(loadDeckRepoOrder()).toEqual([]);

      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'));
      });
      // No flush — write remains pending.
      expect(loadDeckRepoOrder()).toEqual([]);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });
});
