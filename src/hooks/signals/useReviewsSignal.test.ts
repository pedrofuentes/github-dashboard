import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchWithETag } from '../../api/github';
import type { Repo } from '../../types/fleet';
import {
  REVIEW_SCORE_WEIGHT,
  distributeReviewCounts,
  repoFullNameFromUrl,
  reviewRequestedSearchUrl,
  useReviewsSignal,
} from './useReviewsSignal';

vi.mock('../../api/github', () => ({
  GITHUB_API_BASE: 'https://api.github.com',
  fetchWithETag: vi.fn(),
}));

const mockFetchWithETag = vi.mocked(fetchWithETag);

/** Minimal shape the hook reads back from the Search API response. */
interface SearchPayload {
  total_count: number;
  items: { repository_url: string }[];
}

function search(...fullNames: string[]): SearchPayload {
  return {
    total_count: fullNames.length,
    items: fullNames.map((name) => ({
      repository_url: `https://api.github.com/repos/${name}`,
    })),
  };
}

function resolveOnce(payload: SearchPayload): void {
  mockFetchWithETag.mockResolvedValueOnce(payload as never);
}

function repo(nameWithOwner: string): Repo {
  const slash = nameWithOwner.indexOf('/');
  return {
    nameWithOwner,
    owner: nameWithOwner.slice(0, slash),
    name: nameWithOwner.slice(slash + 1),
    isPrivate: false,
  };
}

const REPOS: Repo[] = [repo('octo/a'), repo('octo/b'), repo('octo/c')];

/** Flush all pending microtasks via a macrotask boundary. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  mockFetchWithETag.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('repoFullNameFromUrl', () => {
  it('extracts owner/repo from a repository_url', () => {
    expect(repoFullNameFromUrl('https://api.github.com/repos/octo/hello-world')).toBe(
      'octo/hello-world',
    );
  });

  it('returns null when the marker is absent', () => {
    expect(repoFullNameFromUrl('https://api.github.com/octo/hello')).toBeNull();
  });

  it('returns null when the full name is empty', () => {
    expect(repoFullNameFromUrl('https://api.github.com/repos/')).toBeNull();
  });
});

describe('reviewRequestedSearchUrl', () => {
  it('targets the search/issues endpoint with the review-requested query', () => {
    const url = reviewRequestedSearchUrl();
    expect(url.startsWith('https://api.github.com/search/issues?q=')).toBe(true);
    const query = new URL(url).searchParams.get('q');
    expect(query).toBe('is:open is:pr review-requested:@me');
  });

  it('requests a page large enough to cover the fleet in one call', () => {
    const perPage = new URL(reviewRequestedSearchUrl()).searchParams.get('per_page');
    expect(Number(perPage)).toBeGreaterThanOrEqual(100);
  });
});

describe('distributeReviewCounts', () => {
  it('counts requested reviews per repo and zero-fills the rest', () => {
    const result = distributeReviewCounts(
      ['octo/a', 'octo/b', 'octo/c'],
      [
        { repository_url: 'https://api.github.com/repos/octo/a' },
        { repository_url: 'https://api.github.com/repos/octo/a' },
        { repository_url: 'https://api.github.com/repos/octo/c' },
      ],
    );

    expect(result.get('octo/a')).toEqual({
      status: 'ready',
      requestedCount: 2,
      score: 2 * REVIEW_SCORE_WEIGHT,
    });
    expect(result.get('octo/b')).toEqual({ status: 'ready', requestedCount: 0, score: 0 });
    expect(result.get('octo/c')).toEqual({
      status: 'ready',
      requestedCount: 1,
      score: REVIEW_SCORE_WEIGHT,
    });
  });

  it('ignores requested reviews for repos outside the fleet', () => {
    const result = distributeReviewCounts(
      ['octo/a'],
      [
        { repository_url: 'https://api.github.com/repos/other/zzz' },
        { repository_url: 'https://api.github.com/repos/octo/a' },
      ],
    );

    expect(result.size).toBe(1);
    expect(result.get('octo/a')?.requestedCount).toBe(1);
  });

  it('skips items whose repository_url cannot be parsed', () => {
    const result = distributeReviewCounts(
      ['octo/a'],
      [
        { repository_url: 'not-a-repos-url' },
        { repository_url: 'https://api.github.com/repos/octo/a' },
      ],
    );

    expect(result.get('octo/a')?.requestedCount).toBe(1);
  });
});

describe('useReviewsSignal', () => {
  it('returns an empty map and does not fetch without a token', async () => {
    const { result } = renderHook(() => useReviewsSignal(REPOS, null));

    await waitFor(() => {
      expect(result.current).toBeInstanceOf(Map);
    });
    expect(result.current.size).toBe(0);
    expect(mockFetchWithETag).not.toHaveBeenCalled();
  });

  it('returns an empty map and does not fetch when there are no repos', async () => {
    const { result } = renderHook(() => useReviewsSignal([], 'ghp_token'));

    await waitFor(() => {
      expect(result.current).toBeInstanceOf(Map);
    });
    expect(result.current.size).toBe(0);
    expect(mockFetchWithETag).not.toHaveBeenCalled();
  });

  it('makes a single cross-repo Search call for the whole fleet', async () => {
    resolveOnce(search());

    renderHook(() => useReviewsSignal(REPOS, 'ghp_token'));

    await waitFor(() => {
      expect(mockFetchWithETag).toHaveBeenCalledTimes(1);
    });
    const [url, , options] = mockFetchWithETag.mock.calls[0];
    expect(url).toBe(reviewRequestedSearchUrl());
    expect(options).toMatchObject({ token: 'ghp_token' });
  });

  it('reports loading first, then ready slices with distributed counts', async () => {
    resolveOnce(search('octo/a', 'octo/a', 'octo/c'));

    const { result } = renderHook(() => useReviewsSignal(REPOS, 'ghp_token'));

    expect(result.current.get('octo/a')?.status).toBe('loading');

    await waitFor(() => {
      expect(result.current.get('octo/a')?.status).toBe('ready');
    });
    expect(result.current.get('octo/a')).toEqual({
      status: 'ready',
      requestedCount: 2,
      score: 2 * REVIEW_SCORE_WEIGHT,
    });
    expect(result.current.get('octo/b')).toEqual({ status: 'ready', requestedCount: 0, score: 0 });
    expect(result.current.get('octo/c')?.requestedCount).toBe(1);
  });

  it('marks every repo as error when the Search call fails', async () => {
    mockFetchWithETag.mockRejectedValueOnce(new Error('rate limited'));

    const { result } = renderHook(() => useReviewsSignal(REPOS, 'ghp_token'));

    await waitFor(() => {
      expect(result.current.get('octo/a')?.status).toBe('error');
    });
    for (const r of REPOS) {
      expect(result.current.get(r.nameWithOwner)?.status).toBe('error');
    }
  });

  it('ignores a stale response after the token changes mid-flight', async () => {
    let resolveStale: ((payload: SearchPayload) => void) | undefined;
    const stalePromise = new Promise<SearchPayload>((resolve) => {
      resolveStale = resolve;
    });
    mockFetchWithETag.mockReturnValueOnce(stalePromise as never);
    resolveOnce(search('octo/b'));

    const { result, rerender } = renderHook(({ token }) => useReviewsSignal(REPOS, token), {
      initialProps: { token: 'ghp_one' },
    });

    rerender({ token: 'ghp_two' });

    await waitFor(() => {
      expect(result.current.get('octo/b')?.requestedCount).toBe(1);
    });

    act(() => {
      resolveStale?.(search('octo/a', 'octo/a', 'octo/a'));
    });
    await new Promise((resolve) => setTimeout(resolve, 10));

    // The superseded token-one response must not overwrite token-two's data.
    expect(result.current.get('octo/a')?.requestedCount).toBe(0);
    expect(result.current.get('octo/b')?.requestedCount).toBe(1);
  });

  it('ignores a stale rejection after the token changes mid-flight', async () => {
    let rejectStale: ((reason: unknown) => void) | undefined;
    const stalePromise = new Promise<SearchPayload>((_, reject) => {
      rejectStale = reject;
    });
    mockFetchWithETag.mockReturnValueOnce(stalePromise as never);
    resolveOnce(search('octo/b'));

    const { result, rerender } = renderHook(({ token }) => useReviewsSignal(REPOS, token), {
      initialProps: { token: 'ghp_one' },
    });

    rerender({ token: 'ghp_two' });

    await waitFor(() => {
      expect(result.current.get('octo/b')?.requestedCount).toBe(1);
    });

    act(() => {
      rejectStale?.(new Error('stale failure'));
    });
    await new Promise((resolve) => setTimeout(resolve, 10));

    // The superseded token-one rejection must not flip token-two's ready data to error.
    expect(result.current.get('octo/b')?.status).toBe('ready');
    expect(result.current.get('octo/b')?.requestedCount).toBe(1);
  });

  it('aborts the in-flight request on unmount without logging or error slices', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    let rejectFetch!: (reason: unknown) => void;
    mockFetchWithETag.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectFetch = reject;
        }) as never,
    );

    const { unmount, result } = renderHook(() => useReviewsSignal(REPOS, 'ghp_token'));
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

  it('logs non-abort failures with repo context and sets error slices', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failure = new Error('boom');
    mockFetchWithETag.mockRejectedValue(failure as never);

    const { result } = renderHook(() => useReviewsSignal(REPOS, 'ghp_token'));
    await waitFor(() => expect(result.current.get('octo/a')?.status).toBe('error'));

    expect(errorSpy).toHaveBeenCalled();
    const args = errorSpy.mock.calls.at(-1) ?? [];
    expect(args.some((arg) => typeof arg === 'string' && arg.includes('octo/a'))).toBe(true);
    expect(args).toContain(failure);
    errorSpy.mockRestore();
  });

  it('stays quiet (no log, no error slice) when the request rejects with AbortError', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockFetchWithETag.mockRejectedValue(
      new DOMException('The operation was aborted', 'AbortError') as never,
    );

    const { result } = renderHook(() => useReviewsSignal(REPOS, 'ghp_token'));
    await act(async () => {
      await flush();
    });

    expect(result.current.get('octo/a')?.status).not.toBe('error');
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
