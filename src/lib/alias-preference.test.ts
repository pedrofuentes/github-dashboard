import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ALIAS_MAX_LENGTH,
  MAX_ALIASES,
  loadAliases,
  saveAliases,
  setAlias,
  clearAlias,
} from './alias-preference';

const KEY = 'fleet:aliases';
beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});
afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('loadAliases', () => {
  it('defaults to {} when nothing is stored', () => {
    expect(loadAliases()).toEqual({});
  });
  it('round-trips a valid map', () => {
    saveAliases({ 'octo/a': 'Alpha' });
    expect(loadAliases()).toEqual({ 'octo/a': 'Alpha' });
  });
  it('falls back to {} on corrupt JSON', () => {
    localStorage.setItem(KEY, '{not json');
    expect(loadAliases()).toEqual({});
  });
  it('falls back to {} when getItem throws', () => {
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(loadAliases()).toEqual({});
  });
  it('drops a map whose alias exceeds ALIAS_MAX_LENGTH', () => {
    localStorage.setItem(KEY, JSON.stringify({ 'octo/a': 'x'.repeat(ALIAS_MAX_LENGTH + 1) }));
    expect(loadAliases()).toEqual({});
  });
  it('drops a map exceeding MAX_ALIASES entries', () => {
    const big: Record<string, string> = {};
    for (let i = 0; i <= MAX_ALIASES; i += 1) big[`o/r${i}`] = 'a';
    localStorage.setItem(KEY, JSON.stringify(big));
    expect(loadAliases()).toEqual({});
  });
});

describe('setAlias / clearAlias', () => {
  it('setAlias trims and persists', () => {
    const next = setAlias('octo/a', '  Alpha  ');
    expect(next).toEqual({ 'octo/a': 'Alpha' });
    expect(loadAliases()).toEqual({ 'octo/a': 'Alpha' });
  });
  it('whitespace-only alias clears the entry', () => {
    setAlias('octo/a', 'Alpha');
    const next = setAlias('octo/a', '   ');
    expect(next).toEqual({});
    expect(loadAliases()).toEqual({});
  });
  it('clearAlias removes one repo, leaving others', () => {
    saveAliases({ 'octo/a': 'A', 'octo/b': 'B' });
    expect(clearAlias('octo/a')).toEqual({ 'octo/b': 'B' });
    expect(loadAliases()).toEqual({ 'octo/b': 'B' });
  });
  it('clamps an over-length alias to ALIAS_MAX_LENGTH on set', () => {
    const next = setAlias('octo/a', 'y'.repeat(ALIAS_MAX_LENGTH + 5));
    expect(next['octo/a']).toHaveLength(ALIAS_MAX_LENGTH);
  });
});

describe('saveAliases', () => {
  it('skips writing an invalid (over-length) map', () => {
    saveAliases({ 'octo/a': 'z'.repeat(ALIAS_MAX_LENGTH + 1) });
    expect(localStorage.getItem(KEY)).toBeNull();
  });
  it('swallows a setItem write failure without throwing', () => {
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });
    // safeSet's catch (alias-preference.ts) makes persistence best-effort: a
    // failing write must degrade silently, never propagate.
    expect(() => saveAliases({ 'octo/a': 'Alpha' })).not.toThrow();
  });
});

describe('setAlias under a failing write', () => {
  it('returns the computed next map but persists nothing when setItem throws', () => {
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });
    // Assert via VALUE (not a spy count — Node-20 jsdom storage is spy-hostile):
    // the in-memory result is still returned, and because the write was swallowed
    // a subsequent read sees nothing persisted.
    let next: Record<string, string> | undefined;
    expect(() => {
      next = setAlias('octo/a', 'Alpha');
    }).not.toThrow();
    expect(next).toEqual({ 'octo/a': 'Alpha' });
    expect(loadAliases()).toEqual({});
  });
});
