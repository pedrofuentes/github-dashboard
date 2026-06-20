import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadViewPreference, saveViewPreference } from './view-preference';

const VIEW_KEY = 'fleet:view';

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('loadViewPreference', () => {
  it('defaults to "grid" when nothing is stored', () => {
    expect(loadViewPreference()).toBe('grid');
  });

  it('reads a stored "dashboard" preference', () => {
    localStorage.setItem(VIEW_KEY, 'dashboard');
    expect(loadViewPreference()).toBe('dashboard');
  });

  it('reads a stored "grid" preference', () => {
    localStorage.setItem(VIEW_KEY, 'grid');
    expect(loadViewPreference()).toBe('grid');
  });

  it('defaults to "grid" for an unrecognised value', () => {
    localStorage.setItem(VIEW_KEY, 'cards');
    expect(loadViewPreference()).toBe('grid');
  });

  it('survives localStorage.getItem throwing', () => {
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(loadViewPreference()).toBe('grid');
  });
});

describe('saveViewPreference', () => {
  it('persists the view', () => {
    saveViewPreference('dashboard');
    expect(localStorage.getItem(VIEW_KEY)).toBe('dashboard');
  });

  it('round-trips through loadViewPreference', () => {
    saveViewPreference('dashboard');
    expect(loadViewPreference()).toBe('dashboard');
  });

  it('swallows localStorage.setItem throwing', () => {
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });
    expect(() => saveViewPreference('grid')).not.toThrow();
  });
});
