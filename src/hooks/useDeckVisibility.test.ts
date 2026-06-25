import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { TileSignalType } from '../types/dashboard';
import { deckKeyId } from '../lib/deck-visibility';
import { useDeckVisibility } from './useDeckVisibility';

const STORAGE_KEY = 'fleet:deck-hidden';

/** Reads the persisted hidden-keys array from storage (null when unwritten). */
function readPersisted(): string[] | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw === null ? null : (JSON.parse(raw) as string[]);
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe('useDeckVisibility', () => {
  describe('seeding from storage', () => {
    it('starts with an empty hidden set when storage is empty', () => {
      const { result } = renderHook(() => useDeckVisibility());
      expect(result.current.hidden.size).toBe(0);
    });

    it('seeds the hidden set from a previously persisted key list', () => {
      const key = deckKeyId('octo/a', 'ci');
      localStorage.setItem(STORAGE_KEY, JSON.stringify([key]));

      const { result } = renderHook(() => useDeckVisibility());

      expect(result.current.hidden.has(key)).toBe(true);
      expect(result.current.hidden.size).toBe(1);
    });

    it('falls back to an empty set when storage contains invalid JSON', () => {
      localStorage.setItem(STORAGE_KEY, 'not-json');

      const { result } = renderHook(() => useDeckVisibility());

      expect(result.current.hidden.size).toBe(0);
    });
  });

  describe('toggleKey', () => {
    it('adds a hidden key and persists it', () => {
      const { result } = renderHook(() => useDeckVisibility());
      const key = deckKeyId('octo/a', 'ci');

      act(() => {
        result.current.toggleKey('octo/a', 'ci');
      });

      expect(result.current.hidden.has(key)).toBe(true);
      expect(readPersisted()).toContain(key);
    });

    it('removes a hidden key on the second toggle and persists the removal', () => {
      const key = deckKeyId('octo/a', 'ci');
      localStorage.setItem(STORAGE_KEY, JSON.stringify([key]));

      const { result } = renderHook(() => useDeckVisibility());

      act(() => {
        result.current.toggleKey('octo/a', 'ci');
      });

      expect(result.current.hidden.has(key)).toBe(false);
      expect(readPersisted()).not.toContain(key);
    });
  });

  describe('setSignal', () => {
    it('hides a signal across all given repos and persists', () => {
      const repos = ['octo/a', 'octo/b'];
      const { result } = renderHook(() => useDeckVisibility());

      act(() => {
        result.current.setSignal(repos, 'security', true);
      });

      expect(result.current.hidden.has(deckKeyId('octo/a', 'security'))).toBe(true);
      expect(result.current.hidden.has(deckKeyId('octo/b', 'security'))).toBe(true);
      const persisted = readPersisted();
      expect(persisted).toContain(deckKeyId('octo/a', 'security'));
      expect(persisted).toContain(deckKeyId('octo/b', 'security'));
    });

    it('shows a hidden signal and persists the removal', () => {
      const repos = ['octo/a'];
      const key = deckKeyId('octo/a', 'reviews');
      localStorage.setItem(STORAGE_KEY, JSON.stringify([key]));

      const { result } = renderHook(() => useDeckVisibility());

      act(() => {
        result.current.setSignal(repos, 'reviews', false);
      });

      expect(result.current.hidden.has(key)).toBe(false);
      expect(readPersisted()).not.toContain(key);
    });
  });

  describe('setRepo', () => {
    it('hides all specified signals for a repo and persists', () => {
      const signals: TileSignalType[] = ['ci', 'security'];
      const { result } = renderHook(() => useDeckVisibility());

      act(() => {
        result.current.setRepo('octo/a', signals, true);
      });

      expect(result.current.hidden.has(deckKeyId('octo/a', 'ci'))).toBe(true);
      expect(result.current.hidden.has(deckKeyId('octo/a', 'security'))).toBe(true);
      const persisted = readPersisted();
      expect(persisted).toContain(deckKeyId('octo/a', 'ci'));
      expect(persisted).toContain(deckKeyId('octo/a', 'security'));
    });

    it('shows all specified signals for a repo and persists', () => {
      const signals: TileSignalType[] = ['ci', 'security'];
      const keys = signals.map((s) => deckKeyId('octo/a', s));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(keys));

      const { result } = renderHook(() => useDeckVisibility());

      act(() => {
        result.current.setRepo('octo/a', signals, false);
      });

      expect(result.current.hidden.size).toBe(0);
      expect(readPersisted()).toHaveLength(0);
    });
  });

  describe('setAll', () => {
    it('hides all (repos × signals) keys and persists', () => {
      const repos = ['octo/a', 'octo/b'];
      const signals: TileSignalType[] = ['ci', 'reviews'];
      const { result } = renderHook(() => useDeckVisibility());

      act(() => {
        result.current.setAll(repos, signals, true);
      });

      expect(result.current.hidden.size).toBe(4);
      expect(readPersisted()).toHaveLength(4);
    });

    it('shows all keys and persists an empty array', () => {
      const repos = ['octo/a'];
      const signals: TileSignalType[] = ['ci', 'security'];
      const keys = signals.map((s) => deckKeyId('octo/a', s));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(keys));

      const { result } = renderHook(() => useDeckVisibility());

      act(() => {
        result.current.setAll(repos, signals, false);
      });

      expect(result.current.hidden.size).toBe(0);
      expect(readPersisted()).toHaveLength(0);
    });
  });

  describe('showOnly', () => {
    it('hides all signals not in `keep` and persists', () => {
      const repos = ['octo/a'];
      const signals: TileSignalType[] = ['ci', 'security', 'reviews'];
      const { result } = renderHook(() => useDeckVisibility());

      act(() => {
        result.current.showOnly(repos, signals, new Set<TileSignalType>(['ci']));
      });

      expect(result.current.hidden.has(deckKeyId('octo/a', 'security'))).toBe(true);
      expect(result.current.hidden.has(deckKeyId('octo/a', 'reviews'))).toBe(true);
      expect(result.current.hidden.has(deckKeyId('octo/a', 'ci'))).toBe(false);

      const persisted = readPersisted();
      expect(persisted).toContain(deckKeyId('octo/a', 'security'));
      expect(persisted).toContain(deckKeyId('octo/a', 'reviews'));
      expect(persisted).not.toContain(deckKeyId('octo/a', 'ci'));
    });

    it('hides the whole grid when `keep` is empty', () => {
      const repos = ['octo/a'];
      const signals: TileSignalType[] = ['ci', 'security'];
      const { result } = renderHook(() => useDeckVisibility());

      act(() => {
        result.current.showOnly(repos, signals, new Set<TileSignalType>());
      });

      expect(result.current.hidden.size).toBe(2);
    });
  });

  describe('reset', () => {
    it('clears the hidden set and persists an empty array', () => {
      const key = deckKeyId('octo/a', 'ci');
      localStorage.setItem(STORAGE_KEY, JSON.stringify([key]));

      const { result } = renderHook(() => useDeckVisibility());
      expect(result.current.hidden.size).toBe(1);

      act(() => {
        result.current.reset();
      });

      expect(result.current.hidden.size).toBe(0);
      expect(readPersisted()).toEqual([]);
    });

    it('round-trips: a freshly mounted hook reads back the empty state after reset', () => {
      const key = deckKeyId('octo/a', 'ci');
      localStorage.setItem(STORAGE_KEY, JSON.stringify([key]));

      const { result } = renderHook(() => useDeckVisibility());

      act(() => {
        result.current.reset();
      });

      const second = renderHook(() => useDeckVisibility());
      expect(second.result.current.hidden.size).toBe(0);
    });
  });

  describe('no-op stability', () => {
    it('does not change the Set instance when the transform is a no-op', () => {
      // setSignal(..., 'ci', false) on an empty set is a no-op:
      // nothing to remove → lib returns the same Set instance.
      const { result } = renderHook(() => useDeckVisibility());
      const before = result.current.hidden;

      act(() => {
        result.current.setSignal(['octo/a'], 'ci', false);
      });

      expect(result.current.hidden).toBe(before);
    });

    it('does not persist when the transform is a no-op', () => {
      const { result } = renderHook(() => useDeckVisibility());

      act(() => {
        result.current.setSignal(['octo/a'], 'ci', false);
      });

      // Storage should remain untouched (null, never written).
      expect(readPersisted()).toBeNull();
    });

    it('does not change the Set instance on reset when already empty', () => {
      const { result } = renderHook(() => useDeckVisibility());
      const before = result.current.hidden;

      act(() => {
        result.current.reset();
      });

      expect(result.current.hidden).toBe(before);
    });
  });

  describe('mutator stability', () => {
    it('all mutators keep stable references across re-renders', () => {
      const { result, rerender } = renderHook(() => useDeckVisibility());
      const { toggleKey, setSignal, setRepo, setAll, showOnly, reset } = result.current;

      rerender();

      expect(result.current.toggleKey).toBe(toggleKey);
      expect(result.current.setSignal).toBe(setSignal);
      expect(result.current.setRepo).toBe(setRepo);
      expect(result.current.setAll).toBe(setAll);
      expect(result.current.showOnly).toBe(showOnly);
      expect(result.current.reset).toBe(reset);
    });
  });

  describe('persistence round-trip', () => {
    it('changes made by mutators are readable by a freshly mounted hook', () => {
      const { result } = renderHook(() => useDeckVisibility());

      act(() => {
        result.current.toggleKey('octo/a', 'ci');
      });

      const second = renderHook(() => useDeckVisibility());
      expect(second.result.current.hidden.has(deckKeyId('octo/a', 'ci'))).toBe(true);
    });
  });
});
