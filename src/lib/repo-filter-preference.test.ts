import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import type { Repo } from '../types/fleet';
import { MAX_REPO_FILTER, loadRepoFilter, saveRepoFilter } from './repo-filter-preference';

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

it('falls back to [] on a stored selection over the cap', () => {
  const names = Array.from({ length: MAX_REPO_FILTER + 1 }, (_, i) => `octo/r${i}`);
  localStorage.setItem(KEY, JSON.stringify(names));
  // Every name is present in the fleet, so WITHOUT the schema cap this would
  // reconcile to the full oversized array; the cap rejects the payload first,
  // degrading to the default [] rather than feeding an unbounded selection.
  expect(loadRepoFilter(names.map((n) => repo(n)))).toEqual([]);
});

it('skips writing a selection over the cap', () => {
  const names = Array.from({ length: MAX_REPO_FILTER + 1 }, (_, i) => `octo/r${i}`);
  saveRepoFilter(names);
  expect(localStorage.getItem(KEY)).toBeNull();
});
