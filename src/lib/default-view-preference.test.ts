import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadDefaultView, saveDefaultView } from './default-view-preference';
import { isFleetView } from './view-preference';

const DEFAULT_VIEW_KEY = 'fleet:default-view';

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('loadDefaultView', () => {
  it('defaults to "triage" when nothing is stored', () => {
    expect(loadDefaultView()).toBe('triage');
  });

  it('reads a stored "triage" default', () => {
    localStorage.setItem(DEFAULT_VIEW_KEY, 'triage');
    expect(loadDefaultView()).toBe('triage');
  });

  it('reads a stored "grid" default', () => {
    localStorage.setItem(DEFAULT_VIEW_KEY, 'grid');
    expect(loadDefaultView()).toBe('grid');
  });

  it('reads a stored "dashboard" default', () => {
    localStorage.setItem(DEFAULT_VIEW_KEY, 'dashboard');
    expect(loadDefaultView()).toBe('dashboard');
  });

  it('reads a stored "inbox" default', () => {
    localStorage.setItem(DEFAULT_VIEW_KEY, 'inbox');
    expect(loadDefaultView()).toBe('inbox');
  });

  it('reads a stored "matrix" default', () => {
    localStorage.setItem(DEFAULT_VIEW_KEY, 'matrix');
    expect(loadDefaultView()).toBe('matrix');
  });

  it('reads a stored "deck" default', () => {
    localStorage.setItem(DEFAULT_VIEW_KEY, 'deck');
    expect(loadDefaultView()).toBe('deck');
  });

  it('falls back to "triage" for an unrecognised value', () => {
    localStorage.setItem(DEFAULT_VIEW_KEY, 'cards');
    expect(loadDefaultView()).toBe('triage');
  });

  it('falls back to "triage" when localStorage.getItem throws', () => {
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(loadDefaultView()).toBe('triage');
  });
});

describe('saveDefaultView', () => {
  it('persists the default under fleet:default-view', () => {
    saveDefaultView('inbox');
    expect(localStorage.getItem(DEFAULT_VIEW_KEY)).toBe('inbox');
  });

  it('round-trips through loadDefaultView', () => {
    saveDefaultView('grid');
    expect(loadDefaultView()).toBe('grid');
  });

  it('persists and round-trips the dashboard default', () => {
    saveDefaultView('dashboard');
    expect(localStorage.getItem(DEFAULT_VIEW_KEY)).toBe('dashboard');
    expect(loadDefaultView()).toBe('dashboard');
  });

  it('swallows localStorage.setItem throwing', () => {
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });
    expect(() => saveDefaultView('grid')).not.toThrow();
  });
});

// Folded guard coverage (view-preference.test.ts is deleted in a later PR).
describe('isFleetView', () => {
  it('accepts the six valid views', () => {
    expect(isFleetView('triage')).toBe(true);
    expect(isFleetView('grid')).toBe(true);
    expect(isFleetView('dashboard')).toBe(true);
    expect(isFleetView('inbox')).toBe(true);
    expect(isFleetView('matrix')).toBe(true);
    expect(isFleetView('deck')).toBe(true);
  });

  it('rejects unknown values and null', () => {
    expect(isFleetView('cards')).toBe(false);
    expect(isFleetView(null)).toBe(false);
  });
});
