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

it('does NOT narrow storage on a populated→empty transition (I2 guard)', () => {
  // A STABLE empty mount early-returns before the `repos.length === 0` guard, so
  // it can't catch a removed guard. Drive the populated→empty transition: mount
  // with repos, then re-render with [] so the effect reaches the guard with an
  // empty fleet — the saved map must survive (removing the guard would wipe it).
  localStorage.setItem(KEY, JSON.stringify({ 'octo/a': 'Alpha' }));
  const { rerender } = renderHook(({ repos }) => useAliases(repos), {
    initialProps: { repos: [repo('octo/a')] as Repo[] },
  });
  rerender({ repos: [] });
  expect(JSON.parse(localStorage.getItem(KEY) ?? '{}')).toEqual({ 'octo/a': 'Alpha' });
});

it('reconciles a pre-populated fleet on initial mount (drops absent alias for display, storage untouched)', () => {
  localStorage.setItem(KEY, JSON.stringify({ 'octo/a': 'Alpha', 'gone/x': 'Ghost' }));
  const { result } = renderHook(() => useAliases([repo('octo/a')]));
  // Like useDashboardLayout, the initial state is reconciled against the fleet
  // present at mount, so an absent repo's alias is dropped for DISPLAY...
  expect(result.current.aliases).toEqual({ 'octo/a': 'Alpha' });
  // ...but init reconciliation is display-only — it never persists the narrowed map.
  expect(JSON.parse(localStorage.getItem(KEY) ?? '{}')).toEqual({
    'octo/a': 'Alpha',
    'gone/x': 'Ghost',
  });
});
