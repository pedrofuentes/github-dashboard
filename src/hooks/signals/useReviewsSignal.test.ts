import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchReviewRequestedPage } from '../../api/github';
import type { Repo } from '../../types/fleet';
import {
  MAX_REVIEW_PAGES,
  REVIEW_SCORE_WEIGHT,
  distributeReviewCounts,
  repoFullNameFromUrl,
  reviewRequestedSearchUrl,
  useReviewsSignal,
} from './useReviewsSignal';

vi.mock('../../api/github', () => ({
  GITHUB_API_BASE: 'https://api.github.com',
  fetchReviewRequestedPage: vi.fn(),
}));

const mockFetchPage = vi.mocked(fetchReviewRequestedPage);

/** One review-requested Search item carrying the full per-PR identity. */
interface SearchItem {
  repository_url: string;
  number: number;
  title: string;
  html_url: string;
  created_at: string;
  user_login: string;
}

/** One page of the review-requested search, as the fetcher returns it. */
interface PagePayload {
  items: SearchItem[];
  totalCount: number;
  nextPageUrl: string | null;
}

/** Builds a search item for `fullName` with deterministic identity fields. */
function searchItem(fullName: string, number: number): SearchItem {
  return {
    repository_url: `https://api.github.com/repos/${fullName}`,
    number,
    title: `PR ${number} in ${fullName}`,
    html_url: `https://github.com/${fullName}/pull/${number}`,
    created_at: '2024-02-01T00:00:00Z',
    user_login: `user-${number}`,
  };
}

/** Builds a page payload from repo full names, defaulting to a single page. */
function page(
  fullNames: string[],
  nextPageUrl: string | null = null,
  totalCount: number = fullNames.length,
): PagePayload {
  return {
    items: fullNames.map((name, index) => searchItem(name, index + 1)),
    totalCount,
    nextPageUrl,
  };
}

function resolveOnce(payload: PagePayload): void {
  mockFetchPage.mockResolvedValueOnce(payload as never);
}

/** The per-PR identity `searchItem` projects onto a repo's `requests` list. */
function expectedRequest(fullName: string, number: number) {
  const item = searchItem(fullName, number);
  return {
    number: item.number,
    title: item.title,
    html_url: item.html_url,
    created_at: item.created_at,
    user_login: item.user_login,
  };
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
  mockFetchPage.mockReset();
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
  it('counts requested reviews per repo, zero-fills the rest, and retains per-PR identity', () => {
    const result = distributeReviewCounts(
      ['octo/a', 'octo/b', 'octo/c'],
      [searchItem('octo/a', 1), searchItem('octo/a', 2), searchItem('octo/c', 3)],
    );

    expect(result.get('octo/a')).toEqual({
      status: 'ready',
      requestedCount: 2,
      score: 2 * REVIEW_SCORE_WEIGHT,
      requests: [expectedRequest('octo/a', 1), expectedRequest('octo/a', 2)],
    });
    expect(result.get('octo/b')).toEqual({ status: 'ready', requestedCount: 0, score: 0 });
    expect(result.get('octo/c')).toEqual({
      status: 'ready',
      requestedCount: 1,
      score: REVIEW_SCORE_WEIGHT,
      requests: [expectedRequest('octo/c', 3)],
    });
  });

  it('ignores requested reviews for repos outside the fleet', () => {
    const result = distributeReviewCounts(
      ['octo/a'],
      [searchItem('other/zzz', 1), searchItem('octo/a', 2)],
    );

    expect(result.size).toBe(1);
    expect(result.get('octo/a')?.requestedCount).toBe(1);
  });

  it('skips items whose repository_url cannot be parsed', () => {
    const result = distributeReviewCounts(
      ['octo/a'],
      [
        {
          repository_url: 'not-a-repos-url',
          number: 1,
          title: 'unparseable',
          html_url: 'https://github.com/x/y/pull/1',
          created_at: '2024-02-01T00:00:00Z',
          user_login: 'nobody',
        },
        searchItem('octo/a', 2),
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
    expect(mockFetchPage).not.toHaveBeenCalled();
  });

  it('returns an empty map and does not fetch when there are no repos', async () => {
    const { result } = renderHook(() => useReviewsSignal([], 'ghp_token'));

    await waitFor(() => {
      expect(result.current).toBeInstanceOf(Map);
    });
    expect(result.current.size).toBe(0);
    expect(mockFetchPage).not.toHaveBeenCalled();
  });

  it('makes a single cross-repo Search call for the whole fleet', async () => {
    resolveOnce(page([]));

    renderHook(() => useReviewsSignal(REPOS, 'ghp_token'));

    await waitFor(() => {
      expect(mockFetchPage).toHaveBeenCalledTimes(1);
    });
    const [url, options] = mockFetchPage.mock.calls[0];
    expect(url).toBe(reviewRequestedSearchUrl());
    expect(options).toMatchObject({ token: 'ghp_token' });
    expect((options as { signal?: AbortSignal }).signal).toBeInstanceOf(AbortSignal);
  });

  it('follows Link pagination so counts include PRs beyond the first page', async () => {
    const nextUrl = `${reviewRequestedSearchUrl()}&page=2`;
    // Page 1 fills a whole page (100) for octo/a and advertises a next page;
    // page 2 holds the remaining 50. The fleet total is 150 — all for octo/a.
    resolveOnce(
      page(
        Array.from({ length: 100 }, () => 'octo/a'),
        nextUrl,
        150,
      ),
    );
    resolveOnce(
      page(
        Array.from({ length: 50 }, () => 'octo/a'),
        null,
        150,
      ),
    );

    const { result } = renderHook(() => useReviewsSignal(REPOS, 'ghp_token'));

    await waitFor(() => {
      expect(result.current.get('octo/a')?.status).toBe('ready');
    });

    expect(mockFetchPage).toHaveBeenCalledTimes(2);
    // The second request must target the next-page URL reported by page 1.
    expect(mockFetchPage.mock.calls[1][0]).toBe(nextUrl);
    // …and must keep threading the AbortSignal so a mid-pagination unmount or
    // repos/token change cancels page 2+ as well, not just the first call.
    expect((mockFetchPage.mock.calls[1][1] as { signal?: AbortSignal }).signal).toBeInstanceOf(
      AbortSignal,
    );
    expect(result.current.get('octo/a')).toMatchObject({
      status: 'ready',
      requestedCount: 150,
      score: 150 * REVIEW_SCORE_WEIGHT,
    });
    // Every counted PR is also retained as per-item identity for the Inbox.
    expect(result.current.get('octo/a')?.requests).toHaveLength(150);
  });

  it('stops following pagination at the max page cap', async () => {
    // Capping legitimately warns (covered below); silence it to keep output clean.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const selfNext = `${reviewRequestedSearchUrl()}&page=loop`;
    // Every page advertises a next page — a pathological loop the cap must break.
    mockFetchPage.mockResolvedValue(page(['octo/a'], selfNext, 9999) as never);

    const { result } = renderHook(() => useReviewsSignal(REPOS, 'ghp_token'));

    await waitFor(() => {
      expect(result.current.get('octo/a')?.status).toBe('ready');
    });

    expect(mockFetchPage).toHaveBeenCalledTimes(MAX_REVIEW_PAGES);
    expect(result.current.get('octo/a')?.requestedCount).toBe(MAX_REVIEW_PAGES);
    warnSpy.mockRestore();
  });

  it('warns when pagination stops at the page cap with more pages still available', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const selfNext = `${reviewRequestedSearchUrl()}&page=loop`;
    // Every page advertises a next page, so the cap is reached with more pending
    // — the counts may undercount and that must not be silent.
    mockFetchPage.mockResolvedValue(page(['octo/a'], selfNext, 9999) as never);

    const { result } = renderHook(() => useReviewsSignal(REPOS, 'ghp_token'));

    await waitFor(() => {
      expect(result.current.get('octo/a')?.status).toBe('ready');
    });

    expect(warnSpy).toHaveBeenCalled();
    const warned = warnSpy.mock.calls.at(-1) ?? [];
    expect(
      warned.some((arg) => typeof arg === 'string' && arg.includes(String(MAX_REVIEW_PAGES))),
    ).toBe(true);
    warnSpy.mockRestore();
  });

  it('does not warn when pagination completes before the page cap', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    resolveOnce(page(['octo/a'], `${reviewRequestedSearchUrl()}&page=2`, 2));
    resolveOnce(page(['octo/a'], null, 2));

    const { result } = renderHook(() => useReviewsSignal(REPOS, 'ghp_token'));

    await waitFor(() => {
      expect(result.current.get('octo/a')?.requestedCount).toBe(2);
    });

    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('reports loading first, then ready slices with distributed counts', async () => {
    resolveOnce(page(['octo/a', 'octo/a', 'octo/c']));

    const { result } = renderHook(() => useReviewsSignal(REPOS, 'ghp_token'));

    expect(result.current.get('octo/a')?.status).toBe('loading');

    await waitFor(() => {
      expect(result.current.get('octo/a')?.status).toBe('ready');
    });
    expect(result.current.get('octo/a')).toEqual({
      status: 'ready',
      requestedCount: 2,
      score: 2 * REVIEW_SCORE_WEIGHT,
      requests: [expectedRequest('octo/a', 1), expectedRequest('octo/a', 2)],
    });
    expect(result.current.get('octo/b')).toEqual({ status: 'ready', requestedCount: 0, score: 0 });
    expect(result.current.get('octo/c')?.requestedCount).toBe(1);
  });

  it('attributes each requested-review PR to its repo as per-item identity (AC-4)', async () => {
    resolveOnce({
      items: [searchItem('octo/a', 101), searchItem('octo/c', 202)],
      totalCount: 2,
      nextPageUrl: null,
    });

    const { result } = renderHook(() => useReviewsSignal(REPOS, 'ghp_token'));

    await waitFor(() => {
      expect(result.current.get('octo/a')?.status).toBe('ready');
    });
    // The Inbox emits a `review:<repo>:#<n>` item per awaiting PR, ordered by
    // `created_at`; the data is un-projected from the same Search pages (no new
    // request) and attributed to the repo via `repository_url`.
    expect(result.current.get('octo/a')?.requests).toEqual([expectedRequest('octo/a', 101)]);
    expect(result.current.get('octo/c')?.requests).toEqual([expectedRequest('octo/c', 202)]);
    // Repos with no awaiting review carry no per-PR list (kept additive/optional).
    expect(result.current.get('octo/b')?.requests).toBeUndefined();
  });

  it('marks every repo as error when the Search call fails', async () => {
    mockFetchPage.mockRejectedValueOnce(new Error('rate limited'));

    const { result } = renderHook(() => useReviewsSignal(REPOS, 'ghp_token'));

    await waitFor(() => {
      expect(result.current.get('octo/a')?.status).toBe('error');
    });
    for (const r of REPOS) {
      expect(result.current.get(r.nameWithOwner)?.status).toBe('error');
    }
  });

  it('ignores a stale response after the token changes mid-flight', async () => {
    let resolveStale: ((payload: PagePayload) => void) | undefined;
    const stalePromise = new Promise<PagePayload>((resolve) => {
      resolveStale = resolve;
    });
    mockFetchPage.mockReturnValueOnce(stalePromise as never);
    resolveOnce(page(['octo/b']));

    const { result, rerender } = renderHook(({ token }) => useReviewsSignal(REPOS, token), {
      initialProps: { token: 'ghp_one' },
    });

    rerender({ token: 'ghp_two' });

    await waitFor(() => {
      expect(result.current.get('octo/b')?.requestedCount).toBe(1);
    });

    act(() => {
      resolveStale?.(page(['octo/a', 'octo/a', 'octo/a']));
    });
    await new Promise((resolve) => setTimeout(resolve, 10));

    // The superseded token-one response must not overwrite token-two's data.
    expect(result.current.get('octo/a')?.requestedCount).toBe(0);
    expect(result.current.get('octo/b')?.requestedCount).toBe(1);
  });

  it('ignores a stale rejection after the token changes mid-flight', async () => {
    let rejectStale: ((reason: unknown) => void) | undefined;
    const stalePromise = new Promise<PagePayload>((_, reject) => {
      rejectStale = reject;
    });
    mockFetchPage.mockReturnValueOnce(stalePromise as never);
    resolveOnce(page(['octo/b']));

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
    mockFetchPage.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectFetch = reject;
        }) as never,
    );

    const { unmount, result } = renderHook(() => useReviewsSignal(REPOS, 'ghp_token'));
    const captured = (mockFetchPage.mock.calls[0]?.[1] as { signal?: AbortSignal } | undefined)
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
    mockFetchPage.mockRejectedValue(failure as never);

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
    mockFetchPage.mockRejectedValue(
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

describe('useReviewsSignal — override param', () => {
  it('returns the override map directly and never calls the fetcher', () => {
    const override = new Map([
      ['octo/a', { status: 'ready' as const, requestedCount: 3, score: 3 * REVIEW_SCORE_WEIGHT }],
    ]);
    const { result } = renderHook(() => useReviewsSignal(REPOS, 'ghp_token', override));

    expect(result.current).toBe(override);
    expect(mockFetchPage).not.toHaveBeenCalled();
  });

  it('falls back to REST behavior when override is undefined', async () => {
    resolveOnce(page(['octo/a']));
    const { result } = renderHook(() => useReviewsSignal(REPOS, 'ghp_token', undefined));

    await waitFor(() => expect(result.current.get('octo/a')?.status).toBe('ready'));
    expect(mockFetchPage).toHaveBeenCalled();
  });

  it('skips REST and stays on the override when it changes to a new map', () => {
    const overrideA = new Map([
      ['octo/a', { status: 'ready' as const, requestedCount: 1, score: REVIEW_SCORE_WEIGHT }],
    ]);
    const overrideB = new Map([
      ['octo/a', { status: 'ready' as const, requestedCount: 2, score: 2 * REVIEW_SCORE_WEIGHT }],
    ]);

    const { result, rerender } = renderHook(
      ({ override }) => useReviewsSignal(REPOS, 'ghp_token', override),
      { initialProps: { override: overrideA } },
    );
    expect(result.current).toBe(overrideA);

    rerender({ override: overrideB });
    expect(result.current).toBe(overrideB);
    expect(mockFetchPage).not.toHaveBeenCalled();
  });
});
