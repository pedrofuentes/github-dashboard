/**
 * GitHub API infrastructure: HTTP helpers, error handling, and shared types.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */

import { isAbortError } from '../../lib/abort';

/** Canonical error codes for GitHub API errors. */
export enum GitHubErrorCode {
  RATE_LIMITED = 'rate_limited',
  NOT_FOUND = 'not_found',
  AUTH_ERROR = 'auth_error',
  ACCESS_DENIED = 'access_denied',
  SERVER_ERROR = 'server_error',
  NETWORK_ERROR = 'network_error',
  TIMEOUT = 'timeout',
}

/** Rate limit information from response headers */
export interface RateLimitInfo {
  limit: number;
  remaining: number;
  reset: Date;
  used: number;
}

/** Structured error from the GitHub API */
export class GitHubApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly rateLimitInfo?: RateLimitInfo,
    /** Seconds to wait before retrying (from Retry-After header or rate limit reset). */
    public readonly retryAfterSeconds?: number,
    /** Canonical error code for structured classification. */
    public readonly code?: GitHubErrorCode,
  ) {
    super(message);
    this.name = 'GitHubApiError';
  }
}

export const GITHUB_API_BASE = 'https://api.github.com';
const GITHUB_API_VERSION = '2022-11-28';

/**
 * Extracts rate limit information from GitHub API response headers.
 */
export function parseRateLimitHeaders(headers: Headers): RateLimitInfo {
  return {
    limit: parseInt(headers.get('x-ratelimit-limit') ?? '0', 10),
    remaining: parseInt(headers.get('x-ratelimit-remaining') ?? '0', 10),
    reset: new Date(parseInt(headers.get('x-ratelimit-reset') ?? '0', 10) * 1000),
    used: parseInt(headers.get('x-ratelimit-used') ?? '0', 10),
  };
}

/**
 * Builds the standard headers for GitHub API requests.
 */
export function buildHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': GITHUB_API_VERSION,
    'User-Agent': 'github-dashboard',
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  return headers;
}

/**
 * Fetch with timeout and network error handling.
 * Wraps fetch() with a 30-second AbortSignal timeout and converts
 * network errors into GitHubApiError with context.
 *
 * When the caller supplies `options.signal`, an abort on that signal is
 * forwarded to the internal timeout controller and rethrown as a raw
 * `AbortError` so {@link fetchWithRetry} can distinguish an intentional
 * cancellation (do not retry) from a transient 30s timeout (retryable).
 */
export async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  context?: string,
): Promise<Response> {
  const { signal: externalSignal, ...rest } = options;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  // Bridge the caller's signal to the internal controller so a single
  // controller.signal drives both the timeout and caller-initiated aborts.
  const forwardAbort = (): void => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener('abort', forwardAbort, { once: true });
  }

  try {
    const response = await fetch(url, { ...rest, signal: controller.signal });
    return response;
  } catch (err) {
    // An aborted fetch rejects with a DOMException named "AbortError". If the
    // caller's signal triggered it, rethrow the raw AbortError so the retry
    // loop short-circuits; otherwise it was our 30s timeout (retryable).
    if (isAbortError(err)) {
      if (externalSignal?.aborted) {
        throw err;
      }
      throw new GitHubApiError(
        `Request timed out after 30s${context ? ` (${context})` : ''}`,
        0,
        undefined,
        undefined,
        GitHubErrorCode.TIMEOUT,
      );
    }
    throw new GitHubApiError(
      `Network error: ${err instanceof Error ? err.message : 'unknown'}${context ? ` (${context})` : ''}`,
      0,
      undefined,
      undefined,
      GitHubErrorCode.NETWORK_ERROR,
    );
  } finally {
    clearTimeout(timeoutId);
    externalSignal?.removeEventListener('abort', forwardAbort);
  }
}

/** Maximum retry attempts for transient failures. */
const MAX_RETRIES = 3;

/** Base delay between retries in ms (exponential: 1s, 2s, 4s). */
const RETRY_BASE_DELAY_MS = 1000;

/** HTTP status codes that are safe to retry. */
const RETRYABLE_STATUS_CODES = new Set([429, 502, 503, 504]);

/**
 * A `setTimeout`-based delay that settles early when `signal` aborts.
 *
 * The retry loop's backoff must honour caller cancellation: when a token change
 * or unmount aborts `options.signal` during a 1–4s (or `Retry-After`) sleep, we
 * reject with an `AbortError` (the same shape `fetch` produces) the moment the
 * signal fires and clear the pending timer — so a cancelled run never blocks for
 * its full delay and never schedules another network request. With no signal (or
 * an un-aborted one) it behaves exactly like `setTimeout`.
 *
 * @param ms - Delay in milliseconds.
 * @param signal - Optional signal that rejects the sleep early on 'abort'.
 * @returns A promise that resolves after `ms`, or rejects on abort.
 */
export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('The operation was aborted', 'AbortError'));
      return;
    }

    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new DOMException('The operation was aborted', 'AbortError'));
    };

    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Fetch with automatic retry for transient failures.
 * Retries up to 3 times with exponential backoff (1s, 2s, 4s).
 * Only retries network errors, timeouts, and specific HTTP status codes (429, 502-504).
 * Non-retryable errors (401, 403, 404, 422) fail immediately.
 *
 * The backoff sleep is abort-aware (see {@link abortableSleep}): a caller-abort
 * via `options.signal` during a backoff rejects with `AbortError` at once and
 * short-circuits the loop, so no further request is made. A genuine 30s timeout
 * (no external abort) remains retryable.
 */
export async function fetchWithRetry(
  url: string,
  options: RequestInit = {},
  context?: string,
): Promise<Response> {
  const signal = options.signal ?? undefined;
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetchWithTimeout(url, options, context);

      if (RETRYABLE_STATUS_CODES.has(response.status) && attempt < MAX_RETRIES) {
        const retryAfter = parseRetryAfter(response.headers);
        const delay = retryAfter ? retryAfter * 1000 : RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
        await abortableSleep(delay, signal);
        continue;
      }

      return response;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      // A caller-abort (raw AbortError) — whether from the fetch itself or from
      // an aborted backoff sleep — must stop the loop and propagate unchanged.
      if (isAbortError(err)) {
        throw err;
      }

      if (
        err instanceof GitHubApiError &&
        (err.code === GitHubErrorCode.NETWORK_ERROR || err.code === GitHubErrorCode.TIMEOUT)
      ) {
        if (attempt < MAX_RETRIES) {
          const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
          await abortableSleep(delay, signal);
          continue;
        }
      }

      throw err;
    }
  }

  throw (
    lastError ??
    new GitHubApiError(
      'Max retries exceeded',
      0,
      undefined,
      undefined,
      GitHubErrorCode.NETWORK_ERROR,
    )
  );
}

/**
 * Parses the Retry-After header value into seconds.
 * Supports both delay-seconds (integer) and HTTP-date formats.
 *
 * @param headers - Response headers
 * @returns Seconds to wait, or undefined if header is missing/invalid
 */
export function parseRetryAfter(headers: Headers): number | undefined {
  const raw = headers.get('retry-after');
  if (!raw) return undefined;

  // Try as integer seconds first
  const seconds = parseInt(raw, 10);
  if (!isNaN(seconds) && seconds >= 0) return seconds;

  // Try as HTTP-date
  const date = new Date(raw);
  if (!isNaN(date.getTime())) {
    const delta = Math.ceil((date.getTime() - Date.now()) / 1000);
    return Math.max(delta, 0);
  }

  return undefined;
}

/**
 * Centralized error handler for GitHub API responses.
 * @throws {GitHubApiError} always
 */
export function handleApiError(
  status: number,
  rateLimitInfo: RateLimitInfo,
  owner: string,
  repo: string,
  retryAfterSeconds?: number,
): never {
  if (status === 401) {
    throw new GitHubApiError(
      'Invalid or expired GitHub token',
      status,
      rateLimitInfo,
      undefined,
      GitHubErrorCode.AUTH_ERROR,
    );
  }

  if (status === 429) {
    const waitSec =
      retryAfterSeconds ??
      Math.max(Math.ceil((rateLimitInfo.reset.getTime() - Date.now()) / 1000), 60);
    throw new GitHubApiError(
      `GitHub API rate limit exceeded (429). Retry after ${waitSec}s`,
      status,
      rateLimitInfo,
      waitSec,
      GitHubErrorCode.RATE_LIMITED,
    );
  }

  if (status === 403 && retryAfterSeconds !== undefined) {
    // Secondary rate limit: GitHub returns 403 + Retry-After while the primary
    // budget (x-ratelimit-remaining) may still look healthy. Treat it as a
    // recoverable RATE_LIMITED error so the Search limiter can back off (#495),
    // rather than a permanent ACCESS_DENIED.
    throw new GitHubApiError(
      `GitHub API secondary rate limit hit. Retry after ${retryAfterSeconds}s`,
      status,
      rateLimitInfo,
      retryAfterSeconds,
      GitHubErrorCode.RATE_LIMITED,
    );
  }

  if (status === 403 && rateLimitInfo.remaining === 0) {
    const resetTime = rateLimitInfo.reset.toLocaleTimeString();
    const waitSec = Math.max(Math.ceil((rateLimitInfo.reset.getTime() - Date.now()) / 1000), 0);
    throw new GitHubApiError(
      `GitHub API rate limit exceeded. Resets at ${resetTime}`,
      status,
      rateLimitInfo,
      waitSec > 0 ? waitSec : undefined,
      GitHubErrorCode.RATE_LIMITED,
    );
  }

  if (status === 403) {
    throw new GitHubApiError(
      'Access denied. Check token permissions.',
      status,
      rateLimitInfo,
      undefined,
      GitHubErrorCode.ACCESS_DENIED,
    );
  }

  if (status === 404) {
    throw new GitHubApiError(
      `Repository "${owner}/${repo}" not found or is private`,
      status,
      rateLimitInfo,
      undefined,
      GitHubErrorCode.NOT_FOUND,
    );
  }

  throw new GitHubApiError(
    `GitHub API error (${status})`,
    status,
    rateLimitInfo,
    undefined,
    GitHubErrorCode.SERVER_ERROR,
  );
}

/**
 * Maps an error to a user-facing label for button display.
 * Uses structured GitHubErrorCode when available, falls back to message matching.
 */
export function classifyErrorLabel(error: unknown): string {
  if (error instanceof GitHubApiError && error.code) {
    switch (error.code) {
      case GitHubErrorCode.RATE_LIMITED:
        return 'Rate Limited';
      case GitHubErrorCode.NOT_FOUND:
        return 'Not Found';
      case GitHubErrorCode.AUTH_ERROR:
        return 'Auth Error';
      case GitHubErrorCode.ACCESS_DENIED:
        return 'No Access';
      case GitHubErrorCode.SERVER_ERROR:
        return 'Server Error';
      case GitHubErrorCode.NETWORK_ERROR:
        return 'Network Error';
      case GitHubErrorCode.TIMEOUT:
        return 'Timeout';
    }
  }
  // Fallback for non-GitHubApiError errors (e.g., GraphQL errors, generic errors)
  const message =
    error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (message.includes('rate limit')) return 'Rate Limited';
  if (message.includes('not found') || message.includes('404')) return 'Not Found';
  if (message.includes('token') || message.includes('401') || message.includes('bad credentials'))
    return 'Auth Error';
  if (message.includes('access denied') || message.includes('403')) return 'No Access';
  return 'Error';
}
