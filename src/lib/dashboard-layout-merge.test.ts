import { describe, expect, it } from 'vitest';

import { DEFAULT_LAYOUT } from './dashboard-layout';
import { mergeLayoutGeometry } from './dashboard-layout-merge';
import type { Repo } from '../types/fleet';

function makeRepo(nameWithOwner: string): Repo {
  const [owner, name] = nameWithOwner.split('/');
  return { nameWithOwner, owner, name, isPrivate: false };
}

describe('mergeLayoutGeometry', () => {
  const repos = [makeRepo('octo/a')];

  it('writes react-grid-layout geometry back onto matching tiles', () => {
    const tiles = DEFAULT_LAYOUT(repos);
    const moved = { ...tiles[0], x: 6, y: 4, w: 4, h: 3 };
    const next = mergeLayoutGeometry(tiles, [{ i: moved.i, x: 6, y: 4, w: 4, h: 3 }]);
    expect(next[0]).toEqual(moved);
    // Non-geometry fields are preserved untouched.
    expect(next[0].signal).toBe(tiles[0].signal);
    expect(next[0].repo).toBe(tiles[0].repo);
    expect(next[0].visible).toBe(true);
  });

  it('preserves tiles with no corresponding layout item (e.g. hidden tiles)', () => {
    const tiles = DEFAULT_LAYOUT(repos);
    const next = mergeLayoutGeometry(tiles, []);
    expect(next).toEqual(tiles);
  });

  it('returns the same tile references when nothing changed', () => {
    const tiles = DEFAULT_LAYOUT(repos);
    const layout = tiles.map((t) => ({ i: t.i, x: t.x, y: t.y, w: t.w, h: t.h }));
    const next = mergeLayoutGeometry(tiles, layout);
    expect(next[0]).toBe(tiles[0]);
  });
});
