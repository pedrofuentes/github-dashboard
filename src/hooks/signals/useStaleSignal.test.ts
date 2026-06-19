import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { Repo } from '../../types/fleet';
import { useStaleSignal } from './useStaleSignal';

const REPOS: Repo[] = [{ nameWithOwner: 'octo/a', owner: 'octo', name: 'a', isPrivate: false }];

describe('useStaleSignal (stub)', () => {
  it('returns an empty map until issue #17 implements the stale signal', () => {
    const { result } = renderHook(() => useStaleSignal(REPOS, 'ghp_token'));
    expect(result.current).toBeInstanceOf(Map);
    expect(result.current.size).toBe(0);
  });

  it('keeps a stable map identity across re-renders', () => {
    const { result, rerender } = renderHook(() => useStaleSignal(REPOS, 'ghp_token'));
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });

  it('returns an empty map without a token (anonymous / SSR safe)', () => {
    const { result } = renderHook(() => useStaleSignal(REPOS, null));
    expect(result.current.size).toBe(0);
  });
});
