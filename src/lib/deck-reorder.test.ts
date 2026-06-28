import { describe, expect, it } from 'vitest';

import { reorderIndices } from './deck-reorder';

describe('reorderIndices', () => {
  const ids = ['octo/a', 'octo/b', 'octo/c', 'octo/d'];

  it('returns the from/to indices for a forward move', () => {
    expect(reorderIndices(ids, 'octo/a', 'octo/c')).toEqual({ from: 0, to: 2 });
  });

  it('returns the from/to indices for a backward move', () => {
    expect(reorderIndices(ids, 'octo/d', 'octo/b')).toEqual({ from: 3, to: 1 });
  });

  it('returns null when active and over are the same item (no move)', () => {
    expect(reorderIndices(ids, 'octo/b', 'octo/b')).toBeNull();
  });

  it('returns null when over is null/undefined (dropped outside)', () => {
    expect(reorderIndices(ids, 'octo/b', null)).toBeNull();
    expect(reorderIndices(ids, 'octo/b', undefined)).toBeNull();
  });

  it('returns null when an id is not in the list', () => {
    expect(reorderIndices(ids, 'octo/missing', 'octo/a')).toBeNull();
    expect(reorderIndices(ids, 'octo/a', 'octo/missing')).toBeNull();
  });

  it('accepts numeric-like ids (UniqueIdentifier) by string coercion', () => {
    expect(reorderIndices(['1', '2', '3'], '3', '1')).toEqual({ from: 2, to: 0 });
  });
});
