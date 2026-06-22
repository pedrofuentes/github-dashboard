import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SIGNAL_FETCH_CONCURRENCY } from '../../api/concurrency';
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
    title: `PR ${number}`,
    created_at: `2024-03-${String(number).padStart(2, '0')}T00:00:00Z`,
  };
}

const REPOS: Repo[] = [{ nameWithOwner: 'octo/a', owner: 'octo', name: 'a', isPrivate: false }];
const TWO_REPOS: Repo[] = [
  { nameWithOwner: 'octo/a', owner: 'octo', name: 'a', isPrivate: false },
  { nameWithOwner: 'octo/b', owner: 'octo', name: 'b', isPrivate: true },
];

/** Builds N distinct repos to exercise the per-repo concurrency limiter. */
function manyRepos(count: number): Repo[] {
  return Array.from({ length: count }, (_, i) => ({
    nameWithOwner: `octo/r${i}`,
    owner: 'octo',
    name: `r${i}`,
    isPrivate: false,
  }));
}

/** Flush all pending microtasks via a macrotask boundary. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

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

  it('exposes the filtered external-contributor PR list as per-item identity (AC-4)', async () => {
    mockFetchWithETag.mockResolvedValue([
      pull(1, 'MEMBER'), // internal → excluded
      pull(2, 'NONE'), // new outside contributor, non-draft → included
      pull(3, 'FIRST_TIMER', true), // external but draft → excluded
      pull(4, 'FIRST_TIME_CONTRIBUTOR'), // new outside contributor, non-draft → included
    ]);

    const { result } = renderHook(() => usePullRequestsSignal(REPOS, 'ghp_token'));

    await waitFor(() => {
      expect(result.current.get('octo/a')?.status).toBe('ready');
    });
    const slice = result.current.get('octo/a');
    expect(slice?.externalCount).toBe(2);
    // The Inbox emits one `new-pr:<repo>:#<n>` item per external, non-draft PR,
    // ordered by `created_at`; the list un-projects fields already in the
    // `/pulls?state=open` payload (no extra request) and matches the predicate.
    expect(slice?.externalPullRequests).toEqual([
      {
        number: 2,
        title: 'PR 2',
        html_url: 'https://github.com/octo/a/pull/2',
        created_at: '2024-03-02T00:00:00Z',
        user_login: 'user-2',
        author_association: 'NONE',
      },
      {
        number: 4,
        title: 'PR 4',
        html_url: 'https://github.com/octo/a/pull/4',
        created_at: '2024-03-04T00:00:00Z',
        user_login: 'user-4',
        author_association: 'FIRST_TIME_CONTRIBUTOR',
      },
    ]);
    // INBOX-2A (#228): the POPULATED new-pr path is a request-free retain. The
    // external list is un-projected from the already-fetched `/pulls?state=open`
    // payload, so it issues the SAME single request as the zero-external path —
    // never an extra per-PR fetch. The AC-5 (empty) test guards the same
    // invariant; without this a regression that fetched only when externals
    // exist would slip through.
    expect(mockFetchWithETag).toHaveBeenCalledTimes(1);
    expect(mockFetchWithETag.mock.calls[0][0]).toBe(
      'https://api.github.com/repos/octo/a/pulls?state=open&per_page=100',
    );
  });

  it('omits the external list (and adds no request) when there are no external PRs (AC-5)', async () => {
    mockFetchWithETag.mockResolvedValue([pull(1, 'MEMBER'), pull(2, 'OWNER')]);

    const { result } = renderHook(() => usePullRequestsSignal(REPOS, 'ghp_token'));

    await waitFor(() => {
      expect(result.current.get('octo/a')?.status).toBe('ready');
    });
    // Enrichment is a pure un-projection: same single `/pulls?state=open&per_page=100`
    // call, and no external list when the predicate matches nothing.
    expect(mockFetchWithETag).toHaveBeenCalledTimes(1);
    expect(mockFetchWithETag.mock.calls[0][0]).toBe(
      'https://api.github.com/repos/octo/a/pulls?state=open&per_page=100',
    );
    expect(result.current.get('octo/a')?.externalPullRequests).toBeUndefined();
  });

  it('defaults a null-author (ghost) external PR to an empty user_login without crashing (new-pr null author)', async () => {
    // GitHub returns `user: null` for a deleted/ghost author. The summarize
    // un-projection reads `user?.login ?? ''`; the `pull()` helper always sets a
    // user, so this exercises the otherwise-uncovered null-author branch. A
    // non-null-safe regression would throw and degrade the whole slice to error.
    const ghostAuthored = { ...(pull(7, 'NONE') as Record<string, unknown>), user: null };
    mockFetchWithETag.mockResolvedValue([ghostAuthored]);

    const { result } = renderHook(() => usePullRequestsSignal(REPOS, 'ghp_token'));

    await waitFor(() => {
      expect(result.current.get('octo/a')?.status).toBe('ready');
    });
    const slice = result.current.get('octo/a');
    expect(slice?.externalCount).toBe(1);
    expect(slice?.externalPullRequests).toEqual([
      {
        number: 7,
        title: 'PR 7',
        html_url: 'https://github.com/octo/a/pull/7',
        created_at: '2024-03-07T00:00:00Z',
        user_login: '',
        author_association: 'NONE',
      },
    ]);
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

  it('never exceeds SIGNAL_FETCH_CONCURRENCY in-flight requests (bounded fan-out)', async () => {
    const repos = manyRepos(SIGNAL_FETCH_CONCURRENCY + 5);
    let inFlight = 0;
    let peak = 0;
    const release: Array<() => void> = [];
    mockFetchWithETag.mockImplementation(() => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      return new Promise<unknown>((resolve) => {
        release.push(() => {
          inFlight -= 1;
          resolve([pull(1, 'MEMBER')]);
        });
      });
    });

    const { unmount } = renderHook(() => usePullRequestsSignal(repos, 'ghp_token'));
    await act(async () => {
      await flush();
    });

    // The limiter caps cold-start fan-out; without it every repo fetches at once.
    expect(peak).toBe(SIGNAL_FETCH_CONCURRENCY);
    expect(mockFetchWithETag).toHaveBeenCalledTimes(SIGNAL_FETCH_CONCURRENCY);

    await act(async () => {
      while (release.length > 0) {
        release.shift()?.();
        await flush();
        expect(inFlight).toBeLessThanOrEqual(SIGNAL_FETCH_CONCURRENCY);
      }
    });
    expect(peak).toBe(SIGNAL_FETCH_CONCURRENCY);
    unmount();
  });

  it('aborts in-flight requests on unmount without logging or error slices', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    let rejectFetch!: (reason: unknown) => void;
    mockFetchWithETag.mockImplementation(
      () =>
        new Promise<unknown>((_resolve, reject) => {
          rejectFetch = reject;
        }),
    );

    const { unmount, result } = renderHook(() => usePullRequestsSignal(REPOS, 'ghp_token'));
    const captured = (mockFetchWithETag.mock.calls[0]?.[2] as { signal?: AbortSignal } | undefined)
      ?.signal;
    expect(captured).toBeInstanceOf(AbortSignal);
    expect(captured?.aborted).toBe(false);

    unmount();
    expect(captured?.aborted).toBe(true);

    await act(async () => {
      rejectFetch(new DOMException('The operation was aborted', 'AbortError'));
      await flush();
    });

    expect(result.current.get('octo/a')?.status).not.toBe('error');
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('logs non-abort failures with repo context and sets an error slice', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failure = new Error('boom');
    mockFetchWithETag.mockRejectedValue(failure);

    const { result } = renderHook(() => usePullRequestsSignal(REPOS, 'ghp_token'));
    await waitFor(() => expect(result.current.get('octo/a')?.status).toBe('error'));

    expect(errorSpy).toHaveBeenCalled();
    const args = errorSpy.mock.calls.at(-1) ?? [];
    expect(args.some((arg) => typeof arg === 'string' && arg.includes('octo/a'))).toBe(true);
    expect(args).toContain(failure);
    errorSpy.mockRestore();
  });

  it('stays quiet (no log, no error slice) when a request rejects with AbortError', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockFetchWithETag.mockRejectedValue(
      new DOMException('The operation was aborted', 'AbortError'),
    );

    const { result } = renderHook(() => usePullRequestsSignal(REPOS, 'ghp_token'));
    await act(async () => {
      await flush();
    });

    expect(result.current.get('octo/a')?.status).not.toBe('error');
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
