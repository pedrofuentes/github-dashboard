/**
 * Additional tests for fetchReviewRequestedPRs error branches that
 * github-api.test.ts does not exercise (429 retry exhaustion, 403
 * access-denied when the rate limit is not exhausted, and the generic
 * fallthrough error).
 *
 * Mocks the global fetch so no real HTTP calls are made.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchReviewRequestedPRs } from './pull-requests';
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
