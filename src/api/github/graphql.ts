/**
 * GraphQL client, concurrency limiter, and points-accounting for the GitHub
 * GraphQL API (`POST https://api.github.com/graphql`).
 *
 * This is the low-level infrastructure for the REST→GraphQL migration. It
 * mirrors the patterns in `core.ts` (retry/timeout/error classification) and
 * `search-limiter.ts` (token-bucket limiter + Retry-After recovery) so the
 * two transports are operationally consistent.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */

import { z, type ZodType } from 'zod';

import { isAbortError } from '../../lib/abort';
import { SIGNAL_FETCH_CONCURRENCY } from '../concurrency';
import {
  abortableSleep,
  buildHeaders,
  fetchWithRetry,
  GitHubApiError,
  GitHubErrorCode,
  jitterRetryDelayMs,
  parseRetryAfter,
  type RateLimitInfo,
} from './core';
import { RateLimitStore } from './rate-limit-store';

// ── GraphQL envelope ──────────────────────────────────────────────────────

/** Zod schema for a single GraphQL error object. */
export const GraphQLErrorSchema = z
  .object({
    message: z.string(),
    path: z.array(z.union([z.string(), z.number()])).optional(),
    type: z.string().optional(),
  })
  .passthrough();

/** A single error returned in a GraphQL response. */
export type GraphQLError = z.infer<typeof GraphQLErrorSchema>;

/** Zod schema for the GraphQL response envelope (`{ data?, errors? }`). */
const GraphQLEnvelopeSchema = z
  .object({
    data: z.unknown().optional(),
    errors: z.array(GraphQLErrorSchema).optional(),
  })
  .passthrough();

// ── fetchGraphQL ──────────────────────────────────────────────────────────

const GRAPHQL_URL = 'https://api.github.com/graphql';

// Floor wait (seconds) for a 429 that arrives without a Retry-After header, so
// the limiter can still back off. Mirrors the REST core's handleApiError 429.
const RATE_LIMIT_FALLBACK_SECONDS = 60;

/** Parameters for a single {@link fetchGraphQL} call. */
export interface FetchGraphQLParams<T> {
  /** GraphQL query or mutation document string. */
  query: string;
  /** Optional query variables. */
  variables?: Record<string, unknown>;
  /** Zod schema to validate the `data` portion of the response. */
  dataSchema: ZodType<T>;
  /** GitHub personal access token. */
  token: string;
  /** Optional caller-supplied abort signal. */
  signal?: AbortSignal;
  /** Optional context label surfaced in error messages (e.g. `"fetchViewer"`). */
  context?: string;
}

/** Result of a {@link fetchGraphQL} call. */
export interface FetchGraphQLResult<T> {
  /**
   * The Zod-validated `data` object, or `null` when the field is absent (e.g.
   * a full-error or partial response where `data` was omitted by the server).
   */
  data: T | null;
  /**
   * GraphQL application-level errors. Non-empty on full or partial failures.
   * A non-empty array does NOT mean the call threw — partial success is legal.
   */
  errors: GraphQLError[];
}

/**
 * Zod-validated POST to `https://api.github.com/graphql`.
 *
 * Applies the same timeout + AbortSignal + 502/503/504 retry strategy as
 * {@link fetchWithRetry} in `core.ts`. A GraphQL 200 can carry both `data`
 * **and** `errors[]` (partial success) — both are parsed and returned without
 * throwing. Transport/HTTP failures map to the same {@link GitHubApiError}
 * classification used by the REST layer.
 *
 * @throws {GitHubApiError} on transport failure, 4xx/5xx, or Zod parse error.
 */
export async function fetchGraphQL<T>(
  params: FetchGraphQLParams<T>,
): Promise<FetchGraphQLResult<T>> {
  const { query, variables, dataSchema, token, signal, context } = params;

  const headers: Record<string, string> = {
    ...buildHeaders(token),
    'Content-Type': 'application/json',
  };

  const response = await fetchWithRetry(
    GRAPHQL_URL,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({ query, variables }),
      signal,
    },
    context ?? 'fetchGraphQL',
  );

  if (!response.ok) {
    const retryAfterSeconds = parseRetryAfter(response.headers);

    if (response.status === 401) {
      throw new GitHubApiError(
        'Invalid or expired GitHub token',
        response.status,
        undefined,
        undefined,
        GitHubErrorCode.AUTH_ERROR,
      );
    }

    // 403 + Retry-After → secondary/concurrency rate limit (recoverable).
    // Treat as RATE_LIMITED (not ACCESS_DENIED) so the limiter can back off.
    if (response.status === 403 && retryAfterSeconds !== undefined) {
      throw new GitHubApiError(
        `GitHub API secondary rate limit hit. Retry after ${retryAfterSeconds}s`,
        response.status,
        undefined,
        retryAfterSeconds,
        GitHubErrorCode.RATE_LIMITED,
      );
    }

    if (response.status === 403) {
      throw new GitHubApiError(
        'Access denied. Check token permissions.',
        response.status,
        undefined,
        undefined,
        GitHubErrorCode.ACCESS_DENIED,
      );
    }

    // 429 → rate limited (recoverable). fetchWithRetry already retried the
    // retryable 429 up to MAX_RETRIES; a persistent one lands here. Mirror the
    // REST core (handleApiError 429): classify RATE_LIMITED and forward
    // Retry-After (60s floor) so the limiter backs off instead of failing.
    if (response.status === 429) {
      const waitSeconds = retryAfterSeconds ?? RATE_LIMIT_FALLBACK_SECONDS;
      throw new GitHubApiError(
        `GitHub GraphQL API rate limit exceeded (429). Retry after ${waitSeconds}s`,
        response.status,
        undefined,
        waitSeconds,
        GitHubErrorCode.RATE_LIMITED,
      );
    }

    throw new GitHubApiError(
      `GitHub GraphQL API error (${response.status})`,
      response.status,
      undefined,
      undefined,
      GitHubErrorCode.SERVER_ERROR,
    );
  }

  const envelope = GraphQLEnvelopeSchema.parse(await response.json());
  const errors: GraphQLError[] = envelope.errors ?? [];

  let data: T | null = null;
  if (envelope.data != null) {
    data = dataSchema.parse(envelope.data);
  }

  return { data, errors };
}

// ── GraphQLLimiter ────────────────────────────────────────────────────────

/**
 * Initial burst of requests granted immediately on a cold start. Matches
 * {@link SIGNAL_FETCH_CONCURRENCY} so the fan-out is bounded by the existing
 * per-signal cap, not double-throttled.
 */
export const GQL_BURST = SIGNAL_FETCH_CONCURRENCY;

/**
 * Steady-state spacing between GraphQL requests after the burst. 500 ms ⇒
 * up to 120 req/min — well within GitHub's limits while still conservative
 * enough to avoid secondary-limit 403s during large fleet scans.
 */
export const GQL_MIN_INTERVAL_MS = 500;

/** Maximum retries when a GraphQL call trips the secondary rate limit. */
export const GQL_MAX_RETRIES = 3;

/**
 * Longest `Retry-After` (seconds) treated as a recoverable secondary limit.
 * A longer wait signals primary-budget exhaustion and is propagated.
 */
export const GQL_MAX_RETRY_WAIT_SECONDS = 90;

type GQLTask<T> = () => Promise<T> | T;

interface Waiter<T = unknown> {
  readonly task: GQLTask<T>;
  readonly signal?: AbortSignal;
  readonly resolve: (value: T) => void;
  readonly reject: (reason: unknown) => void;
  onAbort?: () => void;
}

function abortError(): DOMException {
  return new DOMException('The operation was aborted', 'AbortError');
}

/**
 * Token-bucket limiter for the GraphQL API. Mirrors {@link SearchLimiter} from
 * `search-limiter.ts` but with constants tuned for the GraphQL endpoint.
 * Construct a fresh instance for isolated tests; the application shares the
 * {@link graphqlLimiter} singleton via {@link scheduleGraphQLRequest}.
 */
export class GraphQLLimiter {
  private readonly capacity: number;
  private readonly intervalMs: number;
  private tokens: number;
  private readonly queue: Array<Waiter> = [];
  private refillTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(capacity: number = GQL_BURST, intervalMs: number = GQL_MIN_INTERVAL_MS) {
    this.capacity = Math.max(1, Math.floor(capacity));
    this.intervalMs = Math.max(0, intervalMs);
    this.tokens = this.capacity;
  }

  /**
   * Runs `task` once a GraphQL token is available, retrying on a recoverable
   * secondary-limit 403 (with `Retry-After`). Resolves with the task value or
   * rejects with its error (or `AbortError` when `signal` fires first).
   */
  schedule<T>(task: GQLTask<T>, signal?: AbortSignal): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (signal?.aborted) {
        reject(abortError());
        return;
      }

      const waiter: Waiter<T> = { task, signal, resolve, reject };
      if (signal) {
        waiter.onAbort = (): void => this.abortWaiter(waiter as Waiter);
        signal.addEventListener('abort', waiter.onAbort, { once: true });
      }
      this.queue.push(waiter as Waiter);
      this.pump();
    });
  }

  /** Restores a full bucket and drops any queued waiters (test helper). */
  reset(): void {
    this.clearRefillTimer();
    for (const waiter of this.queue) this.detachAbort(waiter);
    this.queue.length = 0;
    this.tokens = this.capacity;
  }

  private pump(): void {
    while (this.queue.length > 0 && this.tokens > 0) {
      this.tokens -= 1;
      const waiter = this.queue.shift() as Waiter;
      this.detachAbort(waiter);
      void this.runWaiter(waiter);
    }
    this.ensureRefillTimer();
  }

  private ensureRefillTimer(): void {
    if (this.refillTimer !== null) return;
    if (this.tokens >= this.capacity) return;
    this.refillTimer = setTimeout(() => {
      this.refillTimer = null;
      if (this.tokens < this.capacity) this.tokens += 1;
      this.pump();
    }, this.intervalMs);
  }

  private clearRefillTimer(): void {
    if (this.refillTimer !== null) {
      clearTimeout(this.refillTimer);
      this.refillTimer = null;
    }
  }

  private async runWaiter(waiter: Waiter): Promise<void> {
    try {
      waiter.resolve(await this.runWithRetry(waiter.task, waiter.signal));
    } catch (err) {
      waiter.reject(err);
    }
  }

  private async runWithRetry<T>(task: GQLTask<T>, signal?: AbortSignal): Promise<T> {
    let attempt = 0;
    for (;;) {
      try {
        return await task();
      } catch (err) {
        if (isAbortError(err) || signal?.aborted) throw err;
        const retryAfterSeconds = secondaryLimitRetryAfter(err);
        if (retryAfterSeconds === undefined || attempt >= GQL_MAX_RETRIES) throw err;
        attempt += 1;
        await abortableSleep(jitterRetryDelayMs(retryAfterSeconds * 1000), signal);
      }
    }
  }

  private abortWaiter(waiter: Waiter): void {
    const index = this.queue.indexOf(waiter);
    if (index >= 0) this.queue.splice(index, 1);
    this.detachAbort(waiter);
    waiter.reject(abortError());
    if (this.queue.length === 0) this.clearRefillTimer();
  }

  private detachAbort(waiter: Waiter): void {
    if (waiter.signal && waiter.onAbort) {
      waiter.signal.removeEventListener('abort', waiter.onAbort);
      waiter.onAbort = undefined;
    }
  }
}

/**
 * Whether `err` is a recoverable secondary rate limit with a `Retry-After` in
 * the valid range. Returns `undefined` to propagate (not rate-limited, missing
 * `Retry-After`, or a window long enough to be a primary-budget reset).
 */
function secondaryLimitRetryAfter(err: unknown): number | undefined {
  if (!(err instanceof GitHubApiError)) return undefined;
  if (err.code !== GitHubErrorCode.RATE_LIMITED) return undefined;
  const retryAfter = err.retryAfterSeconds;
  if (retryAfter === undefined || retryAfter < 0) return undefined;
  if (retryAfter > GQL_MAX_RETRY_WAIT_SECONDS) return undefined;
  return retryAfter;
}

/** Process-wide GraphQL limiter shared by all GraphQL callers. */
export const graphqlLimiter = new GraphQLLimiter();

/**
 * Schedules a GraphQL request on the shared {@link graphqlLimiter}. Wrap every
 * GraphQL fetch in this so the whole fleet shares one concurrency budget.
 */
export function scheduleGraphQLRequest<T>(task: GQLTask<T>, signal?: AbortSignal): Promise<T> {
  return graphqlLimiter.schedule(task, signal);
}

// ── Points accounting ─────────────────────────────────────────────────────

/**
 * The `rateLimit` fragment a GraphQL response may carry inside `data`.
 * Validated by {@link GraphQLRateLimitPartSchema}.
 */
export interface GraphQLRateLimitPart {
  /** Points consumed by this query. */
  cost?: number;
  /** Points remaining in the current window. */
  remaining: number;
  /** ISO-8601 timestamp when the window resets. */
  resetAt: string;
  /** Total points budget (defaults to 5 000 when absent). */
  limit?: number;
}

/** Zod schema for the GraphQL `rateLimit` response fragment. */
export const GraphQLRateLimitPartSchema = z
  .object({
    cost: z.number().optional(),
    remaining: z.number(),
    resetAt: z.string(),
    limit: z.number().optional(),
  })
  .passthrough();

/**
 * A dedicated rate-limit store for the GraphQL points budget.
 *
 * Uses the same {@link RateLimitStore} class as the REST layer but as a
 * separate instance so the two independent budgets (REST core + GraphQL) are
 * tracked independently without a new class. Future hooks can subscribe to it
 * exactly like they do with `rateLimitStore`.
 */
export const graphqlRateLimitStore = new RateLimitStore();

/**
 * Records a GraphQL response's `rateLimit` fragment into
 * {@link graphqlRateLimitStore}.
 *
 * Call this from any GraphQL loader that includes `rateLimit { cost remaining
 * resetAt }` in its query. The store notifies subscribers and updates the
 * pause window when the budget is critically low.
 *
 * @param snapshotPart - The validated `rateLimit` object from the response data.
 */
export function recordGraphQLCost(snapshotPart: GraphQLRateLimitPart): void {
  const limit = snapshotPart.limit ?? 5000;
  const info: RateLimitInfo = {
    limit,
    remaining: snapshotPart.remaining,
    reset: new Date(snapshotPart.resetAt),
    used: limit - snapshotPart.remaining,
  };
  graphqlRateLimitStore.record(info);
}
