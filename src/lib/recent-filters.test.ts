import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { EMPTY_QUERY } from './repo-filter-query';
import { addRecentFilter, createRecentFiltersStore, loadRecentFilters } from './recent-filters';

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe('recent-filters', () => {
  it('loads an empty array when no filters are persisted', () => {
    const recents = loadRecentFilters();
    expect(recents).toEqual([]);
  });

  it('persists and loads a non-empty query', () => {
    const query = {
      ...EMPTY_QUERY,
      text: 'search term',
    };
    addRecentFilter(query);

    const recents = loadRecentFilters();
    expect(recents).toHaveLength(1);
    expect(recents[0]).toEqual(query);
  });

  it('does not record EMPTY_QUERY', () => {
    addRecentFilter(EMPTY_QUERY);
    const recents = loadRecentFilters();
    expect(recents).toEqual([]);
  });

  it('caps the list at 5 queries', () => {
    for (let i = 1; i <= 6; i++) {
      addRecentFilter({ ...EMPTY_QUERY, text: `query ${i}` });
    }
    const recents = loadRecentFilters();
    expect(recents).toHaveLength(5);
    // Most recent first
    expect(recents[0]?.text).toBe('query 6');
    expect(recents[4]?.text).toBe('query 2');
  });

  it('deduplicates identical queries', () => {
    const query = { ...EMPTY_QUERY, text: 'search' };
    addRecentFilter(query);
    addRecentFilter(query);

    const recents = loadRecentFilters();
    expect(recents).toHaveLength(1);
  });

  it('moves an existing query to the front when re-added', () => {
    addRecentFilter({ ...EMPTY_QUERY, text: 'first' });
    addRecentFilter({ ...EMPTY_QUERY, text: 'second' });
    addRecentFilter({ ...EMPTY_QUERY, text: 'first' }); // Re-add

    const recents = loadRecentFilters();
    expect(recents).toHaveLength(2);
    expect(recents[0]?.text).toBe('first');
    expect(recents[1]?.text).toBe('second');
  });

  it('creates a versioned store with defensive loading', () => {
    const store = createRecentFiltersStore();
    expect(store.load()).toEqual([]);

    // Corrupt payload
    localStorage.setItem('fleet:repo-filter:recent:v1', 'not json');
    expect(store.load()).toEqual([]);

    // Invalid schema
    localStorage.setItem('fleet:repo-filter:recent:v1', JSON.stringify({ bad: 'data' }));
    expect(store.load()).toEqual([]);
  });

  it('defensively bounds the persisted array at load time', () => {
    const huge = Array.from({ length: 100 }, (_, i) => ({ ...EMPTY_QUERY, text: `q${i}` }));
    const store = createRecentFiltersStore();
    store.save(huge);

    const loaded = store.load();
    // Should be capped at 5
    expect(loaded).toHaveLength(5);
  });
});
