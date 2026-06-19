import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SIGNAL_FETCH_CONCURRENCY } from '../../api/concurrency';
import { fetchWithETag } from '../../api/github';
import type { Repo } from '../../types/fleet';
import {
  STALE_THRESHOLD_DAYS,
  readyStaleSlice,
  staleCutoffDate,
  staleSearchUrl,
  useStaleSignal,
} from './useStaleSignal';

vi.mock('../../api/github', () => ({
  GITHUB_API_BASE: 'https://api.github.com',
  fetchWithETag: vi.fn(),
}));

const mockFetchWithETag = vi.mocked(fetchWithETag);

/** Minimal shape the hook reads back from the Search API response. */
interface CountPayload {
  total_count: number;
}

function repo(nameWithOwner: string, isPrivate = false): Repo {
  const slash = nameWithOwner.indexOf('/');
  return {
    nameWithOwner,
    owner: nameWithOwner.slice(0, slash),
    name: nameWithOwner.slice(slash + 1),
    isPrivate,
  };
}

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

/** Decodes the `q` search qualifier from a stale-search URL. */
function queryOf(url: string): string {
  return new URL(url).searchParams.get('q') ?? '';
}

/** Maps each repo full name to a `total_count`, matched by the request URL. */
function countsByRepo(counts: Record<string, number>): (url: string) => Promise<CountPayload> {
  return (url: string) => {
    const query = queryOf(url);
    for (const [fullName, total] of Object.entries(counts)) {
      if (query.includes(`repo:${fullName} `)) {
        return Promise.resolve({ total_count: total });
      }
    }
    return Promise.reject(new Error(`unexpected repo in query: ${query}`));
  };
}

const ONE_REPO: Repo[] = [repo('octo/a')];

/** Builds N distinct repos to exercise the per-repo concurrency limiter. */
function manyRepos(count: number): Repo[] {
  return Array.from({ length: count }, (_, i) => repo(`octo/r${i}`));
}

/** Flush all pending microtasks via a macrotask boundary. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  mockFetchWithETag.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('staleCutoffDate', () => {
  it('returns the UTC YYYY-MM-DD threshold a given number of days before now', () => {
    expect(staleCutoffDate(new Date('2024-01-31T12:00:00Z'), 30)).toBe('2024-01-01');
  });

  it('defaults to the module threshold and crosses month boundaries correctly', () => {
    expect(staleCutoffDate(new Date('2024-03-05T00:00:00Z'))).toBe(
      staleCutoffDate(new Date('2024-03-05T00:00:00Z'), STALE_THRESHOLD_DAYS),
    );
    expect(staleCutoffDate(new Date('2024-03-05T00:00:00Z'), 10)).toBe('2024-02-24');
  });

  it('formats in UTC regardless of the local time of day', () => {
    expect(staleCutoffDate(new Date('2024-06-20T23:59:59Z'), 1)).toBe('2024-06-19');
  });
});

describe('staleSearchUrl', () => {
  it('targets search/issues with an open + not-updated-since query for the repo', () => {
    const url = staleSearchUrl('octo', 'a', '2024-01-01');
    expect(url.startsWith('https://api.github.com/search/issues?q=')).toBe(true);
    expect(queryOf(url)).toBe('repo:octo/a is:open updated:<2024-01-01');
  });

  it('only needs the total count, so it requests a single result', () => {
    const perPage = new URL(staleSearchUrl('octo', 'a', '2024-01-01')).searchParams.get('per_page');
    expect(Number(perPage)).toBe(1);
  });
});

describe('readyStaleSlice', () => {
  it('reports the stale count and scores by it (higher = more neglected)', () => {
    expect(readyStaleSlice(4)).toEqual({ status: 'ready', staleCount: 4, score: 4 });
  });

  it('represents a fully-tended repo as zero', () => {
    expect(readyStaleSlice(0)).toEqual({ status: 'ready', staleCount: 0, score: 0 });
  });
});

describe('useStaleSignal', () => {
  it('returns an empty map and never fetches without a token', () => {
    const { result } = renderHook(() => useStaleSignal(ONE_REPO, null));

    expect(result.current).toBeInstanceOf(Map);
    expect(result.current.size).toBe(0);
    expect(mockFetchWithETag).not.toHaveBeenCalled();
  });

  it('keeps a stable empty-map identity across re-renders without a token', () => {
    const { result, rerender } = renderHook(() => useStaleSignal(ONE_REPO, null));
    const first = result.current;

    rerender();

    expect(result.current).toBe(first);
  });

  it('returns an empty map and never fetches when there are no repos', () => {
    const { result } = renderHook(() => useStaleSignal([], 'ghp_token'));

    expect(result.current.size).toBe(0);
    expect(mockFetchWithETag).not.toHaveBeenCalled();
  });

  it('starts a repo in the loading state before its count resolves', () => {
    mockFetchWithETag.mockReturnValue(deferred<CountPayload>().promise as never);

    const { result } = renderHook(() => useStaleSignal(ONE_REPO, 'ghp_token'));

    expect(result.current.get('octo/a')).toEqual({ status: 'loading' });
  });

  it('queries the dated search endpoint per repo and forwards the token', async () => {
    mockFetchWithETag.mockResolvedValue({ total_count: 0 } as never);

    renderHook(() => useStaleSignal(ONE_REPO, 'ghp_token'));

    await waitFor(() => {
      expect(mockFetchWithETag).toHaveBeenCalledTimes(1);
    });
    const [url, , options] = mockFetchWithETag.mock.calls[0];
    expect((url as string).startsWith('https://api.github.com/search/issues?q=')).toBe(true);
    expect(queryOf(url as string)).toMatch(/^repo:octo\/a is:open updated:<\d{4}-\d{2}-\d{2}$/);
    expect(new URL(url as string).searchParams.get('per_page')).toBe('1');
    expect(options).toMatchObject({ token: 'ghp_token' });
  });

  it('surfaces the stale count and score once the search resolves', async () => {
    mockFetchWithETag.mockResolvedValue({ total_count: 7 } as never);

    const { result } = renderHook(() => useStaleSignal(ONE_REPO, 'ghp_token'));

    await waitFor(() => {
      expect(result.current.get('octo/a')?.status).toBe('ready');
    });
    expect(result.current.get('octo/a')).toEqual({ status: 'ready', staleCount: 7, score: 7 });
  });

  it('marks a repo as error when its search rejects', async () => {
    mockFetchWithETag.mockRejectedValue(new Error('rate limited'));

    const { result } = renderHook(() => useStaleSignal(ONE_REPO, 'ghp_token'));

    await waitFor(() => {
      expect(result.current.get('octo/a')?.status).toBe('error');
    });
    expect(result.current.get('octo/a')?.staleCount).toBeUndefined();
  });

  it('resolves each repo independently in a single map', async () => {
    mockFetchWithETag.mockImplementation(
      countsByRepo({ 'octo/a': 5 }) as never,
      // 'acme/b' has no entry, so its query rejects → error slice.
    );

    const { result } = renderHook(() =>
      useStaleSignal([repo('octo/a'), repo('acme/b')], 'ghp_token'),
    );

    await waitFor(() => {
      expect(result.current.get('octo/a')?.status).toBe('ready');
      expect(result.current.get('acme/b')?.status).toBe('error');
    });
    expect(result.current.get('octo/a')).toMatchObject({ staleCount: 5, score: 5 });
  });

  it('refetches when the token changes', async () => {
    mockFetchWithETag.mockResolvedValue({ total_count: 1 } as never);

    const { rerender } = renderHook(({ token }) => useStaleSignal(ONE_REPO, token), {
      initialProps: { token: 'ghp_one' },
    });

    await waitFor(() => {
      expect(mockFetchWithETag).toHaveBeenCalledTimes(1);
    });
    expect(mockFetchWithETag.mock.calls[0][2]).toMatchObject({ token: 'ghp_one' });

    rerender({ token: 'ghp_two' });

    await waitFor(() => {
      expect(mockFetchWithETag).toHaveBeenCalledTimes(2);
    });
    expect(mockFetchWithETag.mock.calls[1][2]).toMatchObject({ token: 'ghp_two' });
  });

  it('ignores a stale response after the token changes mid-flight', async () => {
    const first = deferred<CountPayload>();
    const second = deferred<CountPayload>();
    mockFetchWithETag.mockImplementation(((
      _url: string,
      _schema: unknown,
      options: { token: string },
    ) => (options.token === 'ghp_one' ? first.promise : second.promise)) as never);

    const { result, rerender } = renderHook(({ token }) => useStaleSignal(ONE_REPO, token), {
      initialProps: { token: 'ghp_one' },
    });

    rerender({ token: 'ghp_two' });

    // The current token (ghp_two) resolves first.
    act(() => {
      second.resolve({ total_count: 2 });
    });
    await waitFor(() => {
      expect(result.current.get('octo/a')?.status).toBe('ready');
    });
    expect(result.current.get('octo/a')?.staleCount).toBe(2);

    // The superseded token (ghp_one) resolves late; the generation guard must
    // keep it from clobbering the current data.
    act(() => {
      first.resolve({ total_count: 999 });
    });
    await new Promise((r) => setTimeout(r, 10));

    expect(result.current.get('octo/a')?.staleCount).toBe(2);
  });

  it('ignores a stale rejection after the token changes mid-flight', async () => {
    const first = deferred<CountPayload>();
    const second = deferred<CountPayload>();
    mockFetchWithETag.mockImplementation(((
      _url: string,
      _schema: unknown,
      options: { token: string },
    ) => (options.token === 'ghp_one' ? first.promise : second.promise)) as never);

    const { result, rerender } = renderHook(({ token }) => useStaleSignal(ONE_REPO, token), {
      initialProps: { token: 'ghp_one' },
    });

    rerender({ token: 'ghp_two' });

    act(() => {
      second.resolve({ total_count: 2 });
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
    expect(result.current.get('octo/a')?.staleCount).toBe(2);
  });

  it('clears the map when the token is removed', async () => {
    mockFetchWithETag.mockResolvedValue({ total_count: 3 } as never);

    const { result, rerender } = renderHook(
      ({ token }: { token: string | null }) => useStaleSignal(ONE_REPO, token),
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
    mockFetchWithETag.mockImplementation((() => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      return new Promise<CountPayload>((resolve) => {
        release.push(() => {
          inFlight -= 1;
          resolve({ total_count: 1 });
        });
      });
    }) as never);

    const { unmount } = renderHook(() => useStaleSignal(repos, 'ghp_token'));
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
    mockFetchWithETag.mockImplementation((() => {
      return new Promise<CountPayload>((_resolve, reject) => {
        rejectFetch = reject;
      });
    }) as never);

    const { unmount, result } = renderHook(() => useStaleSignal(ONE_REPO, 'ghp_token'));
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
    mockFetchWithETag.mockRejectedValue(failure as never);

    const { result } = renderHook(() => useStaleSignal(ONE_REPO, 'ghp_token'));
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
      new DOMException('The operation was aborted', 'AbortError') as never,
    );

    const { result } = renderHook(() => useStaleSignal(ONE_REPO, 'ghp_token'));
    await act(async () => {
      await flush();
    });

    expect(result.current.get('octo/a')?.status).not.toBe('error');
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
