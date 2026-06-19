/**
 * Live, in-memory rate-limit store for the GitHub REST API.
 *
 * Every response carries `x-ratelimit-*` headers; this store keeps the latest
 * snapshot so the app has a single, observable view of the remaining primary
 * budget. When that budget is critically low — or a secondary-limit
 * `Retry-After` is in effect — it exposes a "pause" window callers can consult
 * to defensively defer non-essential polls until the limit resets, rather than
 * hammering the API (which can get an integration banned).
 *
 * It is deliberately process-local and stores only numeric budget metadata (no
 * GitHub resource data, no token), so nothing sensitive is ever retained.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */

import { type RateLimitInfo } from './core';
import { type BudgetGuardOptions, type BudgetStatus, evaluateBudget } from './rate-limit';

/** Snapshot of the store's current state. */
export interface RateLimitStoreState {
  /** Latest raw budget snapshot recorded from a response (undefined until first record). */
  info?: RateLimitInfo;
  /** Latest evaluated budget verdict (undefined until first record). */
  status?: BudgetStatus;
  /** Epoch ms until which non-essential fetches should be deferred (0 = not paused). */
  pausedUntil: number;
}

/** Subscriber notified whenever the store state changes. */
export type RateLimitListener = (state: RateLimitStoreState) => void;

/** Options for a single {@link RateLimitStore.record} call. */
export interface RecordRateLimitOptions {
  /** `Retry-After` seconds from a secondary-limit (403/429) response, if any. */
  retryAfterSeconds?: number;
  /** Injectable "now" in epoch ms (defaults to `Date.now()`). */
  now?: number;
}

/**
 * Holds the latest observed rate-limit budget and a derived pause window.
 *
 * The default {@link rateLimitStore} singleton is shared by the fetch layer; a
 * fresh instance can be constructed for isolated tests.
 */
export class RateLimitStore {
  private state: RateLimitStoreState = { info: undefined, status: undefined, pausedUntil: 0 };
  private readonly listeners = new Set<RateLimitListener>();
  private options: BudgetGuardOptions = {};

  /** Overrides the budget thresholds used to decide when remaining is "low". */
  configure(options: BudgetGuardOptions): void {
    this.options = options;
  }

  /**
   * Records a response's rate-limit snapshot and recomputes the pause window.
   *
   * Precedence: an explicit `Retry-After` always imposes (and never shortens) a
   * pause; otherwise a critically low primary budget pauses until the window
   * resets; a healthy budget with no `Retry-After` clears the pause.
   */
  record(info: RateLimitInfo, options: RecordRateLimitOptions = {}): void {
    const now = options.now ?? Date.now();
    const status = evaluateBudget(info, this.options, now);

    let pausedUntil = 0;
    if (status.low) {
      pausedUntil = info.reset.getTime();
    }
    if (options.retryAfterSeconds !== undefined && options.retryAfterSeconds > 0) {
      pausedUntil = Math.max(pausedUntil, now + options.retryAfterSeconds * 1000);
    }
    // When this record itself imposes a pause, never shorten an existing one
    // (e.g. a long Retry-After). A healthy record imposes none and clears it.
    if (pausedUntil > 0) {
      pausedUntil = Math.max(pausedUntil, this.state.pausedUntil);
    }

    this.setState({ info, status, pausedUntil });
  }

  /** The latest evaluated budget verdict, or undefined before the first record. */
  getStatus(): BudgetStatus | undefined {
    return this.state.status;
  }

  /** The full current state snapshot. */
  getState(): RateLimitStoreState {
    return this.state;
  }

  /** True while non-essential fetches should be deferred. */
  isPaused(now: number = Date.now()): boolean {
    return this.state.pausedUntil > now;
  }

  /** Milliseconds remaining in the current pause window (0 when not paused). */
  pauseRemainingMs(now: number = Date.now()): number {
    return Math.max(0, this.state.pausedUntil - now);
  }

  /** Subscribes to state changes; returns an unsubscribe function. */
  subscribe(listener: RateLimitListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Clears all state and the pause window (does not drop subscribers). */
  reset(): void {
    this.setState({ info: undefined, status: undefined, pausedUntil: 0 });
  }

  private setState(next: RateLimitStoreState): void {
    this.state = next;
    for (const listener of this.listeners) {
      listener(next);
    }
  }
}

/** Shared store updated by the fetch layer and consumable by hooks/UI. */
export const rateLimitStore = new RateLimitStore();
