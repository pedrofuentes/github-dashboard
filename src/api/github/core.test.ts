/**
 * Tests for fetchWithRetry (src/utils/github-api/core.ts).
 *
 * Uses vi.fn() to mock the global fetch function so no real HTTP calls are made.
 * Uses vi.useFakeTimers() for verifying exponential backoff timing.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchWithRetry, GitHubApiError } from './core';

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function mockHeaders(overrides: Record<string, string> = {}): Headers {
  const defaults: Record<string, string> = {
    'x-ratelimit-limit': '5000',
    'x-ratelimit-remaining': '4999',
    'x-ratelimit-reset': Math.floor(Date.now() / 1000 + 3600).toString(),
    'x-ratelimit-used': '1',
  };
  return new Headers({ ...defaults, ...overrides });
}

function mockFetchResponse(status = 200, headers?: Headers): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: headers ?? mockHeaders(),
    json: () => Promise.resolve({}),
    text: () => Promise.resolve(''),
  } as unknown as Response;
}

// ──────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────

describe('fetchWithRetry', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn();
    vi.useFakeTimers();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
  });

  it('returns response on first success without retrying', async () => {
    const okResponse = mockFetchResponse(200);
    vi.mocked(globalThis.fetch).mockResolvedValue(okResponse);

    const result = await fetchWithRetry('https://api.github.com/test');

    expect(result).toBe(okResponse);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  // ── Retryable HTTP status codes ──────────────────────────

  it('retries on 429 and succeeds', async () => {
    const rateLimitResponse = mockFetchResponse(429);
    const okResponse = mockFetchResponse(200);
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(rateLimitResponse)
      .mockResolvedValueOnce(rateLimitResponse)
      .mockResolvedValueOnce(okResponse);

    const promise = fetchWithRetry('https://api.github.com/test');
    // Advance past retry delays: 1s (attempt 0) + 2s (attempt 1)
    await vi.advanceTimersByTimeAsync(4000);
    const result = await promise;

    expect(result).toBe(okResponse);
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
  });

  it('retries on 502 and succeeds', async () => {
    const serverErrResponse = mockFetchResponse(502);
    const okResponse = mockFetchResponse(200);
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(serverErrResponse)
      .mockResolvedValueOnce(okResponse);

    const promise = fetchWithRetry('https://api.github.com/test');
    await vi.advanceTimersByTimeAsync(2000);
    const result = await promise;

    expect(result).toBe(okResponse);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it('retries on 503 and succeeds', async () => {
    const serverErrResponse = mockFetchResponse(503);
    const okResponse = mockFetchResponse(200);
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(serverErrResponse)
      .mockResolvedValueOnce(okResponse);

    const promise = fetchWithRetry('https://api.github.com/test');
    await vi.advanceTimersByTimeAsync(2000);
    const result = await promise;

    expect(result).toBe(okResponse);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it('retries on 504 and succeeds', async () => {
    const serverErrResponse = mockFetchResponse(504);
    const okResponse = mockFetchResponse(200);
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(serverErrResponse)
      .mockResolvedValueOnce(okResponse);

    const promise = fetchWithRetry('https://api.github.com/test');
    await vi.advanceTimersByTimeAsync(2000);
    const result = await promise;

    expect(result).toBe(okResponse);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  // ── Retry-After header ──────────────────────────────────

  it('respects Retry-After header on 429', async () => {
    const headersWithRetryAfter = mockHeaders({ 'retry-after': '2' });
    const rateLimitResponse = mockFetchResponse(429, headersWithRetryAfter);
    const okResponse = mockFetchResponse(200);
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(rateLimitResponse)
      .mockResolvedValueOnce(okResponse);

    const promise = fetchWithRetry('https://api.github.com/test');

    // At 1.5s the Retry-After delay (2s) hasn't elapsed yet
    await vi.advanceTimersByTimeAsync(1500);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);

    // At 2.5s the Retry-After delay has elapsed, retry happens
    await vi.advanceTimersByTimeAsync(1000);
    const result = await promise;

    expect(result).toBe(okResponse);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  // ── Non-retryable HTTP status codes ─────────────────────

  it('does NOT retry on 401', async () => {
    const response = mockFetchResponse(401);
    vi.mocked(globalThis.fetch).mockResolvedValue(response);

    const result = await fetchWithRetry('https://api.github.com/test');

    expect(result).toBe(response);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry on 403', async () => {
    const response = mockFetchResponse(403);
    vi.mocked(globalThis.fetch).mockResolvedValue(response);

    const result = await fetchWithRetry('https://api.github.com/test');

    expect(result).toBe(response);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry on 404', async () => {
    const response = mockFetchResponse(404);
    vi.mocked(globalThis.fetch).mockResolvedValue(response);

    const result = await fetchWithRetry('https://api.github.com/test');

    expect(result).toBe(response);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry on 422', async () => {
    const response = mockFetchResponse(422);
    vi.mocked(globalThis.fetch).mockResolvedValue(response);

    const result = await fetchWithRetry('https://api.github.com/test');

    expect(result).toBe(response);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  // ── Network and timeout errors ──────────────────────────

  it('retries on network error (TypeError) then succeeds', async () => {
    const okResponse = mockFetchResponse(200);
    vi.mocked(globalThis.fetch)
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(okResponse);

    const promise = fetchWithRetry('https://api.github.com/test', {}, 'testContext');
    await vi.advanceTimersByTimeAsync(2000);
    const result = await promise;

    expect(result).toBe(okResponse);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it('retries on timeout (AbortError) then succeeds', async () => {
    const abortError = new DOMException('The operation was aborted', 'AbortError');
    const okResponse = mockFetchResponse(200);
    vi.mocked(globalThis.fetch).mockRejectedValueOnce(abortError).mockResolvedValueOnce(okResponse);

    const promise = fetchWithRetry('https://api.github.com/test', {}, 'testContext');
    await vi.advanceTimersByTimeAsync(2000);
    const result = await promise;

    expect(result).toBe(okResponse);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  // ── Exhausting retries ──────────────────────────────────

  it('gives up after MAX_RETRIES on retryable HTTP status', async () => {
    const serverErrResponse = mockFetchResponse(503);
    vi.mocked(globalThis.fetch).mockResolvedValue(serverErrResponse);

    const promise = fetchWithRetry('https://api.github.com/test');
    // Advance past all retry delays: 1s + 2s + 4s = 7s
    await vi.advanceTimersByTimeAsync(8000);
    const result = await promise;

    // After exhausting retries, returns the last response (503)
    expect(result.status).toBe(503);
    expect(globalThis.fetch).toHaveBeenCalledTimes(4); // initial + 3 retries
  });

  it('gives up after MAX_RETRIES on network error', async () => {
    vi.mocked(globalThis.fetch).mockRejectedValue(new TypeError('fetch failed'));

    const promise = fetchWithRetry('https://api.github.com/test', {}, 'testContext');
    promise.catch(() => {}); // prevent unhandled rejection during timer advance
    // Advance past all retry delays: 1s + 2s + 4s = 7s
    await vi.advanceTimersByTimeAsync(8000);

    await expect(promise).rejects.toThrow(GitHubApiError);
    expect(globalThis.fetch).toHaveBeenCalledTimes(4);
  });

  it('gives up after MAX_RETRIES on timeout error', async () => {
    const abortError = new DOMException('The operation was aborted', 'AbortError');
    vi.mocked(globalThis.fetch).mockRejectedValue(abortError);

    const promise = fetchWithRetry('https://api.github.com/test', {}, 'testContext');
    promise.catch(() => {}); // prevent unhandled rejection during timer advance
    await vi.advanceTimersByTimeAsync(8000);

    await expect(promise).rejects.toThrow(GitHubApiError);
    expect(globalThis.fetch).toHaveBeenCalledTimes(4);
  });

  // ── Non-retryable HTTP status codes pass through immediately ────

  it('uses exponential backoff delays: 1s, 2s, 4s', async () => {
    const serverErrResponse = mockFetchResponse(503);
    const okResponse = mockFetchResponse(200);
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(serverErrResponse) // attempt 0
      .mockResolvedValueOnce(serverErrResponse) // attempt 1
      .mockResolvedValueOnce(serverErrResponse) // attempt 2
      .mockResolvedValueOnce(okResponse); // attempt 3

    const promise = fetchWithRetry('https://api.github.com/test');

    // After attempt 0 fails (503), retry delay is 1s (1000 * 2^0)
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(999);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1); // Not yet

    await vi.advanceTimersByTimeAsync(1);
    // Now attempt 1 fires
    await vi.advanceTimersByTimeAsync(0); // flush microtasks
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);

    // After attempt 1 fails (503), retry delay is 2s (1000 * 2^1)
    await vi.advanceTimersByTimeAsync(1999);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2); // Not yet

    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);

    // After attempt 2 fails (503), retry delay is 4s (1000 * 2^2)
    await vi.advanceTimersByTimeAsync(3999);
    expect(globalThis.fetch).toHaveBeenCalledTimes(3); // Not yet

    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(globalThis.fetch).toHaveBeenCalledTimes(4);

    const result = await promise;
    expect(result).toBe(okResponse);
  });

  it('passes context string through to fetchWithTimeout', async () => {
    vi.mocked(globalThis.fetch).mockRejectedValue(new TypeError('fetch failed'));

    const promise = fetchWithRetry('https://api.github.com/test', {}, 'myContext');
    promise.catch(() => {}); // prevent unhandled rejection during timer advance
    await vi.advanceTimersByTimeAsync(8000);

    try {
      await promise;
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(GitHubApiError);
      const apiErr = err as InstanceType<typeof GitHubApiError>;
      expect(apiErr.message).toContain('myContext');
    }
  });
});

describe('fetchWithRetry — AbortSignal cancellation', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("aborts the underlying fetch when the caller's signal aborts", () => {
    const controller = new AbortController();
    let passedSignal: AbortSignal | undefined;
    let resolveFetch!: (response: Response) => void;
    const fetchSpy = vi.fn((_url: string, opts: RequestInit) => {
      passedSignal = opts.signal ?? undefined;
      return new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      });
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const promise = fetchWithRetry('https://api.github.com/test', { signal: controller.signal });
    promise.catch(() => {});

    // fetch was invoked synchronously with a (not-yet-aborted) signal.
    expect(passedSignal).toBeInstanceOf(AbortSignal);
    expect(passedSignal?.aborted).toBe(false);

    // Aborting the caller's signal must propagate to the signal handed to fetch.
    controller.abort();
    expect(passedSignal?.aborted).toBe(true);

    resolveFetch(mockFetchResponse(200));
  });

  it('does not retry and rejects with AbortError when the signal is already aborted', async () => {
    vi.useFakeTimers();
    const fetchSpy = vi
      .fn()
      .mockRejectedValue(new DOMException('The operation was aborted', 'AbortError'));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const controller = new AbortController();
    controller.abort();

    const promise = fetchWithRetry('https://api.github.com/test', { signal: controller.signal });
    promise.catch(() => {});
    // Give a (wrongly) retrying implementation room to fire its backoff retries.
    await vi.advanceTimersByTimeAsync(10000);

    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    // AbortError must short-circuit the retry loop: exactly one fetch attempt.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
