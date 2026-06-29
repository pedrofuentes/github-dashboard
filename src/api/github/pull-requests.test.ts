/**
 * Tests for pull-requests module functions.
 *
 * Covers fetchPullRequestCount Search-limiter routing (ensures the Search call
 * is throttled through scheduleSearchRequest like the other Search callers),
 * fetchReviewRequestedPRs error branches (429 retry exhaustion, 403
 * access-denied when the rate limit is not exhausted, and the generic
 * fallthrough error), and fetchReviewRequestedPage pagination/identity
 * behaviours.
 *
 * Mocks the global fetch so no real HTTP calls are made.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  fetchOpenPullRequestCount,
  fetchPullRequestCount,
  fetchReviewRequestedPRs,
  fetchReviewRequestedPage,
} from './pull-requests';
import { GitHubApiError, searchLimiter } from './index';

function mockHeaders(overrides: Record<string, string> = {}): Headers {
  const defaults: Record<string, string> = {
    'x-ratelimit-limit': '5000',
    'x-ratelimit-remaining': '4999',
    'x-ratelimit-reset': Math.floor(Date.now() / 1000 + 3600).toString(),
    'x-ratelimit-used': '1',
  };
  return new Headers({ ...defaults, ...overrides });
}

function mockFetchResponse(status: number, body: unknown, headers?: Headers): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: headers ?? mockHeaders(),
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

// ──────────────────────────────────────────────
// fetchPullRequestCount — Search-limiter routing
// ──────────────────────────────────────────────

describe('fetchPullRequestCount — Search-limiter routing', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn();
    searchLimiter.reset();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    searchLimiter.reset();
  });

  it('returns total_count from the Search API', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(mockFetchResponse(200, { total_count: 5 }));

    const result = await fetchPullRequestCount('owner', 'repo', 'ghp_test');
    expect(result).toBe(5);
  });

  it('retries through the shared Search limiter on a secondary-limit 403, then resolves', async () => {
    // A 403 carrying Retry-After is a secondary rate limit. When fetchPullRequestCount
    // routes through the shared Search limiter, it is reclassified as RATE_LIMITED
    // and retried, so the count resolves instead of throwing (mirrors #495 fix for
    // fetchViewerIssueCount). Without the limiter, a 403 propagates as a GitHubApiError
    // and no retry occurs — this test FAILS before the fix.
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(
        mockFetchResponse(
          403,
          { message: 'secondary rate limit' },
          mockHeaders({ 'retry-after': '0' }),
        ),
      )
      .mockResolvedValueOnce(mockFetchResponse(200, { total_count: 3 }));

    const result = await fetchPullRequestCount('owner', 'repo', 'ghp_test', 'open');
    expect(result).toBe(3);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it('builds a URL with type:pr and is:open qualifiers for the open state', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(mockFetchResponse(200, { total_count: 2 }));

    await fetchPullRequestCount('owner', 'repo', 'ghp_test', 'open');
    const url = vi.mocked(globalThis.fetch).mock.calls[0][0] as string;
    const decoded = decodeURIComponent(url);
    expect(decoded).toContain('repo:owner/repo');
    expect(decoded).toContain('type:pr');
    expect(decoded).toContain('is:open');
    expect(url).toContain('per_page=1');
  });

  it('omits the state qualifier when state is "all"', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(mockFetchResponse(200, { total_count: 10 }));

    await fetchPullRequestCount('owner', 'repo', 'ghp_test', 'all');
    const url = vi.mocked(globalThis.fetch).mock.calls[0][0] as string;
    const decoded = decodeURIComponent(url);
    expect(decoded).toContain('type:pr');
    expect(decoded).not.toContain('is:open');
    expect(decoded).not.toContain('is:closed');
  });

  it('throws GitHubApiError on a non-retryable non-OK response', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      mockFetchResponse(401, { message: 'Bad credentials' }),
    );

    await expect(fetchPullRequestCount('owner', 'repo', 'bad_token')).rejects.toThrow(
      GitHubApiError,
    );
  });
});

describe('fetchOpenPullRequestCount — Search-limiter routing', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn();
    searchLimiter.reset();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    searchLimiter.reset();
    vi.restoreAllMocks();
  });

  it('schedules the open PR count Search request through the shared Search limiter', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(mockFetchResponse(200, { total_count: 4 }));
    const scheduleSpy = vi.spyOn(searchLimiter, 'schedule');

    const result = await fetchOpenPullRequestCount('owner', 'repo', 'ghp_test');

    expect(result).toBe(4);
    expect(scheduleSpy).toHaveBeenCalledTimes(1);
    expect(scheduleSpy).toHaveBeenCalledWith(expect.any(Function), undefined);
  });
});

describe('fetchReviewRequestedPRs — error branches', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
  });

  it('throws a 429 rate-limit error after exhausting retries', async () => {
    vi.useFakeTimers();
    vi.mocked(globalThis.fetch).mockResolvedValue(
      mockFetchResponse(429, { message: 'rate limit exceeded' }),
    );

    const settled = fetchReviewRequestedPRs('ghp_test').catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(10000);
    const err = await settled;

    expect(err).toBeInstanceOf(GitHubApiError);
    expect((err as GitHubApiError).status).toBe(429);
    expect((err as GitHubApiError).message).toContain('rate limit exceeded (429)');
  });

  it('throws "Access denied" on 403 when the rate limit is not exhausted', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      mockFetchResponse(
        403,
        { message: 'forbidden' },
        mockHeaders({ 'x-ratelimit-remaining': '100' }),
      ),
    );

    await expect(fetchReviewRequestedPRs('ghp_test')).rejects.toThrow('Access denied');
  });

  it('throws a generic error on an unexpected status (500)', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      mockFetchResponse(500, { message: 'server error' }),
    );

    await expect(fetchReviewRequestedPRs('ghp_test')).rejects.toThrow('GitHub API error (500)');
  });
});

describe('fetchReviewRequestedPage', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn();
    searchLimiter.reset();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    searchLimiter.reset();
    vi.restoreAllMocks();
  });

  const PAGE1_URL =
    'https://api.github.com/search/issues?q=is%3Aopen+is%3Apr+review-requested%3A%40me&per_page=100';
  const PAGE2_URL = `${PAGE1_URL}&page=2`;
  const LAST_URL = `${PAGE1_URL}&page=3`;

  /** Builds a Search page body whose items carry the full per-PR identity. */
  function pageBody(repoFullNames: string[], totalCount: number): unknown {
    return {
      total_count: totalCount,
      incomplete_results: false,
      items: repoFullNames.map((name, index) => ({
        repository_url: `https://api.github.com/repos/${name}`,
        number: index + 1,
        title: `PR ${index + 1} in ${name}`,
        html_url: `https://github.com/${name}/pull/${index + 1}`,
        created_at: '2024-01-01T00:00:00Z',
        user: { login: `user-${index + 1}` },
      })),
    };
  }

  it('returns items, total count, and the next-page URL from the Link header', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      mockFetchResponse(
        200,
        pageBody(['octo/a', 'octo/b'], 150),
        mockHeaders({ link: `<${PAGE2_URL}>; rel="next", <${LAST_URL}>; rel="last"` }),
      ),
    );

    const page = await fetchReviewRequestedPage(PAGE1_URL, { token: 'ghp_test' });

    expect(page.totalCount).toBe(150);
    expect(page.items.map((item) => item.repository_url)).toEqual([
      'https://api.github.com/repos/octo/a',
      'https://api.github.com/repos/octo/b',
    ]);
    expect(page.nextPageUrl).toBe(PAGE2_URL);
  });

  it('schedules the review-requested Search page through the shared Search limiter', async () => {
    const controller = new AbortController();
    vi.mocked(globalThis.fetch).mockResolvedValue(mockFetchResponse(200, pageBody(['octo/a'], 1)));
    const scheduleSpy = vi.spyOn(searchLimiter, 'schedule');

    const page = await fetchReviewRequestedPage(PAGE1_URL, {
      token: 'ghp_test',
      signal: controller.signal,
    });

    expect(page.totalCount).toBe(1);
    expect(scheduleSpy).toHaveBeenCalledTimes(1);
    expect(scheduleSpy).toHaveBeenCalledWith(expect.any(Function), controller.signal);
  });

  it('retains each PR\u2019s identity (number/title/url/created_at/login) for the inbox (AC-4)', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      mockFetchResponse(200, {
        total_count: 1,
        incomplete_results: false,
        items: [
          {
            repository_url: 'https://api.github.com/repos/octo/a',
            number: 7,
            title: 'Fix the thing',
            html_url: 'https://github.com/octo/a/pull/7',
            created_at: '2024-04-01T00:00:00Z',
            user: { login: 'octocat' },
          },
        ],
      }),
    );

    const page = await fetchReviewRequestedPage(PAGE1_URL, { token: 'ghp_test' });

    // The reader stops projecting items down to `repository_url` only: every
    // field the `review:<repo>:#<n>` Inbox item needs is already on the page.
    expect(page.items[0]).toEqual({
      repository_url: 'https://api.github.com/repos/octo/a',
      number: 7,
      title: 'Fix the thing',
      html_url: 'https://github.com/octo/a/pull/7',
      created_at: '2024-04-01T00:00:00Z',
      user_login: 'octocat',
    });
  });

  it('defaults a missing PR author login to an empty string', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      mockFetchResponse(200, {
        total_count: 1,
        incomplete_results: false,
        items: [
          {
            repository_url: 'https://api.github.com/repos/octo/a',
            number: 3,
            title: 'Ghost author',
            html_url: 'https://github.com/octo/a/pull/3',
            created_at: '2024-04-02T00:00:00Z',
            user: null,
          },
        ],
      }),
    );

    const page = await fetchReviewRequestedPage(PAGE1_URL, { token: 'ghp_test' });

    expect(page.items[0].user_login).toBe('');
  });

  it('reports no next page when the Link header is absent (single page)', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(mockFetchResponse(200, pageBody(['octo/a'], 1)));

    const page = await fetchReviewRequestedPage(PAGE1_URL, { token: 'ghp_test' });

    expect(page.items).toHaveLength(1);
    expect(page.nextPageUrl).toBeNull();
  });

  it('reports no next page when the Link header has no rel="next"', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      mockFetchResponse(
        200,
        pageBody(['octo/a'], 1),
        mockHeaders({ link: `<${PAGE1_URL}>; rel="prev"` }),
      ),
    );

    const page = await fetchReviewRequestedPage(PAGE1_URL, { token: 'ghp_test' });

    expect(page.nextPageUrl).toBeNull();
  });

  it('refuses to follow an off-origin Link next URL', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      mockFetchResponse(
        200,
        pageBody(['octo/a'], 1),
        mockHeaders({ link: '<https://evil.example.com/search?page=2>; rel="next"' }),
      ),
    );

    const page = await fetchReviewRequestedPage(PAGE1_URL, { token: 'ghp_test' });

    expect(page.nextPageUrl).toBeNull();
  });

  it('refuses to follow an unparseable Link next URL', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      mockFetchResponse(
        200,
        pageBody(['octo/a'], 1),
        mockHeaders({ link: '<not a url>; rel="next"' }),
      ),
    );

    const page = await fetchReviewRequestedPage(PAGE1_URL, { token: 'ghp_test' });

    expect(page.nextPageUrl).toBeNull();
  });

  it('requests the given URL and forwards the caller AbortSignal to fetch', async () => {
    const controller = new AbortController();
    let receivedSignal: AbortSignal | undefined;
    vi.mocked(globalThis.fetch).mockImplementation((_url, init) => {
      receivedSignal = (init as RequestInit | undefined)?.signal ?? undefined;
      return Promise.resolve(mockFetchResponse(200, pageBody([], 0)));
    });

    await fetchReviewRequestedPage(PAGE1_URL, { token: 'ghp_test', signal: controller.signal });

    expect(vi.mocked(globalThis.fetch).mock.calls[0][0]).toBe(PAGE1_URL);
    expect(receivedSignal).toBeInstanceOf(AbortSignal);
    expect(receivedSignal?.aborted).toBe(false);
  });

  it('throws GitHubApiError on a non-ok status', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      mockFetchResponse(
        401,
        { message: 'Bad credentials' },
        mockHeaders({ 'x-ratelimit-remaining': '0' }),
      ),
    );

    await expect(fetchReviewRequestedPage(PAGE1_URL, { token: 'bad' })).rejects.toThrow(
      GitHubApiError,
    );
  });
});
