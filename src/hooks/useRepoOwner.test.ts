import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadRepoOwnerPreference } from '../lib/repo-owner-preference';
import { __resetRepoOwnerStoreForTests, useRepoOwner } from './useRepoOwner';

const REPO_OWNER_KEY = 'fleet:repo-owner';

beforeEach(() => {
  localStorage.clear();
  __resetRepoOwnerStoreForTests();
  vi.restoreAllMocks();
});

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('useRepoOwner', () => {
  it('defaults to "show" when nothing is stored', () => {
    const { result } = renderHook(() => useRepoOwner());
    expect(result.current.display).toBe('show');
  });

  it('initialises from the seeded localStorage value on mount', () => {
    localStorage.setItem(REPO_OWNER_KEY, 'hide');
    const { result } = renderHook(() => useRepoOwner());
    expect(result.current.display).toBe('hide');
  });

  it('persists and updates state via setDisplay', () => {
    const { result } = renderHook(() => useRepoOwner());

    act(() => {
      result.current.setDisplay('hide');
    });

    expect(result.current.display).toBe('hide');
    // Assert persistence via the stored value (not a setItem spy — see #124).
    expect(localStorage.getItem(REPO_OWNER_KEY)).toBe('hide');
  });

  it('round-trips a new display into a freshly mounted hook', () => {
    const first = renderHook(() => useRepoOwner());

    act(() => {
      first.result.current.setDisplay('hide');
    });

    const second = renderHook(() => useRepoOwner());
    expect(second.result.current.display).toBe('hide');
  });

  it('propagates a setDisplay to a second, independently mounted instance (shared store)', () => {
    const writer = renderHook(() => useRepoOwner());
    const reader = renderHook(() => useRepoOwner());

    expect(reader.result.current.display).toBe('show');

    act(() => {
      writer.result.current.setDisplay('hide');
    });

    // The reader is a SEPARATE useRepoOwner() instance; with a shared store it
    // must re-render to the new value (fails on a per-instance useState impl).
    expect(reader.result.current.display).toBe('hide');
  });

  it('treats setDisplay to the current value as a no-op (no throw, value stable)', () => {
    const { result } = renderHook(() => useRepoOwner());
    expect(result.current.display).toBe('show');

    act(() => {
      result.current.setDisplay('show');
    });

    expect(result.current.display).toBe('show');
    // Round-trip assertion (never a setItem spy — see #124).
    expect(loadRepoOwnerPreference()).toBe('show');
  });

  it('stops notifying a consumer after __resetRepoOwnerStoreForTests clears subscribers', () => {
    const writer = renderHook(() => useRepoOwner());
    const reader = renderHook(() => useRepoOwner());

    // Drop every subscriber: the reader's listener is now detached from the store.
    __resetRepoOwnerStoreForTests();

    act(() => {
      writer.result.current.setDisplay('hide');
    });

    // localStorage (the source of truth) was written, but the reader received no
    // emit, so its rendered snapshot stays at the mount-time value.
    expect(localStorage.getItem(REPO_OWNER_KEY)).toBe('hide');
    expect(reader.result.current.display).toBe('show');
  });
});
