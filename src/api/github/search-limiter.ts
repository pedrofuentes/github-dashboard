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

/**
 * Waiter-queue depth that trips a one-time observability warning. The queue is
 * bounded only by memory, never dropped — on a very large fleet the Search
 * fan-out can enqueue faster than the ~30 req/min budget drains. At that rate a
 * 200-deep backlog is already >6 minutes of pending Search work, a clear sign
 * the fleet has outgrown the budget and worth surfacing once (#527). Exported
 * for reference; override per instance via the {@link SearchLimiter}
 * constructor's third argument (used by tests).
 */
export const SEARCH_QUEUE_WARN_THRESHOLD = 200;

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
  private readonly queueWarnThreshold: number;
  private queueWarned = false;
  private refillTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    capacity: number = SEARCH_BURST,
    intervalMs: number = SEARCH_MIN_INTERVAL_MS,
    queueWarnThreshold: number = SEARCH_QUEUE_WARN_THRESHOLD,
  ) {
    this.capacity = Math.max(1, Math.floor(capacity));
    this.intervalMs = Math.max(0, intervalMs);
    this.queueWarnThreshold = Math.max(1, Math.floor(queueWarnThreshold));
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
      this.enqueueWaiter(waiter);
    });
  }

  /** Restores a full bucket and drops any queued waiters (test helper). */
  reset(): void {
    this.clearRefillTimer();
    for (const waiter of this.queue) this.detachAbort(waiter);
    this.queue.length = 0;
    this.queueWarned = false;
    this.tokens = this.capacity;
  }

  /**
   * Wires `waiter`'s abort handling — so an abort fired while it is queued is
   * delivered to {@link abortWaiter}, which removes and rejects it — then hands
   * the waiter to {@link enqueue}. The single home for the abort/enqueue wiring
   * shared by {@link schedule} and the retry path's {@link acquireToken}.
   */
  private enqueueWaiter<T>(waiter: Waiter<T>): void {
    if (waiter.signal) {
      waiter.onAbort = (): void => this.abortWaiter(waiter as Waiter);
      waiter.signal.addEventListener('abort', waiter.onAbort, { once: true });
    }
    this.enqueue(waiter as Waiter);
  }

  /**
   * Appends a waiter and pumps the bucket. Emits a single observability warning
   * the first time the backlog reaches {@link queueWarnThreshold}; the latch
   * resets in {@link pump} once the queue drains back below it, so a recurring
   * backlog is surfaced again without spamming the console (#527).
   */
  private enqueue(waiter: Waiter): void {
    this.queue.push(waiter);
    if (this.queue.length >= this.queueWarnThreshold && !this.queueWarned) {
      this.queueWarned = true;
      console.warn(
        `SearchLimiter: waiter queue depth ${this.queue.length} reached threshold ` +
          `${this.queueWarnThreshold}; Search requests are backing up on a large fleet.`,
      );
    }
    this.pump();
  }

  private pump(): void {
    while (this.queue.length > 0 && this.tokens > 0) {
      this.tokens -= 1;
      const waiter = this.queue.shift() as Waiter;
      this.detachAbort(waiter);
      void this.runWaiter(waiter);
    }
    if (this.queue.length < this.queueWarnThreshold) this.queueWarned = false;
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
        if (retryAfterSeconds === undefined) throw err;
        if (attempt >= SEARCH_MAX_RETRIES) {
          // Retried the secondary limit SEARCH_MAX_RETRIES times and still
          // failing. In this client-only SPA the console is the only sink, so
          // leave an operator breadcrumb distinguishing "gave up after retries"
          // from an immediate failure before propagating the error (#527).
          console.warn(`SearchLimiter: secondary limit retries exhausted (${attempt})`, err);
          throw err;
        }
        attempt += 1;
        // Honor Retry-After before re-issuing the request; an abort during the
        // back-off rejects via abortableSleep.
        await abortableSleep(retryAfterSeconds * 1000, signal);
        await this.acquireToken(signal);
      }
    }
  }

  /**
   * Re-acquires a Search token on the retry path — after a secondary-limit
   * `Retry-After` back-off in {@link runWithRetry}, before the task is
   * re-issued. The re-acquire waits its turn through the same token bucket as a
   * fresh {@link schedule} call, so a retry never jumps the queue or exceeds the
   * rate budget; it resolves as soon as a token is free, or stalls until the
   * bucket refills when none is (that extra wait is logged once for visibility).
   *
   * Abort: a `signal` already aborted on entry rejects synchronously with
   * `AbortError`. This guard also closes the #600 race where
   * {@link abortableSleep} resolves *after* removing its own abort listener — an
   * abort landing in that window would otherwise be missed here and waste a
   * token. An abort that instead arrives while the re-acquire is queued is
   * delivered to {@link abortWaiter} (wired via {@link enqueueWaiter}), which
   * splices the waiter out and rejects it; acquireToken relies on that handler
   * to free a queued re-acquire that would otherwise wait forever.
   */
  private acquireToken(signal?: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (signal?.aborted) {
        reject(abortError());
        return;
      }

      if (this.tokens === 0) {
        // The retry already waited out Retry-After; an empty bucket now means it
        // also stalls in the queue until a token refills. The console is this
        // client-only SPA's only sink, so surface that extra delay once, on the
        // same logger as the other limiter breadcrumbs (#589, mirrors #527/#704).
        console.warn(
          'SearchLimiter: retry stalled re-acquiring a Search token on an empty bucket; ' +
            'awaiting refill after the Retry-After back-off.',
        );
      }

      const waiter: Waiter<void> = { task: () => undefined, signal, resolve, reject };
      this.enqueueWaiter(waiter);
    });
  }

  private abortWaiter(waiter: Waiter): void {
    const index = this.queue.indexOf(waiter);
    if (index >= 0) this.queue.splice(index, 1);
    this.detachAbort(waiter);
    waiter.reject(abortError());
    if (this.queue.length === 0 && this.tokens >= this.capacity) this.clearRefillTimer();
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
