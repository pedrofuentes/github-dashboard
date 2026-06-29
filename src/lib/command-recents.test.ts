import { afterEach, describe, expect, it } from 'vitest';

import {
  COMMAND_RECENTS_KEY,
  MAX_COMMAND_RECENTS,
  addCommandRecent,
  createCommandRecentsStore,
} from './command-recents';

afterEach(() => {
  localStorage.clear();
});

describe('addCommandRecent', () => {
  it('prepends the most-recent id', () => {
    expect(addCommandRecent(['a', 'b'], 'c')).toEqual(['c', 'a', 'b']);
  });

  it('de-duplicates, moving a repeated id to the front', () => {
    expect(addCommandRecent(['a', 'b', 'c'], 'b')).toEqual(['b', 'a', 'c']);
  });

  it('caps the list at MAX_COMMAND_RECENTS', () => {
    const ids = Array.from({ length: MAX_COMMAND_RECENTS }, (_, i) => `id-${i}`);
    const result = addCommandRecent(ids, 'fresh');
    expect(result).toHaveLength(MAX_COMMAND_RECENTS);
    expect(result[0]).toBe('fresh');
    expect(result).not.toContain(`id-${MAX_COMMAND_RECENTS - 1}`);
  });
});

describe('createCommandRecentsStore', () => {
  it('round-trips a recents list through localStorage under the versioned key', () => {
    const store = createCommandRecentsStore();
    store.save(['nav-triage', 'filter-clear']);

    expect(localStorage.getItem(COMMAND_RECENTS_KEY)).not.toBeNull();
    expect(createCommandRecentsStore().load()).toEqual(['nav-triage', 'filter-clear']);
  });

  it('falls back to an empty list when nothing is persisted', () => {
    expect(createCommandRecentsStore().load()).toEqual([]);
  });

  it('falls back to an empty list when the persisted value is corrupt', () => {
    localStorage.setItem(COMMAND_RECENTS_KEY, '{not json');
    expect(createCommandRecentsStore().load()).toEqual([]);
  });
});
