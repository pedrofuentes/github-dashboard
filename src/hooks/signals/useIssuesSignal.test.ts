import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchIssueCount } from '../../api/github';
import type { Repo } from '../../types/fleet';
import { ISSUE_TRIAGE_THRESHOLD, useIssuesSignal } from './useIssuesSignal';

vi.mock('../../api/github', () => ({
  fetchIssueCount: vi.fn(),
}));

const mockFetchIssueCount = vi.mocked(fetchIssueCount);

function repo(nameWithOwner: string, isPrivate = false): Repo {
  const slash = nameWithOwner.indexOf('/');
  return {
    nameWithOwner,
    owner: nameWithOwner.slice(0, slash),
    name: nameWithOwner.slice(slash + 1),
    isPrivate,
  };
}

const ONE_REPO: Repo[] = [repo('octo/a')];

/** A promise plus its resolver/rejecter, to control async resolution order. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  mockFetchIssueCount.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useIssuesSignal', () => {
  it('returns an empty map and never fetches without a token', () => {
    const { result } = renderHook(() => useIssuesSignal(ONE_REPO, null));

    expect(result.current).toBeInstanceOf(Map);
    expect(result.current.size).toBe(0);
    expect(mockFetchIssueCount).not.toHaveBeenCalled();
  });

  it('keeps a stable empty-map identity across re-renders without a token', () => {
    const { result, rerender } = renderHook(() => useIssuesSignal(ONE_REPO, null));
    const first = result.current;

    rerender();

    expect(result.current).toBe(first);
  });

  it('returns an empty map and never fetches when there are no repos', () => {
    const { result } = renderHook(() => useIssuesSignal([], 'ghp_token'));

    expect(result.current.size).toBe(0);
    expect(mockFetchIssueCount).not.toHaveBeenCalled();
  });

  it('starts a repo in the loading state before its count resolves', () => {
    mockFetchIssueCount.mockReturnValue(deferred<number>().promise);

    const { result } = renderHook(() => useIssuesSignal(ONE_REPO, 'ghp_token'));

    expect(result.current.get('octo/a')).toEqual({ status: 'loading' });
  });

  it('derives the open count from fetchIssueCount, which excludes pull requests', async () => {
    mockFetchIssueCount.mockResolvedValue(5);

    const { result } = renderHook(() => useIssuesSignal(ONE_REPO, 'ghp_token'));

    await waitFor(() => {
      expect(result.current.get('octo/a')?.status).toBe('ready');
    });

    // The 'open' state of fetchIssueCount returns open_issues_count minus open
    // PRs, so the count we surface excludes pull requests by construction.
    expect(mockFetchIssueCount).toHaveBeenCalledWith('octo', 'a', 'ghp_token', 'open');
    expect(result.current.get('octo/a')).toMatchObject({
      status: 'ready',
      openCount: 5,
      overThreshold: false,
    });
  });

  it('damps the score for a sub-threshold backlog (issues are lower urgency)', async () => {
    mockFetchIssueCount.mockResolvedValue(8);

    const { result } = renderHook(() => useIssuesSignal(ONE_REPO, 'ghp_token'));

    await waitFor(() => {
      expect(result.current.get('octo/a')?.status).toBe('ready');
    });

    expect(result.current.get('octo/a')).toMatchObject({
      openCount: 8,
      overThreshold: false,
      score: Math.floor(8 / 4),
    });
  });

  it('flags a repo over the triage threshold and scores it by its full count', async () => {
    mockFetchIssueCount.mockResolvedValue(ISSUE_TRIAGE_THRESHOLD);

    const { result } = renderHook(() => useIssuesSignal(ONE_REPO, 'ghp_token'));

    await waitFor(() => {
      expect(result.current.get('octo/a')?.status).toBe('ready');
    });

    expect(result.current.get('octo/a')).toMatchObject({
      openCount: ISSUE_TRIAGE_THRESHOLD,
      overThreshold: true,
      score: ISSUE_TRIAGE_THRESHOLD,
    });
  });

  it('does not flag a repo one issue below the threshold', async () => {
    mockFetchIssueCount.mockResolvedValue(ISSUE_TRIAGE_THRESHOLD - 1);

    const { result } = renderHook(() => useIssuesSignal(ONE_REPO, 'ghp_token'));

    await waitFor(() => {
      expect(result.current.get('octo/a')?.status).toBe('ready');
    });

    expect(result.current.get('octo/a')?.overThreshold).toBe(false);
  });

  it('marks a repo as error when its count fetch rejects', async () => {
    mockFetchIssueCount.mockRejectedValue(new Error('boom'));

    const { result } = renderHook(() => useIssuesSignal(ONE_REPO, 'ghp_token'));

    await waitFor(() => {
      expect(result.current.get('octo/a')?.status).toBe('error');
    });

    expect(result.current.get('octo/a')?.openCount).toBeUndefined();
  });

  it('resolves each repo independently in a single map', async () => {
    mockFetchIssueCount.mockImplementation((owner) =>
      owner === 'octo' ? Promise.resolve(30) : Promise.reject(new Error('nope')),
    );

    const { result } = renderHook(() =>
      useIssuesSignal([repo('octo/a'), repo('acme/b')], 'ghp_token'),
    );

    await waitFor(() => {
      expect(result.current.get('octo/a')?.status).toBe('ready');
      expect(result.current.get('acme/b')?.status).toBe('error');
    });

    expect(result.current.get('octo/a')).toMatchObject({ openCount: 30, overThreshold: true });
  });

  it('refetches when the token changes', async () => {
    mockFetchIssueCount.mockResolvedValue(1);

    const { rerender } = renderHook(({ token }) => useIssuesSignal(ONE_REPO, token), {
      initialProps: { token: 'ghp_one' },
    });

    await waitFor(() => {
      expect(mockFetchIssueCount).toHaveBeenCalledWith('octo', 'a', 'ghp_one', 'open');
    });

    rerender({ token: 'ghp_two' });

    await waitFor(() => {
      expect(mockFetchIssueCount).toHaveBeenCalledWith('octo', 'a', 'ghp_two', 'open');
    });
  });

  it('ignores a stale response after the token changes mid-flight', async () => {
    const first = deferred<number>();
    const second = deferred<number>();
    mockFetchIssueCount.mockImplementation((_owner, _name, token) =>
      token === 'ghp_one' ? first.promise : second.promise,
    );

    const { result, rerender } = renderHook(({ token }) => useIssuesSignal(ONE_REPO, token), {
      initialProps: { token: 'ghp_one' },
    });

    rerender({ token: 'ghp_two' });

    // The current token (ghp_two) resolves first with a sub-threshold count.
    act(() => {
      second.resolve(2);
    });
    await waitFor(() => {
      expect(result.current.get('octo/a')?.status).toBe('ready');
    });
    expect(result.current.get('octo/a')?.openCount).toBe(2);

    // The superseded token (ghp_one) resolves late with an over-threshold count;
    // the generation guard must keep it from clobbering the current data.
    act(() => {
      first.resolve(999);
    });
    await new Promise((r) => setTimeout(r, 10));

    expect(result.current.get('octo/a')?.openCount).toBe(2);
    expect(result.current.get('octo/a')?.overThreshold).toBe(false);
  });

  it('clears the map when the token is removed', async () => {
    mockFetchIssueCount.mockResolvedValue(3);

    const { result, rerender } = renderHook(
      ({ token }: { token: string | null }) => useIssuesSignal(ONE_REPO, token),
      { initialProps: { token: 'ghp_token' as string | null } },
    );

    await waitFor(() => {
      expect(result.current.get('octo/a')?.status).toBe('ready');
    });

    rerender({ token: null });

    expect(result.current.size).toBe(0);
  });
});
