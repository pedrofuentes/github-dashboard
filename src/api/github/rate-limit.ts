/**
 * Rate-limit budget guard for the GitHub REST API.
 *
 * `GET /rate_limit` is free — it does not count against any limit — so it is the
 * safe way to pre-check the budget before a batch of polls. This module fetches
 * and Zod-validates that endpoint, then exposes a small guard that flags when
 * the remaining budget is low so callers can degrade gracefully (skip
 * non-critical polls, show a banner) rather than blow through the 5,000 req/hr
 * ceiling.
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
  buildHeaders,
  fetchWithRetry,
  type RateLimitInfo,
} from './core';

/** Schema for one resource bucket in the `/rate_limit` response. */
const RateResourceSchema = z
  .object({
    limit: z.number(),
    remaining: z.number(),
    reset: z.number(),
    used: z.number().optional(),
  })
  .passthrough();

/** Schema for the full `GET /rate_limit` response body. */
export const RateLimitResponseSchema = z
  .object({
    resources: z
      .object({
        core: RateResourceSchema,
        search: RateResourceSchema.optional(),
        graphql: RateResourceSchema.optional(),
      })
      .passthrough(),
    rate: RateResourceSchema,
  })
  .passthrough();

/** Parsed snapshot of the buckets this app cares about. */
export interface RateLimitSnapshot {
  /** Primary REST budget — the one polling spends. */
  core: RateLimitInfo;
  /** GraphQL points budget (separate 5,000/hr pool), when present. */
  graphql?: RateLimitInfo;
  /** Search budget, when present. */
  search?: RateLimitInfo;
}

type RawResource = z.infer<typeof RateResourceSchema>;

function toRateLimitInfo(resource: RawResource): RateLimitInfo {
  return {
    limit: resource.limit,
    remaining: resource.remaining,
    reset: new Date(resource.reset * 1000),
    used: resource.used ?? resource.limit - resource.remaining,
  };
}

/**
 * Fetches and validates `GET /rate_limit`.
 *
 * This call is free against every budget, so it is safe to call before each
 * polling batch as a backstop to the per-response `x-ratelimit-*` headers.
 *
 * @param token - GitHub personal access token (optional, but recommended)
 * @returns A validated {@link RateLimitSnapshot}
 * @throws {GitHubApiError} on a non-ok response
 * @throws {z.ZodError} when the response body is malformed
 */
export async function fetchRateLimit(token?: string): Promise<RateLimitSnapshot> {
  const response = await fetchWithRetry(
    `${GITHUB_API_BASE}/rate_limit`,
    { headers: buildHeaders(token) },
    'fetchRateLimit',
  );

  if (!response.ok) {
    const code =
      response.status === 401 ? GitHubErrorCode.AUTH_ERROR : GitHubErrorCode.SERVER_ERROR;
    throw new GitHubApiError(
      `Could not read GitHub rate limit (${response.status})`,
      response.status,
      undefined,
      undefined,
      code,
    );
  }

  const parsed = RateLimitResponseSchema.parse(await response.json());

  return {
    core: toRateLimitInfo(parsed.resources.core),
    graphql: parsed.resources.graphql ? toRateLimitInfo(parsed.resources.graphql) : undefined,
    search: parsed.resources.search ? toRateLimitInfo(parsed.resources.search) : undefined,
  };
}

/** Default: treat fewer than this many remaining requests as "low". */
export const DEFAULT_MIN_REMAINING = 100;

/** Default: treat 10% or less of the limit remaining as "low". */
export const DEFAULT_MIN_FRACTION = 0.1;

/** Thresholds controlling when the budget is considered low. */
export interface BudgetGuardOptions {
  /** Absolute remaining-request floor (default {@link DEFAULT_MIN_REMAINING}). */
  minRemaining?: number;
  /** Fractional remaining floor, 0–1 (default {@link DEFAULT_MIN_FRACTION}). */
  minFraction?: number;
}

/** A graceful-degradation verdict derived from a {@link RateLimitInfo}. */
export interface BudgetStatus {
  limit: number;
  remaining: number;
  used: number;
  reset: Date;
  /** `remaining / limit` (0 when the limit is unknown/zero). */
  fractionRemaining: number;
  /** Seconds until the window resets (clamped to ≥ 0). */
  resetInSeconds: number;
  /**
   * True when either threshold is breached → callers should back off: skip
   * non-critical polls, surface a banner, and lean on cached data.
   */
  low: boolean;
}

/**
 * Evaluates a rate-limit snapshot against the budget thresholds.
 *
 * @param info - The budget to evaluate (typically {@link RateLimitSnapshot.core})
 * @param options - Optional threshold overrides
 * @param now - Epoch milliseconds "now" (injectable for tests)
 * @returns A {@link BudgetStatus} verdict
 */
export function evaluateBudget(
  info: RateLimitInfo,
  options: BudgetGuardOptions = {},
  now: number = Date.now(),
): BudgetStatus {
  const minRemaining = options.minRemaining ?? DEFAULT_MIN_REMAINING;
  const minFraction = options.minFraction ?? DEFAULT_MIN_FRACTION;

  const fractionRemaining = info.limit > 0 ? info.remaining / info.limit : 0;
  const low = info.remaining <= minRemaining || fractionRemaining <= minFraction;
  const resetInSeconds = Math.max(Math.ceil((info.reset.getTime() - now) / 1000), 0);

  return {
    limit: info.limit,
    remaining: info.remaining,
    used: info.used,
    reset: info.reset,
    fractionRemaining,
    resetInSeconds,
    low,
  };
}

/**
 * Convenience predicate: is the budget low enough to warrant backing off?
 */
export function isBudgetLow(info: RateLimitInfo, options?: BudgetGuardOptions): boolean {
  return evaluateBudget(info, options).low;
}

/**
 * Fetches `/rate_limit` (free) and evaluates the primary (core) REST budget.
 *
 * Intended as a pre-batch guard: when the returned status is `low`, callers
 * should skip non-critical polls and degrade gracefully.
 *
 * @param token - GitHub personal access token
 * @param options - Optional threshold overrides
 * @returns The core budget {@link BudgetStatus}
 */
export async function checkRateLimitBudget(
  token?: string,
  options?: BudgetGuardOptions,
): Promise<BudgetStatus> {
  const snapshot = await fetchRateLimit(token);
  return evaluateBudget(snapshot.core, options);
}
