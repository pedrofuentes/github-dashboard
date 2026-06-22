import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useAliases } from './useAliases';
import type { Repo } from '../types/fleet';

const repo = (n: string): Repo => ({ nameWithOwner: n, isPrivate: false }) as Repo;
const KEY = 'fleet:aliases';
beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});
afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

it('sets and persists an alias', () => {
  const { result } = renderHook(() => useAliases([repo('octo/a')]));
  act(() => result.current.setAlias('octo/a', 'Alpha'));
  expect(result.current.aliases).toEqual({ 'octo/a': 'Alpha' });
  expect(JSON.parse(localStorage.getItem(KEY) ?? '{}')).toEqual({ 'octo/a': 'Alpha' });
});

it('clear restores the default for that repo', () => {
  const { result } = renderHook(() => useAliases([repo('octo/a')]));
  act(() => result.current.setAlias('octo/a', 'Alpha'));
  act(() => result.current.clearAlias('octo/a'));
  expect(result.current.aliases['octo/a']).toBeUndefined();
});

it('reconciles when the fleet identity changes (drops absent repos for display)', () => {
  localStorage.setItem(KEY, JSON.stringify({ 'octo/a': 'Alpha', 'gone/x': 'Ghost' }));
  const { result, rerender } = renderHook(({ repos }) => useAliases(repos), {
    initialProps: { repos: [] as Repo[] },
  });
  rerender({ repos: [repo('octo/a')] });
  expect(result.current.aliases).toEqual({ 'octo/a': 'Alpha' });
});

it('does NOT persist a narrowed map while the fleet is still empty (I2 guard)', () => {
  localStorage.setItem(KEY, JSON.stringify({ 'octo/a': 'Alpha' }));
  renderHook(() => useAliases([]));
  // Reconciliation against an empty fleet must not overwrite storage.
  expect(JSON.parse(localStorage.getItem(KEY) ?? '{}')).toEqual({ 'octo/a': 'Alpha' });
});
