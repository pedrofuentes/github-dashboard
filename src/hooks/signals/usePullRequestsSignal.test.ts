import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchWithETag } from '../../api/github';
import type { Repo } from '../../types/fleet';
import { usePullRequestsSignal } from './usePullRequestsSignal';

vi.mock('../../api/github', () => ({
  fetchWithETag: vi.fn(),
  GITHUB_API_BASE: 'https://api.github.com',
}));

const mockFetchWithETag = vi.mocked(fetchWithETag);

/** Builds a minimal `/pulls` item carrying the fields the signal reads. */
function pull(number: number, authorAssociation: string, draft = false): unknown {
  return {
    number,
    user: { login: `user-${number}` },
    author_association: authorAssociation,
    draft,
    html_url: `https://github.com/octo/a/pull/${number}`,
  };
}

const REPOS: Repo[] = [{ nameWithOwner: 'octo/a', owner: 'octo', name: 'a', isPrivate: false }];
const TWO_REPOS: Repo[] = [
  { nameWithOwner: 'octo/a', owner: 'octo', name: 'a', isPrivate: false },
  { nameWithOwner: 'octo/b', owner: 'octo', name: 'b', isPrivate: true },
];

beforeEach(() => {
  mockFetchWithETag.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('usePullRequestsSignal', () => {
  it('returns an empty map and fetches nothing without a token', async () => {
    const { result } = renderHook(() => usePullRequestsSignal(REPOS, null));

    await waitFor(() => {
      expect(result.current).toBeInstanceOf(Map);
    });
    expect(result.current.size).toBe(0);
    expect(mockFetchWithETag).not.toHaveBeenCalled();
  });

  it('starts each repo loading, then resolves to a ready slice', async () => {
    mockFetchWithETag.mockResolvedValue([pull(1, 'OWNER'), pull(2, 'MEMBER')]);

    const { result } = renderHook(() => usePullRequestsSignal(REPOS, 'ghp_token'));

    expect(result.current.get('octo/a')?.status).toBe('loading');

    await waitFor(() => {
      expect(result.current.get('octo/a')?.status).toBe('ready');
    });
    const slice = result.current.get('octo/a');
    expect(slice?.openCount).toBe(2);
    expect(slice?.externalCount).toBe(0);
  });

  it('requests open PRs (per_page=100) for each repo with the token', async () => {
    mockFetchWithETag.mockResolvedValue([]);

    renderHook(() => usePullRequestsSignal(REPOS, 'ghp_token'));

    await waitFor(() => {
      expect(mockFetchWithETag).toHaveBeenCalledTimes(1);
    });
    const [url, , options] = mockFetchWithETag.mock.calls[0];
    expect(url).toBe('https://api.github.com/repos/octo/a/pulls?state=open&per_page=100');
    expect(options).toMatchObject({ token: 'ghp_token' });
  });

  it('counts only new outside-contributor associations as external', async () => {
    mockFetchWithETag.mockResolvedValue([
      pull(1, 'OWNER'),
      pull(2, 'MEMBER'),
      pull(3, 'COLLABORATOR'),
      pull(4, 'CONTRIBUTOR'),
      pull(5, 'FIRST_TIME_CONTRIBUTOR'),
      pull(6, 'FIRST_TIMER'),
      pull(7, 'NONE'),
      pull(8, 'MANNEQUIN'),
    ]);

    const { result } = renderHook(() => usePullRequestsSignal(REPOS, 'ghp_token'));

    await waitFor(() => {
      expect(result.current.get('octo/a')?.status).toBe('ready');
    });
    const slice = result.current.get('octo/a');
    // 8 open PRs total; only the 4 new-outsider associations count as external.
    expect(slice?.openCount).toBe(8);
    expect(slice?.externalCount).toBe(4);
  });

  it('scores external PRs five times heavier than the open total', async () => {
    mockFetchWithETag.mockResolvedValue([
      pull(1, 'MEMBER'),
      pull(2, 'NONE'),
      pull(3, 'FIRST_TIME_CONTRIBUTOR'),
    ]);

    const { result } = renderHook(() => usePullRequestsSignal(REPOS, 'ghp_token'));

    await waitFor(() => {
      expect(result.current.get('octo/a')?.status).toBe('ready');
    });
    // openCount 3, externalCount 2 → 2*5 + 3 = 13
    expect(result.current.get('octo/a')?.score).toBe(13);
  });

  it('excludes draft PRs from both the open and external counts', async () => {
    mockFetchWithETag.mockResolvedValue([
      pull(1, 'MEMBER', false),
      pull(2, 'NONE', true), // draft from a brand-new contributor → not counted
      pull(3, 'FIRST_TIMER', false),
    ]);

    const { result } = renderHook(() => usePullRequestsSignal(REPOS, 'ghp_token'));

    await waitFor(() => {
      expect(result.current.get('octo/a')?.status).toBe('ready');
    });
    const slice = result.current.get('octo/a');
    expect(slice?.openCount).toBe(2);
    expect(slice?.externalCount).toBe(1);
  });

  it('reports zero counts for a repo with no open PRs', async () => {
    mockFetchWithETag.mockResolvedValue([]);

    const { result } = renderHook(() => usePullRequestsSignal(REPOS, 'ghp_token'));

    await waitFor(() => {
      expect(result.current.get('octo/a')?.status).toBe('ready');
    });
    const slice = result.current.get('octo/a');
    expect(slice?.openCount).toBe(0);
    expect(slice?.externalCount).toBe(0);
    expect(slice?.score).toBe(0);
  });

  it('marks a repo as error when its fetch rejects', async () => {
    mockFetchWithETag.mockRejectedValue(new Error('boom'));

    const { result } = renderHook(() => usePullRequestsSignal(REPOS, 'ghp_token'));

    await waitFor(() => {
      expect(result.current.get('octo/a')?.status).toBe('error');
    });
    expect(result.current.get('octo/a')?.openCount).toBeUndefined();
  });

  it('resolves an independent slice for every repo', async () => {
    mockFetchWithETag.mockImplementation((url: string) => {
      if (url.includes('/octo/a/')) return Promise.resolve([pull(1, 'NONE')]);
      return Promise.resolve([pull(2, 'MEMBER'), pull(3, 'OWNER')]);
    });

    const { result } = renderHook(() => usePullRequestsSignal(TWO_REPOS, 'ghp_token'));

    await waitFor(() => {
      expect(result.current.get('octo/a')?.status).toBe('ready');
      expect(result.current.get('octo/b')?.status).toBe('ready');
    });
    expect(result.current.get('octo/a')).toMatchObject({ openCount: 1, externalCount: 1 });
    expect(result.current.get('octo/b')).toMatchObject({ openCount: 2, externalCount: 0 });
  });

  it('refetches and re-seeds loading when the token changes', async () => {
    mockFetchWithETag.mockResolvedValue([pull(1, 'NONE')]);

    const { rerender } = renderHook(({ token }) => usePullRequestsSignal(REPOS, token), {
      initialProps: { token: 'ghp_one' },
    });

    await waitFor(() => {
      expect(mockFetchWithETag).toHaveBeenCalledWith(
        expect.any(String),
        expect.anything(),
        expect.objectContaining({ token: 'ghp_one' }),
      );
    });

    rerender({ token: 'ghp_two' });

    await waitFor(() => {
      expect(mockFetchWithETag).toHaveBeenCalledWith(
        expect.any(String),
        expect.anything(),
        expect.objectContaining({ token: 'ghp_two' }),
      );
    });
  });

  it('ignores a stale resolution after the token changes mid-flight', async () => {
    type Resolve = (value: unknown[]) => void;
    let resolveOne: Resolve | undefined;
    let resolveTwo: Resolve | undefined;
    const onePromise = new Promise<unknown[]>((resolve) => {
      resolveOne = resolve;
    });
    const twoPromise = new Promise<unknown[]>((resolve) => {
      resolveTwo = resolve;
    });

    mockFetchWithETag.mockImplementation(
      (_url: string, _schema: unknown, options?: { token?: string }) =>
        (options?.token === 'ghp_one' ? onePromise : twoPromise) as Promise<unknown>,
    );

    const { result, rerender } = renderHook(({ token }) => usePullRequestsSignal(REPOS, token), {
      initialProps: { token: 'ghp_one' },
    });

    rerender({ token: 'ghp_two' });

    // Resolve the current (token-two) request first.
    act(() => {
      resolveTwo?.([pull(1, 'MEMBER'), pull(2, 'MEMBER')]);
    });
    await waitFor(() => {
      expect(result.current.get('octo/a')?.openCount).toBe(2);
    });

    // Now resolve the superseded token-one request — it must be ignored.
    act(() => {
      resolveOne?.([pull(9, 'NONE')]);
    });
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(result.current.get('octo/a')?.openCount).toBe(2);
    expect(result.current.get('octo/a')?.externalCount).toBe(0);
  });
});
