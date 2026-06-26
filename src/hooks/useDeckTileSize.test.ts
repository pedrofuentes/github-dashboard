import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadDeckTileSize } from '../lib/deck-tile-size';
import { __resetDeckTileSizeStoreForTests, useDeckTileSize } from './useDeckTileSize';

const DECK_TILE_SIZE_KEY = 'fleet:deck-tile-size';

beforeEach(() => {
  localStorage.clear();
  __resetDeckTileSizeStoreForTests();
  vi.restoreAllMocks();
});

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('useDeckTileSize', () => {
  it('defaults to "medium" when nothing is stored', () => {
    const { result } = renderHook(() => useDeckTileSize());
    expect(result.current.size).toBe('medium');
  });

  it('initialises from the stored preference', () => {
    localStorage.setItem(DECK_TILE_SIZE_KEY, 'large');
    const { result } = renderHook(() => useDeckTileSize());
    expect(result.current.size).toBe('large');
  });

  it('persists and updates state via setSize', () => {
    const { result } = renderHook(() => useDeckTileSize());

    act(() => {
      result.current.setSize('x-small');
    });

    expect(result.current.size).toBe('x-small');
    // Assert persistence via the stored value (not a setItem spy — see #124).
    expect(localStorage.getItem(DECK_TILE_SIZE_KEY)).toBe('x-small');
  });

  it('round-trips a new size into a freshly mounted hook', () => {
    const first = renderHook(() => useDeckTileSize());

    act(() => {
      first.result.current.setSize('large');
    });

    const second = renderHook(() => useDeckTileSize());
    expect(second.result.current.size).toBe('large');
  });

  it('propagates a setSize to a second, independently mounted instance (shared store)', () => {
    const writer = renderHook(() => useDeckTileSize());
    const reader = renderHook(() => useDeckTileSize());

    expect(reader.result.current.size).toBe('medium');

    act(() => {
      writer.result.current.setSize('small');
    });

    // The reader is a SEPARATE useDeckTileSize() instance; with a shared store it
    // must re-render to the new value.
    expect(reader.result.current.size).toBe('small');
  });

  it('treats setSize to the current value as a no-op (no throw, value stable)', () => {
    const { result } = renderHook(() => useDeckTileSize());
    expect(result.current.size).toBe('medium');

    act(() => {
      result.current.setSize('medium');
    });

    expect(result.current.size).toBe('medium');
    expect(loadDeckTileSize()).toBe('medium');
  });
});
