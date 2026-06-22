import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import type { Repo } from '../types/fleet';
import { loadRepoFilter, saveRepoFilter } from './repo-filter-preference';

const repo = (n: string): Repo => ({ nameWithOwner: n, isPrivate: false }) as Repo;
const KEY = 'fleet:repo-filter';
const fleet = [repo('octo/a'), repo('octo/b')];

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

it('defaults to [] (all) when nothing is stored', () => {
  expect(loadRepoFilter(fleet)).toEqual([]);
});

it('round-trips a stored selection', () => {
  saveRepoFilter(['octo/a']);
  expect(loadRepoFilter(fleet)).toEqual(['octo/a']);
});

it('reconciles by dropping repos absent from the fleet', () => {
  saveRepoFilter(['octo/a', 'gone/x']);
  expect(loadRepoFilter(fleet)).toEqual(['octo/a']);
});

it('falls back to [] when reconciliation empties the set', () => {
  saveRepoFilter(['gone/x']);
  expect(loadRepoFilter(fleet)).toEqual([]);
});

it('dedupes a stored selection', () => {
  localStorage.setItem(KEY, JSON.stringify(['octo/a', 'octo/a']));
  expect(loadRepoFilter(fleet)).toEqual(['octo/a']);
});

it('falls back to [] on corrupt JSON', () => {
  localStorage.setItem(KEY, '{bad');
  expect(loadRepoFilter(fleet)).toEqual([]);
});

it('falls back to [] when getItem throws', () => {
  vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  expect(loadRepoFilter(fleet)).toEqual([]);
});

it('skips writing a non-string-array payload', () => {
  saveRepoFilter(['x'.repeat(300)]); // exceeds MAX_STRING_LENGTH
  expect(localStorage.getItem(KEY)).toBeNull();
});
