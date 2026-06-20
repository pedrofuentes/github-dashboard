import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Repo } from '../types/fleet';
import { DEFAULT_LAYOUT } from '../lib/dashboard-layout';
import { useDashboardLayout } from './useDashboardLayout';

const STORAGE_KEY = 'fleet:dashboard-layout';

function makeRepo(nameWithOwner: string): Repo {
  const [owner, name] = nameWithOwner.split('/');
  return { nameWithOwner, owner, name, isPrivate: false };
}

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('useDashboardLayout', () => {
  it('loads the default layout when storage is empty', () => {
    const repos = [makeRepo('octo/a')];
    const { result } = renderHook(() => useDashboardLayout(repos));
    expect(result.current.layout).toEqual(DEFAULT_LAYOUT(repos));
  });

  it('loads a previously persisted layout', () => {
    const repos = [makeRepo('octo/a'), makeRepo('octo/b')];
    const stored = DEFAULT_LAYOUT(repos).filter((t) => t.repo === 'octo/a');
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));

    const { result } = renderHook(() => useDashboardLayout(repos));
    expect(result.current.layout).toEqual(stored);
  });

  it('persists the layout when setLayout is called', () => {
    const repos = [makeRepo('octo/a')];
    const { result } = renderHook(() => useDashboardLayout(repos));

    const next = result.current.layout.map((t) => ({ ...t, visible: false }));
    act(() => {
      result.current.setLayout(next);
    });

    expect(result.current.layout).toEqual(next);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')).toEqual(next);
  });

  it('reset restores the default layout and clears storage', () => {
    const repos = [makeRepo('octo/a')];
    const { result } = renderHook(() => useDashboardLayout(repos));

    act(() => {
      result.current.setLayout([]);
    });
    expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();

    act(() => {
      result.current.reset();
    });

    expect(result.current.layout).toEqual(DEFAULT_LAYOUT(repos));
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});
