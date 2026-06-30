import { describe, expect, it } from 'vitest';

import { reorderIndices, resolveDeckMove } from './deck-reorder';

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

describe('resolveDeckMove', () => {
  const repoIds = ['octo/a', 'octo/b', 'octo/c'];
  const columnIds = ['col:ci', 'col:security', 'col:stale'];

  it('resolves a column move when the dragged id is a column', () => {
    expect(resolveDeckMove(repoIds, columnIds, 'col:ci', 'col:stale')).toEqual({
      kind: 'column',
      from: 0,
      to: 2,
    });
  });

  it('resolves a repo (row) move when the dragged id is a repo', () => {
    expect(resolveDeckMove(repoIds, columnIds, 'octo/c', 'octo/a')).toEqual({
      kind: 'repo',
      from: 2,
      to: 0,
    });
  });

  it('returns null when dropped over nothing', () => {
    expect(resolveDeckMove(repoIds, columnIds, 'col:ci', null)).toBeNull();
    expect(resolveDeckMove(repoIds, columnIds, 'octo/a', undefined)).toBeNull();
  });

  it('returns null for a no-op (same item)', () => {
    expect(resolveDeckMove(repoIds, columnIds, 'col:ci', 'col:ci')).toBeNull();
    expect(resolveDeckMove(repoIds, columnIds, 'octo/a', 'octo/a')).toBeNull();
  });

  it('returns null when the id matches neither list', () => {
    expect(resolveDeckMove(repoIds, columnIds, 'mystery', 'octo/a')).toBeNull();
  });

  it('returns null for cross-axis drop (column id active, repo id over)', () => {
    // When a column is dragged over a repo row, the active is a columnIds member
    // so resolveDeckMove routes to the column axis, but the over (repo id) is
    // absent from columnIds (indexOf = -1) so reorderIndices returns null.
    expect(resolveDeckMove(repoIds, columnIds, 'col:ci', 'octo/a')).toBeNull();
  });

  it('returns null for cross-axis drop (repo id active, column id over)', () => {
    // When a repo is dragged over a column, the active is NOT a columnIds member
    // so resolveDeckMove routes to the repo axis, but the over (column id) is
    // absent from repoIds (indexOf = -1) so reorderIndices returns null.
    expect(resolveDeckMove(repoIds, columnIds, 'octo/a', 'col:ci')).toBeNull();
  });
});
