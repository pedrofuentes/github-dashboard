import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { Repo } from '../../types/fleet';
import { usePullRequestsSignal } from './usePullRequestsSignal';

const REPOS: Repo[] = [{ nameWithOwner: 'octo/a', owner: 'octo', name: 'a', isPrivate: false }];

describe('usePullRequestsSignal (stub)', () => {
  it('returns an empty map until issue #15 implements the pull-requests signal', () => {
    const { result } = renderHook(() => usePullRequestsSignal(REPOS, 'ghp_token'));
    expect(result.current).toBeInstanceOf(Map);
    expect(result.current.size).toBe(0);
  });

  it('keeps a stable map identity across re-renders', () => {
    const { result, rerender } = renderHook(() => usePullRequestsSignal(REPOS, 'ghp_token'));
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });

  it('returns an empty map without a token (anonymous / SSR safe)', () => {
    const { result } = renderHook(() => usePullRequestsSignal(REPOS, null));
    expect(result.current.size).toBe(0);
  });
});
