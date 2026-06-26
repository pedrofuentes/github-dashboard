import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadDeckTileSize, saveDeckTileSize } from './deck-tile-size';

const DECK_TILE_SIZE_KEY = 'fleet:deck-tile-size';

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('loadDeckTileSize', () => {
  it('defaults to "medium" when nothing is stored', () => {
    expect(loadDeckTileSize()).toBe('medium');
  });

  it.each(['x-small', 'small', 'medium', 'large'] as const)('reads a stored "%s" size', (size) => {
    localStorage.setItem(DECK_TILE_SIZE_KEY, size);
    expect(loadDeckTileSize()).toBe(size);
  });

  it('defaults to "medium" for an unrecognised value', () => {
    localStorage.setItem(DECK_TILE_SIZE_KEY, 'x-large');
    expect(loadDeckTileSize()).toBe('medium');
  });

  it('survives localStorage.getItem throwing', () => {
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(loadDeckTileSize()).toBe('medium');
  });
});

describe('saveDeckTileSize', () => {
  it('persists the size', () => {
    saveDeckTileSize('large');
    expect(localStorage.getItem(DECK_TILE_SIZE_KEY)).toBe('large');
  });

  it('round-trips through loadDeckTileSize', () => {
    saveDeckTileSize('x-small');
    expect(loadDeckTileSize()).toBe('x-small');
  });

  it('swallows localStorage.setItem throwing', () => {
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });
    expect(() => saveDeckTileSize('small')).not.toThrow();
  });
});
