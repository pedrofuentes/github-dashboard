import { isAbortError } from '../../lib/abort';
import { SIGNAL_FETCH_CONCURRENCY } from '../concurrency';
import { abortableSleep, GitHubApiError, GitHubErrorCode } from './core';

/**
 * Shared Search-API rate limiter for every `search/issues` caller.
 *
 * Multiple signals fan out one (or more) GitHub Search request per repo — the
 * Stale signal, plus the open / viewer issue counts behind the Issues signal.
 * {@link mapWithConcurrency} bounds *parallelism* but not *rate*, so on a large
 * fleet the combined fan-out bursts straight past GitHub's Search secondary
 * rate limit (~30 req/min). That manifested as the Stale tile erroring on every
 * repo and the Security tile showing no grade (T-bf2 / #495).
 *
 * This token bucket throttles all of them onto that budget:
 * - a cold-start **burst** of {@link SEARCH_BURST} requests runs immediately so
 *   small fleets stay snappy (and the existing per-signal concurrency cap, also
 *   {@link SIGNAL_FETCH_CONCURRENCY}, is never the tighter constraint at start);
 * - thereafter one request is released every {@link SEARCH_MIN_INTERVAL_MS}
 *   (~30 req/min), and the bucket lazily refills back to full while idle;
 * - a detected secondary-limit 403 (a {@link GitHubErrorCode.RATE_LIMITED}
 *   error carrying a short `Retry-After`) is retried up to
 *   {@link SEARCH_MAX_RETRIES} times, honoring `Retry-After`, so a transient
 *   limit recovers to `ready` instead of erroring the repo.
 *
 * All timing is driven by `setTimeout`/{@link abortableSleep}, never the wall
 * clock, so fake timers fully control it in tests.
 */

/**
 * Requests granted instantly on a cold start before throttling engages. Matched
 * to {@link SIGNAL_FETCH_CONCURRENCY} so the initial fan-out is gated by the
 * existing concurrency cap, not double-throttled.
 */
export const SEARCH_BURST = SIGNAL_FETCH_CONCURRENCY;

/**
 * Steady-state spacing between Search requests once the burst is spent. 2s ⇒
 * ~30 req/min, matching GitHub's Search secondary-rate budget.
 */
export const SEARCH_MIN_INTERVAL_MS = 2000;

/** Maximum retries when a Search call keeps tripping the secondary rate limit. */
export const SEARCH_MAX_RETRIES = 3;

/**
 * Longest `Retry-After` (seconds) still treated as a recoverable *secondary*
 * limit. A longer wait signals primary-budget exhaustion (a full reset window),
 * which we propagate rather than block on.
 */
export const SEARCH_MAX_RETRY_WAIT_SECONDS = 90;

/** A task to run under the limiter. It closes over its own abort handling. */
type SearchTask<T> = () => Promise<T> | T;

interface Waiter<T = unknown> {
  readonly task: SearchTask<T>;
  readonly signal?: AbortSignal;
  readonly resolve: (value: T) => void;
  readonly reject: (reason: unknown) => void;
  onAbort?: () => void;
}

function abortError(): DOMException {
  return new DOMException('The operation was aborted', 'AbortError');
}

/**
 * Token-bucket limiter. Construct a fresh instance for isolated tests; the
 * application shares the {@link searchLimiter} singleton via
 * {@link scheduleSearchRequest}.
 */
export class SearchLimiter {
  private readonly capacity: number;
  private readonly intervalMs: number;
  private tokens: number;
  private readonly queue: Array<Waiter> = [];
  private refillTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(capacity: number = SEARCH_BURST, intervalMs: number = SEARCH_MIN_INTERVAL_MS) {
    this.capacity = Math.max(1, Math.floor(capacity));
    this.intervalMs = Math.max(0, intervalMs);
    this.tokens = this.capacity;
  }

  /**
   * Runs `task` once a Search token is available, retrying it on a recoverable
   * secondary-limit 403. Resolves with the task's value or rejects with its
   * error (or an `AbortError` if `signal` aborts before the task starts).
   */
  schedule<T>(task: SearchTask<T>, signal?: AbortSignal): Promise<T> {
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
    // Keep refilling one token per interval until the bucket is full again, so a
    // later burst is available; stop once full and idle to avoid a stray timer.
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

  private async runWithRetry<T>(task: SearchTask<T>, signal?: AbortSignal): Promise<T> {
    let attempt = 0;
    for (;;) {
      try {
        return await task();
      } catch (err) {
        if (isAbortError(err) || signal?.aborted) throw err;
        const retryAfterSeconds = secondaryLimitRetryAfter(err);
        if (retryAfterSeconds === undefined || attempt >= SEARCH_MAX_RETRIES) throw err;
        attempt += 1;
        // Honor Retry-After before re-issuing the request; an abort during the
        // back-off rejects via abortableSleep.
        await abortableSleep(retryAfterSeconds * 1000, signal);
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
 * Whether `err` is a recoverable secondary rate limit and, if so, the seconds to
 * wait before retrying. Returns `undefined` to propagate (not a rate limit, no
 * `Retry-After`, or a wait long enough to indicate primary-budget exhaustion).
 */
function secondaryLimitRetryAfter(err: unknown): number | undefined {
  if (!(err instanceof GitHubApiError)) return undefined;
  if (err.code !== GitHubErrorCode.RATE_LIMITED) return undefined;
  const retryAfter = err.retryAfterSeconds;
  if (retryAfter === undefined || retryAfter < 0) return undefined;
  if (retryAfter > SEARCH_MAX_RETRY_WAIT_SECONDS) return undefined;
  return retryAfter;
}

/** Process-wide Search limiter shared by every `search/issues` caller. */
export const searchLimiter = new SearchLimiter();

/**
 * Schedules a Search request on the shared {@link searchLimiter}. Wrap every
 * `search/issues` fetch in this so the whole fleet shares one rate budget.
 */
export function scheduleSearchRequest<T>(task: SearchTask<T>, signal?: AbortSignal): Promise<T> {
  return searchLimiter.schedule(task, signal);
}
