import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SIGNAL_FETCH_CONCURRENCY } from '../../api/concurrency';
import { fetchIssueCount, fetchViewerIssueCount } from '../../api/github';
import type { Repo } from '../../types/fleet';
import { ISSUE_TRIAGE_THRESHOLD, useIssuesSignal } from './useIssuesSignal';

vi.mock('../../api/github', () => ({
  fetchIssueCount: vi.fn(),
  fetchViewerIssueCount: vi.fn(),
}));

const mockFetchIssueCount = vi.mocked(fetchIssueCount);
const mockFetchViewerIssueCount = vi.mocked(fetchViewerIssueCount);

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

/** Builds N distinct repos to exercise the per-repo concurrency limiter. */
function manyRepos(count: number): Repo[] {
  return Array.from({ length: count }, (_, i) => repo(`octo/r${i}`));
}

/** Flush all pending microtasks via a macrotask boundary. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

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
  mockFetchViewerIssueCount.mockReset();
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
    expect(mockFetchIssueCount).toHaveBeenCalledWith(
      'octo',
      'a',
      'ghp_token',
      'open',
      expect.any(AbortSignal),
    );
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
      expect(mockFetchIssueCount).toHaveBeenCalledWith(
        'octo',
        'a',
        'ghp_one',
        'open',
        expect.any(AbortSignal),
      );
    });

    rerender({ token: 'ghp_two' });

    await waitFor(() => {
      expect(mockFetchIssueCount).toHaveBeenCalledWith(
        'octo',
        'a',
        'ghp_two',
        'open',
        expect.any(AbortSignal),
      );
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

  it('ignores a stale rejection after the token changes mid-flight', async () => {
    const first = deferred<number>();
    const second = deferred<number>();
    mockFetchIssueCount.mockImplementation((_owner, _name, token) =>
      token === 'ghp_one' ? first.promise : second.promise,
    );

    const { result, rerender } = renderHook(({ token }) => useIssuesSignal(ONE_REPO, token), {
      initialProps: { token: 'ghp_one' },
    });

    rerender({ token: 'ghp_two' });

    // The current token (ghp_two) resolves first with a healthy count.
    act(() => {
      second.resolve(2);
    });
    await waitFor(() => {
      expect(result.current.get('octo/a')?.status).toBe('ready');
    });

    // The superseded token (ghp_one) rejects late; the generation guard must
    // keep that failure from flipping the current ready slice to 'error'.
    act(() => {
      first.reject(new Error('stale boom'));
    });
    await new Promise((r) => setTimeout(r, 10));

    expect(result.current.get('octo/a')?.status).toBe('ready');
    expect(result.current.get('octo/a')?.openCount).toBe(2);
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

  it('never exceeds SIGNAL_FETCH_CONCURRENCY in-flight requests (bounded fan-out)', async () => {
    const repos = manyRepos(SIGNAL_FETCH_CONCURRENCY + 5);
    let inFlight = 0;
    let peak = 0;
    const release: Array<() => void> = [];
    mockFetchIssueCount.mockImplementation(() => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      return new Promise<number>((resolve) => {
        release.push(() => {
          inFlight -= 1;
          resolve(3);
        });
      });
    });

    const { unmount } = renderHook(() => useIssuesSignal(repos, 'ghp_token'));
    await act(async () => {
      await flush();
    });

    // The limiter caps cold-start fan-out; without it every repo fetches at once.
    expect(peak).toBe(SIGNAL_FETCH_CONCURRENCY);
    expect(mockFetchIssueCount).toHaveBeenCalledTimes(SIGNAL_FETCH_CONCURRENCY);

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
    mockFetchIssueCount.mockImplementation(
      () =>
        new Promise<number>((_resolve, reject) => {
          rejectFetch = reject;
        }),
    );

    const { unmount, result } = renderHook(() => useIssuesSignal(ONE_REPO, 'ghp_token'));
    const captured = mockFetchIssueCount.mock.calls[0]?.[4] as AbortSignal | undefined;
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
    mockFetchIssueCount.mockRejectedValue(failure);

    const { result } = renderHook(() => useIssuesSignal(ONE_REPO, 'ghp_token'));
    await waitFor(() => expect(result.current.get('octo/a')?.status).toBe('error'));

    expect(errorSpy).toHaveBeenCalled();
    const args = errorSpy.mock.calls.at(-1) ?? [];
    expect(args.some((arg) => typeof arg === 'string' && arg.includes('octo/a'))).toBe(true);
    expect(args).toContain(failure);
    errorSpy.mockRestore();
  });

  it('stays quiet (no log, no error slice) when a request rejects with AbortError', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockFetchIssueCount.mockRejectedValue(
      new DOMException('The operation was aborted', 'AbortError'),
    );

    const { result } = renderHook(() => useIssuesSignal(ONE_REPO, 'ghp_token'));
    await act(async () => {
      await flush();
    });

    expect(result.current.get('octo/a')?.status).not.toBe('error');
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  describe('viewer issue split (mine vs community)', () => {
    it('splits the open count into mine and community when a viewer login is supplied', async () => {
      mockFetchIssueCount.mockResolvedValue(5);
      mockFetchViewerIssueCount.mockResolvedValue(2);

      const { result } = renderHook(() => useIssuesSignal(ONE_REPO, 'ghp_token', 'octocat'));

      await waitFor(() => {
        expect(result.current.get('octo/a')?.status).toBe('ready');
      });

      // The viewer count is fetched alongside the total, sharing the same
      // AbortSignal as the open-count request.
      expect(mockFetchViewerIssueCount).toHaveBeenCalledWith(
        'octo',
        'a',
        'octocat',
        'ghp_token',
        expect.any(AbortSignal),
      );
      expect(result.current.get('octo/a')).toMatchObject({
        status: 'ready',
        openCount: 5,
        mineCount: 2,
        communityCount: 3,
      });
    });

    it('clamps community to zero when the viewer count meets or exceeds the total', async () => {
      mockFetchIssueCount.mockResolvedValue(2);
      mockFetchViewerIssueCount.mockResolvedValue(5);

      const { result } = renderHook(() => useIssuesSignal(ONE_REPO, 'ghp_token', 'octocat'));

      await waitFor(() => {
        expect(result.current.get('octo/a')?.status).toBe('ready');
      });

      expect(result.current.get('octo/a')).toMatchObject({
        openCount: 2,
        mineCount: 5,
        communityCount: 0,
      });
    });

    it('keeps overThreshold and score keyed to the TOTAL open count, not the community remainder', async () => {
      // Every open issue is the viewer's own (community === 0), yet the triage
      // banding must still escalate on the full open count.
      mockFetchIssueCount.mockResolvedValue(ISSUE_TRIAGE_THRESHOLD);
      mockFetchViewerIssueCount.mockResolvedValue(ISSUE_TRIAGE_THRESHOLD);

      const { result } = renderHook(() => useIssuesSignal(ONE_REPO, 'ghp_token', 'octocat'));

      await waitFor(() => {
        expect(result.current.get('octo/a')?.status).toBe('ready');
      });

      expect(result.current.get('octo/a')).toMatchObject({
        openCount: ISSUE_TRIAGE_THRESHOLD,
        overThreshold: true,
        score: ISSUE_TRIAGE_THRESHOLD,
        mineCount: ISSUE_TRIAGE_THRESHOLD,
        communityCount: 0,
      });
    });

    it('leaves mine/community undefined and never fetches the viewer count without a login', async () => {
      mockFetchIssueCount.mockResolvedValue(5);

      const { result } = renderHook(() => useIssuesSignal(ONE_REPO, 'ghp_token', null));

      await waitFor(() => {
        expect(result.current.get('octo/a')?.status).toBe('ready');
      });

      expect(mockFetchViewerIssueCount).not.toHaveBeenCalled();
      const slice = result.current.get('octo/a');
      expect(slice).toMatchObject({ openCount: 5, overThreshold: false });
      expect(slice?.mineCount).toBeUndefined();
      expect(slice?.communityCount).toBeUndefined();
    });

    it('treats an empty-string login as absent (no viewer fetch, no split)', async () => {
      mockFetchIssueCount.mockResolvedValue(5);

      const { result } = renderHook(() => useIssuesSignal(ONE_REPO, 'ghp_token', ''));

      await waitFor(() => {
        expect(result.current.get('octo/a')?.status).toBe('ready');
      });

      expect(mockFetchViewerIssueCount).not.toHaveBeenCalled();
      expect(result.current.get('octo/a')?.mineCount).toBeUndefined();
      expect(result.current.get('octo/a')?.communityCount).toBeUndefined();
    });

    it('degrades to ready (open count kept, mine/community undefined) when only the viewer-count fetch rejects', async () => {
      // #494: a viewer-count failure (e.g. a Search rate limit) must not blank
      // the whole slice. The open count is the backbone and stays surfaced;
      // only the mine/community enrichment is dropped, and the loss is warned.
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      mockFetchIssueCount.mockResolvedValue(5);
      mockFetchViewerIssueCount.mockRejectedValue(new Error('viewer boom'));

      const { result } = renderHook(() => useIssuesSignal(ONE_REPO, 'ghp_token', 'octocat'));

      await waitFor(() => {
        expect(result.current.get('octo/a')?.status).toBe('ready');
      });

      const slice = result.current.get('octo/a');
      expect(slice).toMatchObject({ status: 'ready', openCount: 5, overThreshold: false });
      expect(slice?.mineCount).toBeUndefined();
      expect(slice?.communityCount).toBeUndefined();
      expect(warnSpy).toHaveBeenCalledTimes(1);
      warnSpy.mockRestore();
    });
  });
});
