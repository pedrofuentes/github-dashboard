/**
 * Tests for the standalone commit-activity data layer: `fetchCommitActivity`
 * (src/api/github/commit-activity.ts) — the lazily-callable fetcher with ETag
 * conditional caching and bounded 202 retry that a later Activity tile will
 * consume. The sibling `fetchCommitActivityWeeks` lives in security-branches.ts
 * and is exercised by security-branches.test.ts.
 *
 * Mocks the global fetch so no real HTTP calls are made.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ZodError } from 'zod';

import { fetchCommitActivity } from './commit-activity';
import { ETagCache } from './etag-cache';
import { GitHubApiError, GitHubErrorCode } from './index';
import { rateLimitStore } from './rate-limit-store';

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

/** A valid 7-day week as the stats endpoint returns it (Sun..Sat). */
function week(total: number, weekStart: number, days: number[]): unknown {
  return { total, week: weekStart, days };
}

/** Builds a full 52-week fixture so the "last 52 weeks" parse is exercised. */
function fiftyTwoWeeks(): unknown[] {
  const base = 1700000000;
  return Array.from({ length: 52 }, (_, i) => week(i, base + i * 604800, [0, 1, 0, 2, 0, 1, 0]));
}

/** Reads the headers a given fetch call was issued with. */
function headersOf(call: number): Record<string, string> {
  const init = vi.mocked(globalThis.fetch).mock.calls[call]?.[1];
  return (init?.headers as Record<string, string> | undefined) ?? {};
}

describe('fetchCommitActivity', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn();
    rateLimitStore.reset();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    rateLimitStore.reset();
  });

  it('parses and returns the full 52-week history on success', async () => {
    const weeks = fiftyTwoWeeks();
    vi.mocked(globalThis.fetch).mockResolvedValue(
      mockFetchResponse(200, weeks, mockHeaders({ etag: 'W/"v1"' })),
    );

    const result = await fetchCommitActivity('owner', 'repo', 'ghp_test', {
      cache: new ETagCache(),
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error('expected ok');
    expect(result.weeks).toHaveLength(52);
    expect(result.weeks[0].days).toHaveLength(7);
    expect(result.weeks[0].total).toBe(0);
    expect(result.etag).toBe('W/"v1"');
  });

  it('records the freshly observed rate-limit budget to the shared store on success', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      mockFetchResponse(
        200,
        fiftyTwoWeeks(),
        mockHeaders({ 'x-ratelimit-remaining': '4990', etag: 'W/"v1"' }),
      ),
    );

    await fetchCommitActivity('owner', 'repo', 'ghp_test', { cache: new ETagCache() });

    // The standalone fetcher runs outside the fleet poll, so it must still feed
    // the central budget guard the budget it just observed (#155 🟢#5).
    expect(rateLimitStore.getState().info?.remaining).toBe(4990);
  });

  it('does not re-record the budget on a free conditional 304', async () => {
    const cache = new ETagCache();

    // A 200 seeds the cache and records the live budget (remaining 4990).
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      mockFetchResponse(
        200,
        fiftyTwoWeeks(),
        mockHeaders({ 'x-ratelimit-remaining': '4990', etag: 'W/"v1"' }),
      ),
    );
    await fetchCommitActivity('owner', 'repo', 'ghp_test', { cache });

    // A 304 is free (the primary budget is not decremented), so its headers must
    // NOT overwrite the store even though they advertise a lower remaining.
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      mockFetchResponse(304, '', mockHeaders({ 'x-ratelimit-remaining': '1', etag: 'W/"v1"' })),
    );
    await fetchCommitActivity('owner', 'repo', 'ghp_test', { cache });

    expect(rateLimitStore.getState().info?.remaining).toBe(4990);
  });

  it('reports "computing" while GitHub builds the stats (202)', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(mockFetchResponse(202, ''));

    const result = await fetchCommitActivity('owner', 'repo', 'ghp_test', {
      cache: new ETagCache(),
    });

    expect(result.status).toBe('computing');
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('reports "empty" for an empty repository (204)', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(mockFetchResponse(204, ''));

    const result = await fetchCommitActivity('owner', 'repo', 'ghp_test', {
      cache: new ETagCache(),
    });

    expect(result.status).toBe('empty');
  });

  it('reports "empty" when a 200 carries an empty array', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      mockFetchResponse(200, [], mockHeaders({ etag: 'W/"v0"' })),
    );

    const result = await fetchCommitActivity('owner', 'repo', 'ghp_test', {
      cache: new ETagCache(),
    });

    expect(result.status).toBe('empty');
  });

  it('serves the cached weeks on 304 using the stored ETag', async () => {
    const cache = new ETagCache();
    const weeks = fiftyTwoWeeks();

    // First call: a 200 caches the validated weeks and their ETag.
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      mockFetchResponse(200, weeks, mockHeaders({ etag: 'W/"v1"' })),
    );
    const first = await fetchCommitActivity('owner', 'repo', 'ghp_test', { cache });
    expect(first.status).toBe('ok');

    // Second call: a 304 must reuse the cached weeks without re-reading a body.
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      mockFetchResponse(304, '', mockHeaders({ etag: 'W/"v1"' })),
    );
    const second = await fetchCommitActivity('owner', 'repo', 'ghp_test', { cache });

    expect(second.status).toBe('not-modified');
    if (second.status !== 'not-modified') throw new Error('expected not-modified');
    expect(second.weeks).toHaveLength(52);
    // The conditional request must echo the stored validator.
    expect(headersOf(1)['If-None-Match']).toBe('W/"v1"');
  });

  it('rejects a malformed body via Zod', async () => {
    const bad = [{ total: 'not-a-number', week: 1700000000, days: [0, 1, 2, 3, 4, 5, 6] }];
    vi.mocked(globalThis.fetch).mockResolvedValue(
      mockFetchResponse(200, bad, mockHeaders({ etag: 'W/"bad"' })),
    );

    await expect(
      fetchCommitActivity('owner', 'repo', 'ghp_test', { cache: new ETagCache() }),
    ).rejects.toThrow(ZodError);
  });

  it('rejects a week whose days array is not length 7', async () => {
    const bad = [week(3, 1700000000, [1, 2, 3])];
    vi.mocked(globalThis.fetch).mockResolvedValue(
      mockFetchResponse(200, bad, mockHeaders({ etag: 'W/"short"' })),
    );

    await expect(
      fetchCommitActivity('owner', 'repo', 'ghp_test', { cache: new ETagCache() }),
    ).rejects.toThrow(ZodError);
  });

  it('retries a bounded number of times while 202, then reports "computing"', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(mockFetchResponse(202, ''));

    const result = await fetchCommitActivity('owner', 'repo', 'ghp_test', {
      cache: new ETagCache(),
      maxComputingRetries: 2,
      computingRetryDelayMs: 0,
    });

    expect(result.status).toBe('computing');
    // One initial attempt plus two bounded retries.
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
  });

  it('returns the data when a 202 resolves to a 200 within the retry budget', async () => {
    const weeks = fiftyTwoWeeks();
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(mockFetchResponse(202, ''))
      .mockResolvedValueOnce(mockFetchResponse(200, weeks, mockHeaders({ etag: 'W/"v1"' })));

    const result = await fetchCommitActivity('owner', 'repo', 'ghp_test', {
      cache: new ETagCache(),
      maxComputingRetries: 3,
      computingRetryDelayMs: 0,
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error('expected ok');
    expect(result.weeks).toHaveLength(52);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it('throws a GitHubApiError on API failure (500)', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      mockFetchResponse(500, { message: 'server error' }),
    );

    await expect(
      fetchCommitActivity('owner', 'repo', 'ghp_test', { cache: new ETagCache() }),
    ).rejects.toThrow(GitHubApiError);
  });

  it('works without a token for a public repository', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(mockFetchResponse(204, ''));

    const result = await fetchCommitActivity('owner', 'repo');
    expect(result.status).toBe('empty');
    expect(headersOf(0)['Authorization']).toBeUndefined();
  });

  it('throws a GitHubApiError when a 304 arrives with no cached entry', async () => {
    // A 304 can only be honoured when a prior 200 seeded the cache. With an
    // empty cache there is nothing to replay, so the fetcher surfaces the
    // unexpected 304 as a server error instead of returning undefined weeks.
    vi.mocked(globalThis.fetch).mockResolvedValue(
      mockFetchResponse(304, '', mockHeaders({ etag: 'W/"v1"' })),
    );

    const error = await fetchCommitActivity('owner', 'repo', 'ghp_test', {
      cache: new ETagCache(),
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(GitHubApiError);
    expect((error as GitHubApiError).status).toBe(304);
    expect((error as GitHubApiError).code).toBe(GitHubErrorCode.SERVER_ERROR);
    // An empty cache sends no conditional validator with the request.
    expect(headersOf(0)['If-None-Match']).toBeUndefined();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('aborts cleanly when the signal fires during the 202 retry backoff', async () => {
    vi.useFakeTimers();
    try {
      // Always-202 keeps the loop in its bounded backoff so the abort lands
      // inside abortableSleep rather than between requests.
      vi.mocked(globalThis.fetch).mockResolvedValue(mockFetchResponse(202, ''));
      const controller = new AbortController();

      const pending = fetchCommitActivity('owner', 'repo', 'ghp_test', {
        cache: new ETagCache(),
        maxComputingRetries: 3,
        computingRetryDelayMs: 1000,
        signal: controller.signal,
      });
      // Attach the rejection expectation before driving the clock so the abort
      // can never surface as an unhandled rejection.
      const settled = expect(pending).rejects.toMatchObject({ name: 'AbortError' });

      // Flush the initial 202 so the loop parks in the 1s backoff sleep (the
      // backoff timer is pending, not yet fired).
      await vi.advanceTimersByTimeAsync(0);
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);

      // Abort mid-backoff: abortableSleep rejects and short-circuits the loop.
      controller.abort();
      await settled;

      // The abort prevented a second attempt; no further fetch was issued.
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
