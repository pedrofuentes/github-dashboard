/**
 * Tests for the ETag / If-None-Match conditional-request cache
 * (src/api/github/etag-cache.ts).
 *
 * Mocks the global fetch so no real HTTP calls are made. The headline
 * behaviour under test is the core rate-limit saving: a 304 Not Modified must
 * serve cached data WITHOUT re-parsing a body and WITHOUT a rate-limit
 * decrement.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { GitHubApiError, GitHubErrorCode } from './core';
import { ETagCache, fetchWithETag, fetchWithETagResult, globalETagCache } from './etag-cache';
import { rateLimitStore } from './rate-limit-store';

// ──────────────────────────────────────────────
// Fixtures & helpers
// ──────────────────────────────────────────────

const URL_A = 'https://api.github.com/repos/facebook/react';

const BodySchema = z.object({ value: z.number() }).passthrough();
type Body = z.infer<typeof BodySchema>;

function mockHeaders(overrides: Record<string, string> = {}): Headers {
  const defaults: Record<string, string> = {
    'x-ratelimit-limit': '5000',
    'x-ratelimit-remaining': '4999',
    'x-ratelimit-reset': Math.floor(Date.now() / 1000 + 3600).toString(),
    'x-ratelimit-used': '1',
  };
  return new Headers({ ...defaults, ...overrides });
}

function jsonResponse(body: unknown, status = 200, headers?: Headers): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: headers ?? mockHeaders(),
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

function lastFetchHeaders(index: number): Record<string, string> {
  const call = vi.mocked(globalThis.fetch).mock.calls[index];
  return (call[1]?.headers ?? {}) as Record<string, string>;
}

// ──────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────

describe('ETagCache', () => {
  it('stores, reads, reports membership and size, and deletes entries', () => {
    const cache = new ETagCache();
    expect(cache.size).toBe(0);
    expect(cache.has(URL_A)).toBe(false);
    expect(cache.get(URL_A)).toBeUndefined();

    cache.set(URL_A, { etag: '"v1"', data: { value: 1 }, storedAt: 123 });
    expect(cache.size).toBe(1);
    expect(cache.has(URL_A)).toBe(true);
    expect(cache.get(URL_A)?.etag).toBe('"v1"');

    cache.delete(URL_A);
    expect(cache.has(URL_A)).toBe(false);
  });

  it('clear() empties the cache', () => {
    const cache = new ETagCache();
    cache.set(URL_A, { etag: '"v1"', data: { value: 1 }, storedAt: 1 });
    cache.set('https://api.github.com/x', { etag: null, data: { value: 2 }, storedAt: 2 });
    expect(cache.size).toBe(2);
    cache.clear();
    expect(cache.size).toBe(0);
  });
});

describe('ETagCache — bounded LRU', () => {
  const entry = (value: number): { etag: string; data: Body; storedAt: number } => ({
    etag: `"v${value}"`,
    data: { value },
    storedAt: value,
  });
  const u = (k: string): string => `https://api.github.com/repos/o/${k}`;

  it('caps the cache at maxSize, evicting the least-recently-used entry', () => {
    const cache = new ETagCache(2);
    cache.set(u('a'), entry(1));
    cache.set(u('b'), entry(2));
    expect(cache.size).toBe(2);

    // Inserting a third entry must evict the oldest (`a`), not grow unbounded.
    cache.set(u('c'), entry(3));
    expect(cache.size).toBe(2);
    expect(cache.has(u('a'))).toBe(false);
    expect(cache.has(u('b'))).toBe(true);
    expect(cache.has(u('c'))).toBe(true);
  });

  it('a get() marks an entry most-recently-used, sparing it from eviction', () => {
    const cache = new ETagCache(2);
    cache.set(u('a'), entry(1));
    cache.set(u('b'), entry(2));

    // Touch `a` so `b` becomes the least-recently-used victim instead.
    expect(cache.get(u('a'))?.data).toEqual({ value: 1 });
    cache.set(u('c'), entry(3));

    expect(cache.has(u('a'))).toBe(true); // spared by the recent get()
    expect(cache.has(u('b'))).toBe(false); // evicted as LRU
    expect(cache.has(u('c'))).toBe(true);
  });

  it('re-setting an existing key refreshes it without growing the cache', () => {
    const cache = new ETagCache(2);
    cache.set(u('a'), entry(1));
    cache.set(u('b'), entry(2));

    // Overwriting `a` updates in place and marks it MRU; size stays at the cap.
    cache.set(u('a'), entry(9));
    expect(cache.size).toBe(2);
    expect(cache.get(u('a'))?.etag).toBe('"v9"');

    // `b` is now LRU and is evicted next.
    cache.set(u('c'), entry(3));
    expect(cache.has(u('b'))).toBe(false);
    expect(cache.has(u('a'))).toBe(true);
  });

  it('defaults to a large cap that does not evict typical fleet usage', () => {
    const cache = new ETagCache();
    for (let i = 0; i < 200; i++) cache.set(u(String(i)), entry(i));
    expect(cache.size).toBe(200);
    expect(cache.has(u('0'))).toBe(true);
  });
});

describe('fetchWithETag / fetchWithETagResult', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn();
    globalETagCache.clear();
    rateLimitStore.reset();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    globalETagCache.clear();
    rateLimitStore.reset();
  });

  it('on a first (uncached) request: sends no If-None-Match, validates and caches the body', async () => {
    const body: Body = { value: 1 };
    vi.mocked(globalThis.fetch).mockResolvedValue(
      jsonResponse(body, 200, mockHeaders({ etag: '"v1"' })),
    );

    const result = await fetchWithETagResult(URL_A, BodySchema, { token: 'ghp_abc' });

    expect(result.notModified).toBe(false);
    expect(result.status).toBe(200);
    expect(result.data).toEqual(body);
    expect(result.rateLimit?.remaining).toBe(4999);

    // No conditional header on the first call; auth threaded through.
    const headers = lastFetchHeaders(0);
    expect(headers['If-None-Match']).toBeUndefined();
    expect(headers['Authorization']).toBe('Bearer ghp_abc');

    // The new ETag + data are cached for next time.
    const entry = globalETagCache.get(URL_A);
    expect(entry?.etag).toBe('"v1"');
    expect(entry?.data).toEqual(body);
  });

  it('serves cached data on 304 WITHOUT re-parsing the body or decrementing the rate limit', async () => {
    const body: Body = { value: 7 };
    const parseSpy = vi.spyOn(BodySchema, 'parse');

    const ok = jsonResponse(
      body,
      200,
      mockHeaders({ etag: '"v9"', 'x-ratelimit-remaining': '4999' }),
    );

    // A 304 carries no fresh body — its json() must never be invoked.
    const notModifiedJson = vi.fn(() => Promise.resolve(body));
    const notModified = {
      ok: false,
      status: 304,
      headers: mockHeaders({ 'x-ratelimit-remaining': '4999' }),
      json: notModifiedJson,
      text: () => Promise.resolve(''),
    } as unknown as Response;

    vi.mocked(globalThis.fetch).mockResolvedValueOnce(ok).mockResolvedValueOnce(notModified);

    const first = await fetchWithETagResult(URL_A, BodySchema, { token: 't' });
    const second = await fetchWithETagResult(URL_A, BodySchema, { token: 't' });

    // Cache hit semantics
    expect(first.notModified).toBe(false);
    expect(second.notModified).toBe(true);
    expect(second.status).toBe(304);
    expect(second.data).toEqual(first.data);

    // Core AC: no body re-parse on 304…
    expect(notModifiedJson).not.toHaveBeenCalled();
    expect(parseSpy).toHaveBeenCalledTimes(1); // only the 200 was Zod-validated

    // …and no rate-limit decrement (a 304 is free against the primary limit).
    expect(second.rateLimit?.remaining).toBe(4999);
    expect(second.rateLimit?.remaining).toBe(first.rateLimit?.remaining);

    // The conditional request advertised the stored ETag.
    expect(lastFetchHeaders(1)['If-None-Match']).toBe('"v9"');
  });

  it('re-validates and re-caches when a 200 returns a new ETag', async () => {
    const v1: Body = { value: 1 };
    const v2: Body = { value: 2 };
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(jsonResponse(v1, 200, mockHeaders({ etag: '"v1"' })))
      .mockResolvedValueOnce(jsonResponse(v2, 200, mockHeaders({ etag: '"v2"' })));

    const first = await fetchWithETag(URL_A, BodySchema);
    const second = await fetchWithETag(URL_A, BodySchema);

    expect(first).toEqual(v1);
    expect(second).toEqual(v2);
    expect(globalETagCache.get(URL_A)?.etag).toBe('"v2"');
    // Second call still advertised the previously stored ETag.
    expect(lastFetchHeaders(1)['If-None-Match']).toBe('"v1"');
  });

  it('fetchWithETag returns the parsed data directly', async () => {
    const body: Body = { value: 42 };
    vi.mocked(globalThis.fetch).mockResolvedValue(jsonResponse(body));
    await expect(fetchWithETag(URL_A, BodySchema)).resolves.toEqual(body);
  });

  it('uses a caller-provided cache instance instead of the global cache', async () => {
    const cache = new ETagCache();
    vi.mocked(globalThis.fetch).mockResolvedValue(
      jsonResponse({ value: 5 }, 200, mockHeaders({ etag: '"local"' })),
    );

    await fetchWithETag(URL_A, BodySchema, { cache });

    expect(cache.get(URL_A)?.etag).toBe('"local"');
    expect(globalETagCache.has(URL_A)).toBe(false);
  });

  it('refuses to send conditional requests to a non-GitHub origin', async () => {
    await expect(
      fetchWithETag('https://evil.example.com/repos/x', BodySchema, { token: 't' }),
    ).rejects.toThrow(/origin/i);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('rejects an unparseable URL without calling fetch', async () => {
    await expect(fetchWithETag('not-a-url', BodySchema)).rejects.toThrow();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('throws a structured NOT_FOUND error on 404', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(jsonResponse({ message: 'Not Found' }, 404));

    let caught: unknown;
    try {
      await fetchWithETag(URL_A, BodySchema);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(GitHubApiError);
    if (caught instanceof GitHubApiError) {
      expect(caught.status).toBe(404);
      expect(caught.code).toBe(GitHubErrorCode.NOT_FOUND);
    }
  });

  it('throws AUTH_ERROR on 401', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      jsonResponse({ message: 'Bad credentials' }, 401),
    );

    let caught: unknown;
    try {
      await fetchWithETag(URL_A, BodySchema, { token: 'bad' });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(GitHubApiError);
    if (caught instanceof GitHubApiError) {
      expect(caught.code).toBe(GitHubErrorCode.AUTH_ERROR);
    }
  });

  it('throws RATE_LIMITED on 403 when remaining is 0', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      jsonResponse({ message: 'rate limited' }, 403, mockHeaders({ 'x-ratelimit-remaining': '0' })),
    );

    let caught: unknown;
    try {
      await fetchWithETag(URL_A, BodySchema, { token: 't' });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(GitHubApiError);
    if (caught instanceof GitHubApiError) {
      expect(caught.code).toBe(GitHubErrorCode.RATE_LIMITED);
      expect(caught.status).toBe(403);
    }
  });

  it('throws ACCESS_DENIED on 403 when budget remains (a permissions problem)', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      jsonResponse({ message: 'forbidden' }, 403, mockHeaders({ 'x-ratelimit-remaining': '4999' })),
    );

    let caught: unknown;
    try {
      await fetchWithETag(URL_A, BodySchema, { token: 't' });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(GitHubApiError);
    if (caught instanceof GitHubApiError) {
      expect(caught.code).toBe(GitHubErrorCode.ACCESS_DENIED);
      expect(caught.status).toBe(403);
    }
  });

  it('throws SERVER_ERROR on an unclassified status (500)', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(jsonResponse({ message: 'boom' }, 500));

    let caught: unknown;
    try {
      await fetchWithETag(URL_A, BodySchema);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(GitHubApiError);
    if (caught instanceof GitHubApiError) {
      expect(caught.code).toBe(GitHubErrorCode.SERVER_ERROR);
      expect(caught.status).toBe(500);
    }
  });

  it('throws RATE_LIMITED on a persistent 429 after retries are exhausted', async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(globalThis.fetch).mockResolvedValue(
        jsonResponse({ message: 'too many' }, 429, mockHeaders({ 'x-ratelimit-remaining': '0' })),
      );

      let caught: unknown;
      const settled = fetchWithETag(URL_A, BodySchema, { token: 't' }).catch((err: unknown) => {
        caught = err;
      });
      // Drive the exponential backoff (1s + 2s + 4s) to completion.
      await vi.advanceTimersByTimeAsync(8000);
      await settled;

      expect(caught).toBeInstanceOf(GitHubApiError);
      if (caught instanceof GitHubApiError) {
        expect(caught.code).toBe(GitHubErrorCode.RATE_LIMITED);
        expect(caught.status).toBe(429);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('throws when a 304 arrives with no cached entry to serve', async () => {
    const notModified = {
      ok: false,
      status: 304,
      headers: mockHeaders(),
      json: () => Promise.resolve({}),
      text: () => Promise.resolve(''),
    } as unknown as Response;
    vi.mocked(globalThis.fetch).mockResolvedValue(notModified);

    let caught: unknown;
    try {
      await fetchWithETag(URL_A, BodySchema);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(GitHubApiError);
    if (caught instanceof GitHubApiError) {
      expect(caught.status).toBe(304);
      expect(caught.code).toBe(GitHubErrorCode.SERVER_ERROR);
      expect(caught.message).toMatch(/no cached response/i);
    }
  });
});

describe('fetchWithETag — rate-limit awareness', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn();
    globalETagCache.clear();
    rateLimitStore.reset();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    globalETagCache.clear();
    rateLimitStore.reset();
  });

  it("records each response's budget into the live rate-limit store", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      jsonResponse(
        { value: 1 },
        200,
        mockHeaders({ 'x-ratelimit-remaining': '4242', etag: '"v1"' }),
      ),
    );

    await fetchWithETag(URL_A, BodySchema, { token: 't' });

    expect(rateLimitStore.getState().info?.remaining).toBe(4242);
  });

  it('defers a non-essential request without hitting the network while paused', async () => {
    // Critically low budget that resets in 10 minutes → the store is paused.
    rateLimitStore.record({
      limit: 5000,
      remaining: 5,
      used: 4995,
      reset: new Date(Date.now() + 600_000),
    });
    expect(rateLimitStore.isPaused()).toBe(true);

    let caught: unknown;
    try {
      await fetchWithETag(URL_A, BodySchema, { token: 't', essential: false });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(GitHubApiError);
    if (caught instanceof GitHubApiError) {
      expect(caught.code).toBe(GitHubErrorCode.RATE_LIMITED);
    }
    // The whole point: a deferred poll makes no request.
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('still performs an essential request even while paused', async () => {
    rateLimitStore.record({
      limit: 5000,
      remaining: 5,
      used: 4995,
      reset: new Date(Date.now() + 600_000),
    });
    vi.mocked(globalThis.fetch).mockResolvedValue(
      jsonResponse({ value: 1 }, 200, mockHeaders({ etag: '"v1"' })),
    );

    // essential defaults to true: critical data must not be withheld.
    await expect(fetchWithETag(URL_A, BodySchema, { token: 't' })).resolves.toEqual({ value: 1 });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('records a secondary-limit Retry-After pause from a 403 response', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      jsonResponse(
        { message: 'secondary rate limit' },
        403,
        mockHeaders({ 'x-ratelimit-remaining': '4999', 'retry-after': '60' }),
      ),
    );

    await fetchWithETag(URL_A, BodySchema, { token: 't' }).catch(() => {});

    // Even though remaining looks healthy, the Retry-After imposes a pause.
    expect(rateLimitStore.isPaused()).toBe(true);
    expect(rateLimitStore.pauseRemainingMs()).toBeGreaterThan(0);
  });

  it('classifies a secondary-limit 403 (Retry-After present) as RATE_LIMITED', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      jsonResponse(
        { message: 'secondary rate limit' },
        403,
        mockHeaders({ 'x-ratelimit-remaining': '4999', 'retry-after': '60' }),
      ),
    );

    let caught: unknown;
    try {
      await fetchWithETag(URL_A, BodySchema, { token: 't' });
    } catch (err) {
      caught = err;
    }

    // A healthy x-ratelimit-remaining must not mask a secondary rate limit: the
    // Retry-After makes this a recoverable RATE_LIMITED error (so the Search
    // limiter can back off and retry), not a permanent ACCESS_DENIED.
    expect(caught).toBeInstanceOf(GitHubApiError);
    expect((caught as GitHubApiError).code).toBe(GitHubErrorCode.RATE_LIMITED);
    expect((caught as GitHubApiError).retryAfterSeconds).toBe(60);
  });
});
