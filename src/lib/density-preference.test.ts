import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadDensityPreference, saveDensityPreference } from './density-preference';

const DENSITY_KEY = 'fleet:density';

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('loadDensityPreference', () => {
  it('defaults to "balanced" when nothing is stored', () => {
    expect(loadDensityPreference()).toBe('balanced');
  });

  it('reads a stored "balanced" preference', () => {
    localStorage.setItem(DENSITY_KEY, 'balanced');
    expect(loadDensityPreference()).toBe('balanced');
  });

  it('reads a stored "glanceable" preference', () => {
    localStorage.setItem(DENSITY_KEY, 'glanceable');
    expect(loadDensityPreference()).toBe('glanceable');
  });

  it('defaults to "balanced" for an unrecognised value', () => {
    localStorage.setItem(DENSITY_KEY, 'compact');
    expect(loadDensityPreference()).toBe('balanced');
  });

  it('survives localStorage.getItem throwing', () => {
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(loadDensityPreference()).toBe('balanced');
  });
});

describe('saveDensityPreference', () => {
  it('persists the density', () => {
    saveDensityPreference('glanceable');
    expect(localStorage.getItem(DENSITY_KEY)).toBe('glanceable');
  });

  it('round-trips through loadDensityPreference', () => {
    saveDensityPreference('glanceable');
    expect(loadDensityPreference()).toBe('glanceable');
  });

  it('persists and round-trips the balanced density', () => {
    saveDensityPreference('balanced');
    expect(localStorage.getItem(DENSITY_KEY)).toBe('balanced');
    expect(loadDensityPreference()).toBe('balanced');
  });

  it('swallows localStorage.setItem throwing', () => {
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });
    expect(() => saveDensityPreference('glanceable')).not.toThrow();
  });
});
