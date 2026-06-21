import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useDensity } from './useDensity';

const DENSITY_KEY = 'fleet:density';

beforeEach(() => {
  localStorage.clear();
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
});
