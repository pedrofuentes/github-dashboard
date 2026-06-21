/**
 * Standalone, lazily-callable fetcher for a repository's weekly commit activity
 * (GitHub REST `GET /repos/{owner}/{repo}/stats/commit_activity`).
 *
 * The stats endpoints are unusual: GitHub returns `202 Accepted` with an empty
 * body while it first computes a repo's statistics, and `204 No Content` (or an
 * empty array) for a repo with no commits. This module models those as typed
 * states instead of throwing, and adds ETag / `If-None-Match` conditional
 * caching so a repeat poll of unchanged stats answers `304` at zero cost against
 * the primary rate limit (mirroring {@link ETagCache} usage elsewhere).
 *
 * It is deliberately decoupled from the fleet poll: nothing here is wired into
 * `RepoSignalData`/`getRowData` or rendered. A later "Activity" tile (weekly
 * sparkline + weeks×days heatmap) will consume {@link fetchCommitActivity}
 * directly via this module path.
 *
 * Privacy: the request URL is always built from {@link GITHUB_API_BASE}, so the
 * bearer token and stored ETag only ever reach the GitHub API origin.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */

import { z } from 'zod';

import {
  GITHUB_API_BASE,
  GitHubApiError,
  GitHubErrorCode,
  abortableSleep,
  buildHeaders,
  fetchWithRetry,
  handleApiError,
  parseRateLimitHeaders,
  parseRetryAfter,
  type RateLimitInfo,
} from './core';
import { ETagCache } from './etag-cache';

/**
 * Schema for a single week of commit activity as returned by the stats API.
 *
 * `days` is the seven daily commit counts (Sunday..Saturday), and the endpoint
 * always returns exactly seven, so the length is validated to catch a malformed
 * payload before it reaches the heatmap.
 */
export const CommitActivityWeekSchema = z
  .object({
    /** Total commits in the week. */
    total: z.number(),
    /** Start of the week as a Unix timestamp in seconds (week starts Sunday). */
    week: z.number(),
    /** Daily commit counts, Sunday (0) .. Saturday (6). */
    days: z.array(z.number()).length(7),
  })
  .passthrough();

/** Schema for the full commit-activity response (the last 52 weeks). */
export const CommitActivitySchema = z.array(CommitActivityWeekSchema);

/** A single validated week of commit activity. */
export type CommitActivityWeek = z.infer<typeof CommitActivityWeekSchema>;

/** The full validated commit-activity history (up to the last 52 weeks). */
export type CommitActivity = z.infer<typeof CommitActivitySchema>;

/**
 * The outcome of {@link fetchCommitActivity}, modelled as a discriminated union
 * so callers exhaustively handle every state the stats endpoint can produce:
 *
 * - `ok` — validated weekly history (plus its ETag and rate-limit snapshot).
 * - `computing` — GitHub returned `202` and is still building the stats; retry
 *   later (a bounded retry is available via {@link FetchCommitActivityOptions}).
 * - `empty` — `204 No Content` or an empty array: the repo has no commits.
 * - `not-modified` — a conditional `304`; the cached weeks are served verbatim.
 */
export type CommitActivityResult =
  | { status: 'ok'; weeks: CommitActivity; etag: string | null; rateLimit: RateLimitInfo }
  | { status: 'not-modified'; weeks: CommitActivity }
  | { status: 'computing' }
  | { status: 'empty' };

/** Options controlling auth, cancellation, caching, and 202 retry behaviour. */
export interface FetchCommitActivityOptions {
  /** Optional signal to cancel the request (and any pending 202 backoff). */
  signal?: AbortSignal;
  /**
   * Conditional-request cache (defaults to a module-local instance). Injectable
   * so tests get isolated cache state and callers can share a single cache.
   */
  cache?: ETagCache;
  /**
   * Maximum extra attempts when GitHub replies `202` (computing). `0` (default)
   * returns `computing` immediately. The loop is always bounded — it never spins
   * indefinitely on a perpetual 202.
   */
  maxComputingRetries?: number;
  /**
   * Base backoff between 202 retries, in milliseconds (default `1000`). The wait
   * grows exponentially per retry (delay × 2^(retry-1)).
   */
  computingRetryDelayMs?: number;
}

/** Shared cache used when a caller does not supply its own instance. */
const defaultCommitActivityCache = new ETagCache();

/**
 * Fetches a repository's weekly commit activity (the last 52 weeks) with ETag
 * conditional caching and bounded retry for the stats-computing (`202`) case.
 *
 * Standalone and lazy: this is not called by the fleet poll and renders nothing
 * — it is the data layer for a later Activity tile.
 *
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param token - GitHub personal access token (omit for public repos)
 * @param options - Cancellation, cache injection, and 202 retry configuration
 * @returns A {@link CommitActivityResult} discriminating ok/computing/empty/not-modified
 * @throws {GitHubApiError} on API errors (401/403/404/429/5xx) or an unexpected
 *   `304` with no cached entry
 * @throws {z.ZodError} when a `200` body fails validation
 */
export async function fetchCommitActivity(
  owner: string,
  repo: string,
  token?: string,
  options: FetchCommitActivityOptions = {},
): Promise<CommitActivityResult> {
  const {
    signal,
    cache = defaultCommitActivityCache,
    maxComputingRetries = 0,
    computingRetryDelayMs = 1000,
  } = options;

  const url = `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/stats/commit_activity`;

  const cached = cache.get<CommitActivity>(url);
  const headers = buildHeaders(token);
  if (cached?.etag) {
    headers['If-None-Match'] = cached.etag;
  }

  let computingRetries = 0;
  for (;;) {
    const response = await fetchWithRetry(url, { headers, signal }, 'fetchCommitActivity');
    const rateLimit = parseRateLimitHeaders(response.headers);

    // 304 must be checked before `!ok` (a 304 reports `ok === false`).
    if (response.status === 304) {
      if (!cached) {
        throw new GitHubApiError(
          'Received 304 Not Modified but no cached commit activity is available',
          304,
          rateLimit,
          undefined,
          GitHubErrorCode.SERVER_ERROR,
        );
      }
      return { status: 'not-modified', weeks: cached.data };
    }

    // 202: stats are still being computed. Optionally retry with bounded backoff
    // before surfacing the "computing" state — never an unbounded spin.
    if (response.status === 202) {
      if (computingRetries < maxComputingRetries) {
        const delay = computingRetryDelayMs * Math.pow(2, computingRetries);
        computingRetries++;
        await abortableSleep(delay, signal);
        continue;
      }
      return { status: 'computing' };
    }

    // 204: empty repository (no commits, no body to parse).
    if (response.status === 204) {
      return { status: 'empty' };
    }

    if (!response.ok) {
      handleApiError(response.status, rateLimit, owner, repo, parseRetryAfter(response.headers));
    }

    const weeks = CommitActivitySchema.parse(await response.json());
    const etag = response.headers.get('etag');
    // Cache the validated weeks so a later unchanged poll can short-circuit on 304.
    cache.set<CommitActivity>(url, { etag, data: weeks, storedAt: Date.now(), rateLimit });

    if (weeks.length === 0) {
      return { status: 'empty' };
    }
    return { status: 'ok', weeks, etag, rateLimit };
  }
}
