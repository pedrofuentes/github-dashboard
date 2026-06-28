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
