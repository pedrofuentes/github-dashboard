import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DECK_TILE_MIN_PX,
  DECK_TILE_SIZE_KEY,
  loadDeckTileSize,
  saveDeckTileSize,
} from './deck-tile-size';
import type { DeckTileSize } from './deck-tile-size';

describe('DECK_TILE_MIN_PX', () => {
  const ORDER: readonly DeckTileSize[] = ['x-small', 'small', 'medium', 'large'];

  it('maps every size to a positive minimum tile width', () => {
    for (const size of ORDER) {
      expect(DECK_TILE_MIN_PX[size]).toBeGreaterThan(0);
    }
  });

  it('grows strictly from x-small up to large', () => {
    for (let i = 1; i < ORDER.length; i += 1) {
      expect(DECK_TILE_MIN_PX[ORDER[i]]).toBeGreaterThan(DECK_TILE_MIN_PX[ORDER[i - 1]]);
    }
  });

  it('keeps medium at the ~6-per-row width that reproduces the legacy layout', () => {
    // The pre-existing deck rendered six keys per row at the ~960px container
    // width; medium reproduces that, so it stays the default.
    expect(DECK_TILE_MIN_PX.medium).toBe(152);
  });

  it('pins small at 128px (one step below medium)', () => {
    expect(DECK_TILE_MIN_PX.small).toBe(128);
  });
});

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
