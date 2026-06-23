import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadDensityPreference } from '../lib/density-preference';
import { __resetDensityStoreForTests, useDensity } from './useDensity';

const DENSITY_KEY = 'fleet:density';

beforeEach(() => {
  localStorage.clear();
  __resetDensityStoreForTests();
  vi.restoreAllMocks();
});

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('useDensity', () => {
  it('defaults to "balanced" when nothing is stored', () => {
    const { result } = renderHook(() => useDensity());
    expect(result.current.density).toBe('balanced');
  });

  it('initialises from the stored preference', () => {
    localStorage.setItem(DENSITY_KEY, 'glanceable');
    const { result } = renderHook(() => useDensity());
    expect(result.current.density).toBe('glanceable');
  });

  it('persists and updates state via setDensity', () => {
    const { result } = renderHook(() => useDensity());

    act(() => {
      result.current.setDensity('glanceable');
    });

    expect(result.current.density).toBe('glanceable');
    // Assert persistence via the stored value (not a setItem spy — see #124).
    expect(localStorage.getItem(DENSITY_KEY)).toBe('glanceable');
  });

  it('round-trips a new density into a freshly mounted hook', () => {
    const first = renderHook(() => useDensity());

    act(() => {
      first.result.current.setDensity('glanceable');
    });

    const second = renderHook(() => useDensity());
    expect(second.result.current.density).toBe('glanceable');
  });

  it('propagates a setDensity to a second, independently mounted instance (shared store)', () => {
    const writer = renderHook(() => useDensity());
    const reader = renderHook(() => useDensity());

    expect(reader.result.current.density).toBe('balanced');

    act(() => {
      writer.result.current.setDensity('glanceable');
    });

    // The reader is a SEPARATE useDensity() instance; with a shared store it must
    // re-render to the new value (this fails on the per-instance useState impl).
    expect(reader.result.current.density).toBe('glanceable');
  });

  it('treats setDensity to the current value as a no-op (no throw, value stable)', () => {
    const { result } = renderHook(() => useDensity());
    expect(result.current.density).toBe('balanced');

    act(() => {
      result.current.setDensity('balanced');
    });

    expect(result.current.density).toBe('balanced');
    // Round-trip assertion (never a setItem spy — see #124).
    expect(loadDensityPreference()).toBe('balanced');
  });
});
