/**
 * ETag / `If-None-Match` conditional-request caching for the GitHub REST API.
 *
 * This is the net-new rate-limit-safety layer (vs. the ported client): an
 * in-memory cache keyed by absolute request URL stores `{ etag, data, … }`. On
 * a GET we advertise the stored ETag via `If-None-Match`; a `304 Not Modified`
 * then serves the cached, already-validated data at **zero** cost against the
 * primary rate limit (a 304 is not charged, and we never re-read the body). A
 * `200 OK` is Zod-validated and its new ETag + data are cached for next time.
 *
 * Privacy: requests (and the bearer token + stored ETag they carry) are only
 * ever sent to the GitHub API origin. Any other origin is refused.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */

import type { ZodType } from 'zod';

import {
  GITHUB_API_BASE,
  GitHubApiError,
  GitHubErrorCode,
  buildHeaders,
  fetchWithRetry,
  parseRateLimitHeaders,
  parseRetryAfter,
  type RateLimitInfo,
} from './core';

/** A single cache entry: the validated data plus the ETag that produced it. */
export interface ETagCacheEntry<T = unknown> {
  /** The `ETag` header from the response that produced `data` (or null). */
  etag: string | null;
  /** The parsed, Zod-validated response data. */
  data: T;
  /** Epoch milliseconds when this entry was stored (from the last `200 OK`). */
  storedAt: number;
  /** Rate-limit snapshot captured when the entry was stored (last `200 OK`). */
  rateLimit?: RateLimitInfo;
}

/**
 * In-memory ETag cache keyed by absolute request URL.
 *
 * Deliberately process-local: nothing is persisted, so no validated GitHub data
 * ever lands in `localStorage`/`sessionStorage`.
 */
export class ETagCache {
  private readonly store = new Map<string, ETagCacheEntry>();

  get<T = unknown>(url: string): ETagCacheEntry<T> | undefined {
    return this.store.get(url) as ETagCacheEntry<T> | undefined;
  }

  set<T = unknown>(url: string, entry: ETagCacheEntry<T>): void {
    this.store.set(url, entry);
  }

  has(url: string): boolean {
    return this.store.has(url);
  }

  delete(url: string): void {
    this.store.delete(url);
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }
}

/** Shared cache used when a caller does not supply its own instance. */
export const globalETagCache = new ETagCache();

/** Options for {@link fetchWithETag} / {@link fetchWithETagResult}. */
export interface FetchWithETagOptions {
  /** GitHub personal access token for authenticated requests. */
  token?: string;
  /** Context label for error messages (defaults to the request URL). */
  context?: string;
  /** Cache instance to use (defaults to {@link globalETagCache}). */
  cache?: ETagCache;
}

/** Result of a conditional fetch, including cache-hit and budget metadata. */
export interface ETagFetchResult<T> {
  /** The parsed, Zod-validated response data (from the network or the cache). */
  data: T;
  /** True when the server returned `304` and `data` came from the cache. */
  notModified: boolean;
  /** The HTTP status of the response (`304` on a conditional cache hit). */
  status: number;
  /**
   * Rate-limit snapshot: parsed from the live response on a `200`, or the
   * cached snapshot on a `304` (a 304 does not decrement the primary limit).
   */
  rateLimit?: RateLimitInfo;
}

const GITHUB_API_ORIGIN = new URL(GITHUB_API_BASE).origin;

/**
 * Guards against ever sending a conditional request (and the token + ETag it
 * carries) to a non-GitHub origin. Callers pass URLs from GitHub responses
 * (e.g. pagination links), so this is a hard privacy boundary.
 */
function assertGitHubApiOrigin(url: string): void {
  let origin: string;
  try {
    origin = new URL(url).origin;
  } catch {
    throw new Error(`fetchWithETag: invalid request URL "${url}"`);
  }
  if (origin !== GITHUB_API_ORIGIN) {
    throw new Error(
      `fetchWithETag: refusing to send a conditional request to non-GitHub origin "${origin}"`,
    );
  }
}

/**
 * Maps a non-ok HTTP status to a structured {@link GitHubApiError}.
 *
 * A generic, URL-keyed counterpart to `core.handleApiError` (which bakes in a
 * specific `owner/repo` for its messages); kept separate so the conditional
 * fetch path can surface the same canonical error codes for any endpoint.
 */
function throwForStatus(
  status: number,
  rateLimit: RateLimitInfo,
  retryAfterSeconds?: number,
): never {
  if (status === 401) {
    throw new GitHubApiError(
      'Invalid or expired GitHub token',
      status,
      rateLimit,
      undefined,
      GitHubErrorCode.AUTH_ERROR,
    );
  }

  if (status === 429) {
    const waitSec =
      retryAfterSeconds ?? Math.max(Math.ceil((rateLimit.reset.getTime() - Date.now()) / 1000), 60);
    throw new GitHubApiError(
      `GitHub API rate limit exceeded (429). Retry after ${waitSec}s`,
      status,
      rateLimit,
      waitSec,
      GitHubErrorCode.RATE_LIMITED,
    );
  }

  if (status === 403 && rateLimit.remaining === 0) {
    const waitSec = Math.max(Math.ceil((rateLimit.reset.getTime() - Date.now()) / 1000), 0);
    throw new GitHubApiError(
      `GitHub API rate limit exceeded. Resets at ${rateLimit.reset.toLocaleTimeString()}`,
      status,
      rateLimit,
      waitSec > 0 ? waitSec : undefined,
      GitHubErrorCode.RATE_LIMITED,
    );
  }

  if (status === 403) {
    throw new GitHubApiError(
      'Access denied. Check token permissions.',
      status,
      rateLimit,
      undefined,
      GitHubErrorCode.ACCESS_DENIED,
    );
  }

  if (status === 404) {
    throw new GitHubApiError(
      'Resource not found',
      status,
      rateLimit,
      undefined,
      GitHubErrorCode.NOT_FOUND,
    );
  }

  throw new GitHubApiError(
    `GitHub API error (${status})`,
    status,
    rateLimit,
    undefined,
    GitHubErrorCode.SERVER_ERROR,
  );
}

/**
 * Performs a conditional GET with ETag caching and returns the data plus
 * cache/rate-limit metadata.
 *
 * Existing client functions opt in by routing a GET through this wrapper
 * instead of calling `fetchWithRetry` + `schema.parse` directly — signatures
 * are unchanged and every response is still Zod-validated.
 *
 * @param url - Absolute GitHub API URL (must be on the GitHub API origin)
 * @param schema - Zod schema validating the `200` response body
 * @param options - Token, context label, and/or cache instance
 * @returns The validated data and `{ notModified, status, rateLimit }`
 * @throws {GitHubApiError} on API errors (401/403/404/429/5xx)
 * @throws {Error} when the URL is invalid or off-origin
 */
export async function fetchWithETagResult<T>(
  url: string,
  schema: ZodType<T>,
  options: FetchWithETagOptions = {},
): Promise<ETagFetchResult<T>> {
  assertGitHubApiOrigin(url);

  const cache = options.cache ?? globalETagCache;
  const cached = cache.get<T>(url);

  const headers = buildHeaders(options.token);
  if (cached?.etag) {
    headers['If-None-Match'] = cached.etag;
  }

  const response = await fetchWithRetry(url, { headers }, options.context ?? url);

  if (response.status === 304) {
    if (!cached) {
      throw new GitHubApiError(
        'Received 304 Not Modified but no cached response is available',
        304,
        parseRateLimitHeaders(response.headers),
        undefined,
        GitHubErrorCode.SERVER_ERROR,
      );
    }
    // Conditional cache hit: the body is never re-read and the primary limit is
    // never decremented. Serve the cached data and its stored rate-limit
    // snapshot (a 304 is free, so the budget is unchanged from the last 200).
    return {
      data: cached.data,
      notModified: true,
      status: 304,
      rateLimit: cached.rateLimit,
    };
  }

  const rateLimit = parseRateLimitHeaders(response.headers);

  if (!response.ok) {
    throwForStatus(response.status, rateLimit, parseRetryAfter(response.headers));
  }

  const data = schema.parse(await response.json());
  cache.set<T>(url, {
    etag: response.headers.get('etag'),
    data,
    storedAt: Date.now(),
    rateLimit,
  });

  return { data, notModified: false, status: response.status, rateLimit };
}

/**
 * Convenience wrapper over {@link fetchWithETagResult} that returns just the
 * validated data — a drop-in for `fetchWithRetry` + `schema.parse` that adds
 * `304` conditional caching transparently.
 */
export async function fetchWithETag<T>(
  url: string,
  schema: ZodType<T>,
  options: FetchWithETagOptions = {},
): Promise<T> {
  const result = await fetchWithETagResult(url, schema, options);
  return result.data;
}
