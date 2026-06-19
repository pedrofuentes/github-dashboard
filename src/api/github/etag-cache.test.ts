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

describe('fetchWithETag / fetchWithETagResult', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn();
    globalETagCache.clear();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    globalETagCache.clear();
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

  it('throws when a 304 arrives with no cached entry to serve', async () => {
    const notModified = {
      ok: false,
      status: 304,
      headers: mockHeaders(),
      json: () => Promise.resolve({}),
      text: () => Promise.resolve(''),
    } as unknown as Response;
    vi.mocked(globalThis.fetch).mockResolvedValue(notModified);

    await expect(fetchWithETag(URL_A, BodySchema)).rejects.toThrow();
  });
});
