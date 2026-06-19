/**
 * Additional tests for fetchReviewRequestedPRs error branches that
 * github-api.test.ts does not exercise (429 retry exhaustion, 403
 * access-denied when the rate limit is not exhausted, and the generic
 * fallthrough error).
 *
 * Mocks the global fetch so no real HTTP calls are made.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchReviewRequestedPRs, fetchReviewRequestedPage } from './pull-requests';
import { GitHubApiError } from './index';

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
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const PAGE1_URL =
    'https://api.github.com/search/issues?q=is%3Aopen+is%3Apr+review-requested%3A%40me&per_page=100';
  const PAGE2_URL = `${PAGE1_URL}&page=2`;
  const LAST_URL = `${PAGE1_URL}&page=3`;

  /** Builds a Search page body whose items carry only `repository_url`. */
  function pageBody(repoFullNames: string[], totalCount: number): unknown {
    return {
      total_count: totalCount,
      incomplete_results: false,
      items: repoFullNames.map((name) => ({
        repository_url: `https://api.github.com/repos/${name}`,
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
    controller.abort();
    let receivedSignal: AbortSignal | undefined;
    vi.mocked(globalThis.fetch).mockImplementation((_url, init) => {
      receivedSignal = (init as RequestInit | undefined)?.signal ?? undefined;
      return Promise.resolve(mockFetchResponse(200, pageBody([], 0)));
    });

    await fetchReviewRequestedPage(PAGE1_URL, { token: 'ghp_test', signal: controller.signal });

    expect(vi.mocked(globalThis.fetch).mock.calls[0][0]).toBe(PAGE1_URL);
    expect(receivedSignal).toBeInstanceOf(AbortSignal);
    expect(receivedSignal?.aborted).toBe(true);
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
