import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DECK_SIGNALS } from './deck-visibility';
import {
  loadDeckRepoOrder,
  loadDeckSignalOrder,
  moveInOrder,
  reconcileRepoOrder,
  reconcileSignalOrder,
  saveDeckRepoOrder,
  saveDeckSignalOrder,
} from './deck-order';

const REPO_ORDER_KEY = 'fleet:deck-repo-order';
const SIGNAL_ORDER_KEY = 'fleet:deck-signal-order';

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('moveInOrder', () => {
  it('moves an item from one index to a later index', () => {
    expect(moveInOrder(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
  });

  it('moves an item from one index to an earlier index', () => {
    expect(moveInOrder(['a', 'b', 'c', 'd'], 3, 1)).toEqual(['a', 'd', 'b', 'c']);
  });

  it('returns an equal array (no reorder) when from === to', () => {
    expect(moveInOrder(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'b', 'c']);
  });

  it('does not mutate the input array', () => {
    const input = ['a', 'b', 'c'];
    moveInOrder(input, 0, 2);
    expect(input).toEqual(['a', 'b', 'c']);
  });

  it('returns an equal array for out-of-range indices', () => {
    expect(moveInOrder(['a', 'b'], 5, 0)).toEqual(['a', 'b']);
    expect(moveInOrder(['a', 'b'], 0, 9)).toEqual(['a', 'b']);
  });
});

describe('reconcileRepoOrder', () => {
  const fleet = ['octo/a', 'octo/b', 'octo/c'];

  it('falls back to fleet order when nothing is saved', () => {
    expect(reconcileRepoOrder([], fleet)).toEqual(fleet);
  });

  it('honours a saved reordering of the fleet', () => {
    expect(reconcileRepoOrder(['octo/c', 'octo/a', 'octo/b'], fleet)).toEqual([
      'octo/c',
      'octo/a',
      'octo/b',
    ]);
  });

  it('appends new (unsaved) fleet repos after the saved order, in fleet order', () => {
    expect(reconcileRepoOrder(['octo/b'], fleet)).toEqual(['octo/b', 'octo/a', 'octo/c']);
  });

  it('drops saved repos that are no longer in the fleet', () => {
    expect(reconcileRepoOrder(['octo/gone', 'octo/b', 'octo/a'], fleet)).toEqual([
      'octo/b',
      'octo/a',
      'octo/c',
    ]);
  });

  it('drops duplicate saved ids, keeping the first occurrence', () => {
    expect(reconcileRepoOrder(['octo/b', 'octo/b', 'octo/a'], fleet)).toEqual([
      'octo/b',
      'octo/a',
      'octo/c',
    ]);
  });
});

describe('reconcileSignalOrder', () => {
  it('falls back to DECK_SIGNALS when nothing is saved', () => {
    expect(reconcileSignalOrder([])).toEqual(DECK_SIGNALS);
  });

  it('honours a saved reordering of the signals', () => {
    expect(reconcileSignalOrder(['stale', 'ci'])).toEqual([
      'stale',
      'ci',
      'security',
      'reviews',
      'pullRequests',
      'issues',
    ]);
  });

  it('drops unknown / non-deck signal ids', () => {
    expect(reconcileSignalOrder(['activity', 'bogus', 'issues'])).toEqual([
      'issues',
      'ci',
      'security',
      'reviews',
      'pullRequests',
      'stale',
    ]);
  });

  it('appends any deck signals missing from the saved order (in DECK_SIGNALS order)', () => {
    expect(reconcileSignalOrder(['reviews'])).toEqual([
      'reviews',
      'ci',
      'security',
      'pullRequests',
      'issues',
      'stale',
    ]);
  });
});

describe('loadDeckRepoOrder / saveDeckRepoOrder', () => {
  it('returns an empty order when nothing is stored', () => {
    expect(loadDeckRepoOrder()).toEqual([]);
  });

  it('round-trips a saved order', () => {
    saveDeckRepoOrder(['octo/b', 'octo/a']);
    expect(loadDeckRepoOrder()).toEqual(['octo/b', 'octo/a']);
  });

  it('degrades to an empty order for corrupt JSON', () => {
    localStorage.setItem(REPO_ORDER_KEY, '{not json');
    expect(loadDeckRepoOrder()).toEqual([]);
  });

  it('degrades to an empty order for a non-array / invalid payload', () => {
    localStorage.setItem(REPO_ORDER_KEY, JSON.stringify({ a: 1 }));
    expect(loadDeckRepoOrder()).toEqual([]);
  });

  it('survives localStorage.getItem throwing', () => {
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(loadDeckRepoOrder()).toEqual([]);
  });

  it('swallows localStorage.setItem throwing', () => {
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(() => saveDeckRepoOrder(['octo/a'])).not.toThrow();
  });
});

describe('loadDeckSignalOrder / saveDeckSignalOrder', () => {
  it('returns an empty order when nothing is stored', () => {
    expect(loadDeckSignalOrder()).toEqual([]);
  });

  it('round-trips a saved order', () => {
    saveDeckSignalOrder(['stale', 'ci']);
    expect(loadDeckSignalOrder()).toEqual(['stale', 'ci']);
  });

  it('degrades to an empty order for corrupt JSON', () => {
    localStorage.setItem(SIGNAL_ORDER_KEY, 'nope');
    expect(loadDeckSignalOrder()).toEqual([]);
  });
});
