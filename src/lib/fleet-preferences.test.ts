import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadFleetPreferences, saveFleetFilter, saveFleetSort } from './fleet-preferences';

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('loadFleetPreferences', () => {
  it('returns neutral defaults when nothing is stored', () => {
    expect(loadFleetPreferences()).toEqual({ sort: null, filter: '' });
  });

  it('reads a previously stored sort and filter', () => {
    localStorage.setItem('fleet:sort', JSON.stringify({ columnId: 'ci', direction: 'desc' }));
    localStorage.setItem('fleet:filter', 'octo');
    expect(loadFleetPreferences()).toEqual({
      sort: { columnId: 'ci', direction: 'desc' },
      filter: 'octo',
    });
  });

  it('ignores malformed sort JSON', () => {
    localStorage.setItem('fleet:sort', '{not json');
    expect(loadFleetPreferences().sort).toBeNull();
  });

  it('ignores a stored sort with an invalid shape', () => {
    localStorage.setItem('fleet:sort', JSON.stringify({ columnId: 5, direction: 'up' }));
    expect(loadFleetPreferences().sort).toBeNull();
  });

  it('ignores a stored sort with an invalid direction', () => {
    localStorage.setItem('fleet:sort', JSON.stringify({ columnId: 'ci', direction: 'sideways' }));
    expect(loadFleetPreferences().sort).toBeNull();
  });

  it('survives localStorage.getItem throwing', () => {
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(loadFleetPreferences()).toEqual({ sort: null, filter: '' });
  });
});

describe('saveFleetSort / saveFleetFilter', () => {
  it('persists the sort as JSON', () => {
    saveFleetSort({ columnId: 'security', direction: 'asc' });
    expect(JSON.parse(localStorage.getItem('fleet:sort') ?? 'null')).toEqual({
      columnId: 'security',
      direction: 'asc',
    });
  });

  it('persists the filter string', () => {
    saveFleetFilter('needle');
    expect(localStorage.getItem('fleet:filter')).toBe('needle');
  });

  it('round-trips through loadFleetPreferences', () => {
    saveFleetSort({ columnId: 'stale', direction: 'desc' });
    saveFleetFilter('acme');
    expect(loadFleetPreferences()).toEqual({
      sort: { columnId: 'stale', direction: 'desc' },
      filter: 'acme',
    });
  });

  it('swallows localStorage.setItem throwing', () => {
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });
    expect(() => {
      saveFleetSort({ columnId: 'ci', direction: 'asc' });
      saveFleetFilter('x');
    }).not.toThrow();
  });
});
