import { describe, expect, it } from 'vitest';

import {
  SIGNAL_LABELS,
  arrowDirection,
  findNeighbor,
  formatMoveAnnouncement,
  formatResizeAnnouncement,
  moveCell,
  resizeCell,
} from './grid-keyboard';

const COLS = 12;

describe('moveCell', () => {
  const cell = { x: 3, y: 2, w: 3, h: 2 };

  it('moves one grid unit in each direction', () => {
    expect(moveCell(cell, 'left', COLS)).toEqual({ x: 2, y: 2, w: 3, h: 2 });
    expect(moveCell(cell, 'right', COLS)).toEqual({ x: 4, y: 2, w: 3, h: 2 });
    expect(moveCell(cell, 'up', COLS)).toEqual({ x: 3, y: 1, w: 3, h: 2 });
    expect(moveCell(cell, 'down', COLS)).toEqual({ x: 3, y: 3, w: 3, h: 2 });
  });

  it('clamps to the left edge (x never below 0)', () => {
    expect(moveCell({ x: 0, y: 0, w: 3, h: 2 }, 'left', COLS)).toEqual({ x: 0, y: 0, w: 3, h: 2 });
  });

  it('clamps to the right edge (x + w never exceeds the column count)', () => {
    // A 3-wide tile at x=9 already touches the 12-col right edge.
    expect(moveCell({ x: 9, y: 0, w: 3, h: 2 }, 'right', COLS)).toEqual({
      x: 9,
      y: 0,
      w: 3,
      h: 2,
    });
  });

  it('clamps to the top edge (y never below 0)', () => {
    expect(moveCell({ x: 0, y: 0, w: 3, h: 2 }, 'up', COLS)).toEqual({ x: 0, y: 0, w: 3, h: 2 });
  });

  it('does not cap downward movement (the grid grows vertically)', () => {
    expect(moveCell({ x: 0, y: 99, w: 3, h: 2 }, 'down', COLS)).toEqual({
      x: 0,
      y: 100,
      w: 3,
      h: 2,
    });
  });
});

describe('resizeCell', () => {
  const cell = { x: 3, y: 2, w: 3, h: 2 };

  it('grows and shrinks width and height by one unit', () => {
    expect(resizeCell(cell, 'width', 1, COLS)).toEqual({ x: 3, y: 2, w: 4, h: 2 });
    expect(resizeCell(cell, 'width', -1, COLS)).toEqual({ x: 3, y: 2, w: 2, h: 2 });
    expect(resizeCell(cell, 'height', 1, COLS)).toEqual({ x: 3, y: 2, w: 3, h: 3 });
    expect(resizeCell(cell, 'height', -1, COLS)).toEqual({ x: 3, y: 2, w: 3, h: 1 });
  });

  it('never shrinks below a single grid unit', () => {
    expect(resizeCell({ x: 0, y: 0, w: 1, h: 1 }, 'width', -1, COLS)).toEqual({
      x: 0,
      y: 0,
      w: 1,
      h: 1,
    });
    expect(resizeCell({ x: 0, y: 0, w: 1, h: 1 }, 'height', -1, COLS)).toEqual({
      x: 0,
      y: 0,
      w: 1,
      h: 1,
    });
  });

  it('never grows width past the grid right edge', () => {
    // x=10, w=2 already touches the 12-col edge.
    expect(resizeCell({ x: 10, y: 0, w: 2, h: 2 }, 'width', 1, COLS)).toEqual({
      x: 10,
      y: 0,
      w: 2,
      h: 2,
    });
  });
});

describe('findNeighbor', () => {
  // A 2x2 arrangement of 3-wide tiles on a 12-col grid.
  const cells = [
    { i: 'a', x: 0, y: 0, w: 3, h: 2 },
    { i: 'b', x: 3, y: 0, w: 3, h: 2 },
    { i: 'c', x: 0, y: 2, w: 3, h: 2 },
    { i: 'd', x: 3, y: 2, w: 3, h: 2 },
  ];

  it('finds the tile to the right', () => {
    expect(findNeighbor(cells, 'a', 'right')).toBe('b');
  });

  it('finds the tile to the left', () => {
    expect(findNeighbor(cells, 'b', 'left')).toBe('a');
  });

  it('finds the tile below', () => {
    expect(findNeighbor(cells, 'a', 'down')).toBe('c');
  });

  it('finds the tile above', () => {
    expect(findNeighbor(cells, 'c', 'up')).toBe('a');
  });

  it('returns null when there is no neighbor in that direction', () => {
    expect(findNeighbor(cells, 'a', 'left')).toBeNull();
    expect(findNeighbor(cells, 'a', 'up')).toBeNull();
  });

  it('returns null for an unknown current id', () => {
    expect(findNeighbor(cells, 'missing', 'right')).toBeNull();
  });
});

describe('arrowDirection', () => {
  it('maps arrow keys to move directions', () => {
    expect(arrowDirection('ArrowLeft')).toBe('left');
    expect(arrowDirection('ArrowRight')).toBe('right');
    expect(arrowDirection('ArrowUp')).toBe('up');
    expect(arrowDirection('ArrowDown')).toBe('down');
  });

  it('returns null for non-arrow keys', () => {
    expect(arrowDirection('Enter')).toBeNull();
    expect(arrowDirection('a')).toBeNull();
  });
});

describe('announcements', () => {
  it('formats a move announcement with 1-indexed column and row', () => {
    expect(formatMoveAnnouncement('CI', 'octo/a', 3, 0)).toBe(
      'Moved CI · octo/a to column 4, row 1',
    );
  });

  it('formats a resize announcement with the new width and height', () => {
    expect(formatResizeAnnouncement('CI', 'octo/a', 4, 3)).toBe('Resized CI · octo/a to 4 by 3');
  });

  it('exposes a human-readable label for every signal', () => {
    expect(SIGNAL_LABELS.ci).toBe('CI');
    expect(SIGNAL_LABELS.pullRequests).toBe('Pull requests');
    expect(SIGNAL_LABELS.stale).toBe('Stale');
  });
});
