import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import type { Repo } from '../types/fleet';
import { useRepoFilter } from './useRepoFilter';

const repo = (n: string): Repo => ({ nameWithOwner: n, isPrivate: false }) as Repo;
const KEY = 'fleet:repo-filter';

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

it('toggles a repo into and out of the selection and persists', () => {
  const { result } = renderHook(() => useRepoFilter([repo('octo/a'), repo('octo/b')]));
  act(() => result.current.toggleRepo('octo/a'));
  expect([...result.current.selected]).toEqual(['octo/a']);
  expect(result.current.isActive).toBe(true);
  expect(JSON.parse(localStorage.getItem(KEY) ?? '[]')).toEqual(['octo/a']);
  act(() => result.current.toggleRepo('octo/a'));
  expect(result.current.isActive).toBe(false);
});

it('clear() empties the selection', () => {
  const { result } = renderHook(() => useRepoFilter([repo('octo/a')]));
  act(() => result.current.setSelected(['octo/a']));
  act(() => result.current.clear());
  expect(result.current.selected.size).toBe(0);
});

it('reconciles on fleet change (drops absent repos)', () => {
  localStorage.setItem(KEY, JSON.stringify(['octo/a', 'gone/x']));
  const { result, rerender } = renderHook(({ repos }) => useRepoFilter(repos), {
    initialProps: { repos: [] as Repo[] },
  });
  rerender({ repos: [repo('octo/a')] });
  expect([...result.current.selected]).toEqual(['octo/a']);
});

it('does NOT persist a narrowed set while the fleet is empty (I2 guard)', () => {
  localStorage.setItem(KEY, JSON.stringify(['octo/a']));
  renderHook(() => useRepoFilter([]));
  expect(JSON.parse(localStorage.getItem(KEY) ?? '[]')).toEqual(['octo/a']);
});

it('does NOT narrow storage on a populated→empty transition (I2 guard)', () => {
  // A STABLE empty mount early-returns before the `repos.length > 0` guard, so it
  // can't catch a removed guard. Drive the populated→empty transition: mount with
  // repos, then re-render with [] so the effect reaches the guard with an empty
  // fleet — storage must survive (removing the guard would persist the wiped set).
  localStorage.setItem(KEY, JSON.stringify(['octo/a']));
  const { rerender } = renderHook(({ repos }) => useRepoFilter(repos), {
    initialProps: { repos: [repo('octo/a')] as Repo[] },
  });
  rerender({ repos: [] });
  expect(JSON.parse(localStorage.getItem(KEY) ?? '[]')).toEqual(['octo/a']);
});
