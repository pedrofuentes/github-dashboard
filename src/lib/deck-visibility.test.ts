import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TileSignalType } from '../types/dashboard';
import {
  DECK_SIGNALS,
  MAX_HIDDEN_DECK_KEYS,
  deckKeyId,
  isHidden,
  loadHiddenDeckKeys,
  repoVisibilitySummary,
  saveHiddenDeckKeys,
  setAllHidden,
  setKeyHidden,
  setRepoHidden,
  setSignalHidden,
  showOnlySignals,
  signalVisibilitySummary,
  toggleKey,
} from './deck-visibility';

const KEY = 'fleet:deck-hidden';

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('DECK_SIGNALS', () => {
  it('is the six board signals in fixed order, excluding "activity"', () => {
    expect(DECK_SIGNALS).toEqual(['ci', 'security', 'reviews', 'pullRequests', 'issues', 'stale']);
    expect(DECK_SIGNALS).not.toContain('activity');
  });
});

describe('deckKeyId', () => {
  it('joins repo and signal as `${repo}:${signal}`', () => {
    expect(deckKeyId('octo/a', 'ci')).toBe('octo/a:ci');
    expect(deckKeyId('owner/name', 'pullRequests')).toBe('owner/name:pullRequests');
  });
});

describe('isHidden', () => {
  it('is true only when the (repo, signal) id is in the set', () => {
    const hidden = new Set(['octo/a:ci']);
    expect(isHidden(hidden, 'octo/a', 'ci')).toBe(true);
    expect(isHidden(hidden, 'octo/a', 'security')).toBe(false);
    expect(isHidden(hidden, 'octo/b', 'ci')).toBe(false);
  });
});

describe('setKeyHidden', () => {
  it('hides a key, returning a new set and leaving the input untouched', () => {
    const input = new Set<string>();
    const next = setKeyHidden(input, 'octo/a', 'ci', true);
    expect(next).not.toBe(input);
    expect(next.has('octo/a:ci')).toBe(true);
    expect(input.size).toBe(0);
  });

  it('returns the SAME set when hiding an already-hidden key (no-op stability)', () => {
    const input = new Set(['octo/a:ci']);
    expect(setKeyHidden(input, 'octo/a', 'ci', true)).toBe(input);
  });

  it('shows a key, returning a new set without the id', () => {
    const input = new Set(['octo/a:ci', 'octo/b:ci']);
    const next = setKeyHidden(input, 'octo/a', 'ci', false);
    expect(next).not.toBe(input);
    expect(next.has('octo/a:ci')).toBe(false);
    expect(next.has('octo/b:ci')).toBe(true);
    expect(input.has('octo/a:ci')).toBe(true);
  });

  it('returns the SAME set when showing an already-visible key (no-op stability)', () => {
    const input = new Set<string>();
    expect(setKeyHidden(input, 'octo/a', 'ci', false)).toBe(input);
  });
});

describe('toggleKey', () => {
  it('flips a visible key to hidden without mutating the input', () => {
    const input = new Set<string>();
    const next = toggleKey(input, 'octo/a', 'ci');
    expect(next).not.toBe(input);
    expect(next.has('octo/a:ci')).toBe(true);
    expect(input.size).toBe(0);
  });

  it('flips a hidden key back to visible', () => {
    const input = new Set(['octo/a:ci']);
    const next = toggleKey(input, 'octo/a', 'ci');
    expect(next.has('octo/a:ci')).toBe(false);
    expect(input.has('octo/a:ci')).toBe(true);
  });
});

describe('setSignalHidden', () => {
  const repos = ['octo/a', 'octo/b'];

  it('hides one signal across the given repos', () => {
    const next = setSignalHidden(new Set<string>(), repos, 'ci', true);
    expect(next).toEqual(new Set(['octo/a:ci', 'octo/b:ci']));
  });

  it('shows one signal across the given repos', () => {
    const input = new Set(['octo/a:ci', 'octo/b:ci', 'octo/a:stale']);
    const next = setSignalHidden(input, repos, 'ci', false);
    expect(next).toEqual(new Set(['octo/a:stale']));
    expect(input.has('octo/a:ci')).toBe(true);
  });

  it('clones only when at least one repo changes (partial application)', () => {
    const input = new Set(['octo/a:ci']);
    const next = setSignalHidden(input, repos, 'ci', true);
    expect(next).not.toBe(input);
    expect(next).toEqual(new Set(['octo/a:ci', 'octo/b:ci']));
    expect(input).toEqual(new Set(['octo/a:ci']));
  });

  it('returns the SAME set when every repo is already in the desired state', () => {
    const input = new Set(['octo/a:ci', 'octo/b:ci']);
    expect(setSignalHidden(input, repos, 'ci', true)).toBe(input);
  });
});

describe('setRepoHidden', () => {
  const signals: TileSignalType[] = ['ci', 'security'];

  it('hides the given signals for one repo', () => {
    const next = setRepoHidden(new Set<string>(), 'octo/a', signals, true);
    expect(next).toEqual(new Set(['octo/a:ci', 'octo/a:security']));
  });

  it('shows the given signals for one repo', () => {
    const input = new Set(['octo/a:ci', 'octo/a:security', 'octo/b:ci']);
    const next = setRepoHidden(input, 'octo/a', signals, false);
    expect(next).toEqual(new Set(['octo/b:ci']));
  });

  it('returns the SAME set when the repo is already in the desired state', () => {
    const input = new Set(['octo/a:ci', 'octo/a:security']);
    expect(setRepoHidden(input, 'octo/a', signals, true)).toBe(input);
  });
});

describe('setAllHidden', () => {
  const repos = ['octo/a', 'octo/b'];
  const signals: TileSignalType[] = ['ci', 'security'];
  const full = new Set(['octo/a:ci', 'octo/a:security', 'octo/b:ci', 'octo/b:security']);

  it('hide=true yields every (repo, signal) id', () => {
    expect(setAllHidden(new Set<string>(), repos, signals, true)).toEqual(full);
  });

  it('hide=true drops ids outside the repos×signals grid', () => {
    const input = new Set(['old/x:ci']);
    const next = setAllHidden(input, repos, signals, true);
    expect(next).toEqual(full);
    expect(next.has('old/x:ci')).toBe(false);
    expect(input).toEqual(new Set(['old/x:ci']));
  });

  it('hide=true returns the SAME set when already exactly full', () => {
    const input = new Set(full);
    expect(setAllHidden(input, repos, signals, true)).toBe(input);
  });

  it('hide=true rebuilds when the input matches the grid size but not its contents', () => {
    // Same cardinality as `full`, but one id is outside the grid: the stability
    // check must detect the mismatch and return the rebuilt full grid.
    const input = new Set(['octo/a:ci', 'octo/a:security', 'octo/b:ci', 'old/x:stale']);
    const next = setAllHidden(input, repos, signals, true);
    expect(next).toEqual(full);
    expect(next).not.toBe(input);
    expect(input.has('old/x:stale')).toBe(true);
  });

  it('hide=false yields an empty set', () => {
    const next = setAllHidden(new Set(full), repos, signals, false);
    expect(next.size).toBe(0);
  });

  it('hide=false returns the SAME set when already empty', () => {
    const input = new Set<string>();
    expect(setAllHidden(input, repos, signals, false)).toBe(input);
  });
});

describe('showOnlySignals', () => {
  const repos = ['octo/a', 'octo/b'];
  const signals: TileSignalType[] = ['ci', 'security', 'issues'];

  it('hides nothing when every signal is kept', () => {
    expect(showOnlySignals(repos, signals, new Set(signals))).toEqual(new Set());
  });

  it('hides every id when no signal is kept', () => {
    expect(showOnlySignals(repos, signals, new Set())).toEqual(
      new Set([
        'octo/a:ci',
        'octo/a:security',
        'octo/a:issues',
        'octo/b:ci',
        'octo/b:security',
        'octo/b:issues',
      ]),
    );
  });

  it('hides only the signals that are NOT in keep', () => {
    expect(showOnlySignals(repos, signals, new Set<TileSignalType>(['ci']))).toEqual(
      new Set(['octo/a:security', 'octo/a:issues', 'octo/b:security', 'octo/b:issues']),
    );
  });
});

describe('signalVisibilitySummary', () => {
  const repos = ['octo/a', 'octo/b', 'octo/c'];
  const signals: TileSignalType[] = ['ci', 'security'];

  it('reports all-shown when nothing is hidden', () => {
    expect(signalVisibilitySummary(new Set(), repos, signals)).toEqual([
      { signal: 'ci', shown: 3, total: 3 },
      { signal: 'security', shown: 3, total: 3 },
    ]);
  });

  it('counts shown per signal across the repos', () => {
    const hidden = new Set(['octo/a:ci', 'octo/b:ci']);
    expect(signalVisibilitySummary(hidden, repos, signals)).toEqual([
      { signal: 'ci', shown: 1, total: 3 },
      { signal: 'security', shown: 3, total: 3 },
    ]);
  });
});

describe('repoVisibilitySummary', () => {
  const repos = ['octo/a', 'octo/b'];
  const signals: TileSignalType[] = ['ci', 'security', 'issues'];

  it('reports all-shown when nothing is hidden', () => {
    expect(repoVisibilitySummary(new Set(), repos, signals)).toEqual([
      { repo: 'octo/a', shown: 3, total: 3 },
      { repo: 'octo/b', shown: 3, total: 3 },
    ]);
  });

  it('counts shown per repo across the signals', () => {
    const hidden = new Set(['octo/a:ci', 'octo/a:security']);
    expect(repoVisibilitySummary(hidden, repos, signals)).toEqual([
      { repo: 'octo/a', shown: 1, total: 3 },
      { repo: 'octo/b', shown: 3, total: 3 },
    ]);
  });
});

describe('loadHiddenDeckKeys', () => {
  it('defaults to an empty set when nothing is stored', () => {
    expect(loadHiddenDeckKeys()).toEqual(new Set());
  });

  it('round-trips a saved set', () => {
    saveHiddenDeckKeys(new Set(['octo/a:ci', 'octo/b:stale']));
    expect(loadHiddenDeckKeys()).toEqual(new Set(['octo/a:ci', 'octo/b:stale']));
  });

  it('falls back to an empty set on corrupt JSON', () => {
    localStorage.setItem(KEY, '{not json');
    expect(loadHiddenDeckKeys()).toEqual(new Set());
  });

  it('falls back to an empty set when the stored value is missing (null)', () => {
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(loadHiddenDeckKeys()).toEqual(new Set());
  });

  it('falls back to an empty set when the JSON is not an array', () => {
    localStorage.setItem(KEY, JSON.stringify({ 'octo/a:ci': true }));
    expect(loadHiddenDeckKeys()).toEqual(new Set());
  });

  it('falls back to an empty set when an entry is not a string', () => {
    localStorage.setItem(KEY, JSON.stringify(['octo/a:ci', 42]));
    expect(loadHiddenDeckKeys()).toEqual(new Set());
  });

  it('falls back to an empty set when an entry is an empty string', () => {
    localStorage.setItem(KEY, JSON.stringify(['']));
    expect(loadHiddenDeckKeys()).toEqual(new Set());
  });

  it('falls back to an empty set when the array exceeds MAX_HIDDEN_DECK_KEYS', () => {
    const big = Array.from({ length: MAX_HIDDEN_DECK_KEYS + 1 }, (_, i) => `octo/r${i}:ci`);
    localStorage.setItem(KEY, JSON.stringify(big));
    expect(loadHiddenDeckKeys()).toEqual(new Set());
  });

  it('falls back to an empty set when getItem throws (storage unavailable)', () => {
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(loadHiddenDeckKeys()).toEqual(new Set());
  });
});

describe('saveHiddenDeckKeys', () => {
  it('persists the hidden set as a JSON string array', () => {
    saveHiddenDeckKeys(new Set(['octo/a:ci', 'octo/b:issues']));
    const raw = localStorage.getItem(KEY);
    expect(raw).not.toBeNull();
    const parsed: unknown = JSON.parse(raw as string);
    expect(Array.isArray(parsed)).toBe(true);
    expect(new Set(parsed as string[])).toEqual(new Set(['octo/a:ci', 'octo/b:issues']));
  });

  it('round-trips an empty set', () => {
    saveHiddenDeckKeys(new Set());
    expect(loadHiddenDeckKeys()).toEqual(new Set());
  });

  it('skips writing an over-cap set, leaving the previous value intact', () => {
    saveHiddenDeckKeys(new Set(['octo/a:ci']));
    const big = new Set(
      Array.from({ length: MAX_HIDDEN_DECK_KEYS + 1 }, (_, i) => `octo/r${i}:ci`),
    );
    saveHiddenDeckKeys(big);
    expect(loadHiddenDeckKeys()).toEqual(new Set(['octo/a:ci']));
  });

  it('swallows a write failure when storage is unavailable (never throws)', () => {
    // Replace the whole Storage with a throwing stub (not a setItem spy — the
    // jsdom/memory Storage is spy-hostile for setItem; see LEARNINGS.md). Assert
    // the side-effect via the persisted value: a swallowed write persists nothing.
    const real = globalThis.localStorage;
    const throwing = {
      getItem(): string | null {
        throw new Error('blocked');
      },
      setItem(): void {
        throw new Error('blocked');
      },
      removeItem(): void {
        throw new Error('blocked');
      },
      clear(): void {
        throw new Error('blocked');
      },
      key(): string | null {
        return null;
      },
      length: 0,
    } as unknown as Storage;
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      writable: true,
      value: throwing,
    });
    try {
      expect(() => saveHiddenDeckKeys(new Set(['octo/a:ci']))).not.toThrow();
      expect(loadHiddenDeckKeys()).toEqual(new Set());
    } finally {
      Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        writable: true,
        value: real,
      });
    }
  });
});
