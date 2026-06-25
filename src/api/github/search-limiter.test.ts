import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GitHubApiError, GitHubErrorCode } from './core';
import {
  SEARCH_BURST,
  SEARCH_MAX_RETRIES,
  SEARCH_MIN_INTERVAL_MS,
  SearchLimiter,
  scheduleSearchRequest,
  searchLimiter,
} from './search-limiter';

/**
 * The Search limiter throttles every `search/issues` caller (stale, issue and
 * viewer-issue counts) onto GitHub's ~30 req/min Search secondary-rate budget
 * and recovers from a secondary-limit 403 via bounded Retry-After back-off
 * (T-bf2 / #495). All timing is driven by `setTimeout`, so fake timers fully
 * control it without touching the wall clock.
 */

function rateLimitError(retryAfterSeconds?: number): GitHubApiError {
  return new GitHubApiError(
    'secondary rate limit',
    403,
    undefined,
    retryAfterSeconds,
    GitHubErrorCode.RATE_LIMITED,
  );
}

describe('SearchLimiter', () => {
  let limiter: SearchLimiter;

  beforeEach(() => {
    vi.useFakeTimers();
    limiter = new SearchLimiter();
  });

  afterEach(() => {
    limiter.reset();
    vi.useRealTimers();
  });

  it('returns the task result', async () => {
    await expect(limiter.schedule(async () => 42)).resolves.toBe(42);
  });

  it('grants an initial burst immediately, then spaces the rest by the min interval', async () => {
    const order: number[] = [];
    const total = SEARCH_BURST + 2;
    const tasks: Array<Promise<number>> = [];
    for (let i = 0; i < total; i += 1) {
      const index = i;
      tasks.push(
        limiter.schedule(async () => {
          order.push(index);
          return index;
        }),
      );
    }

    // Cold start: the whole burst runs without waiting on any timer.
    await Promise.resolve();
    const burst = Array.from({ length: SEARCH_BURST }, (_, i) => i);
    expect(order).toEqual(burst);

    // Each request beyond the burst is released one min-interval apart.
    await vi.advanceTimersByTimeAsync(SEARCH_MIN_INTERVAL_MS);
    expect(order).toEqual([...burst, SEARCH_BURST]);

    await vi.advanceTimersByTimeAsync(SEARCH_MIN_INTERVAL_MS);
    expect(order).toEqual([...burst, SEARCH_BURST, SEARCH_BURST + 1]);

    await Promise.all(tasks);
  });

  it('retries a secondary-limit 403 after honoring Retry-After, then resolves', async () => {
    let calls = 0;
    const task = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw rateLimitError(5);
      return 'ok';
    });

    const p = limiter.schedule(task);
    p.catch(() => {});

    await vi.advanceTimersByTimeAsync(5000);
    await expect(p).resolves.toBe('ok');
    expect(task).toHaveBeenCalledTimes(2);
  });

  it('gives up after SEARCH_MAX_RETRIES persistent secondary limits', async () => {
    const task = vi.fn(async () => {
      throw rateLimitError(1);
    });

    const p = limiter.schedule(task);
    p.catch(() => {});

    await vi.advanceTimersByTimeAsync(1000 * (SEARCH_MAX_RETRIES + 1));
    await expect(p).rejects.toBeInstanceOf(GitHubApiError);
    // Initial attempt plus SEARCH_MAX_RETRIES retries.
    expect(task).toHaveBeenCalledTimes(SEARCH_MAX_RETRIES + 1);
  });

  it('propagates a rate-limit error whose Retry-After is missing (primary budget) without retrying', async () => {
    const task = vi.fn(async () => {
      throw rateLimitError(undefined);
    });

    await expect(limiter.schedule(task)).rejects.toBeInstanceOf(GitHubApiError);
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('propagates a non-rate-limit error without retrying', async () => {
    const task = vi.fn(async () => {
      throw new Error('boom');
    });

    await expect(limiter.schedule(task)).rejects.toThrow('boom');
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('rejects a queued task when its signal aborts before it starts, never running it', async () => {
    // Exhaust the burst with never-settling tasks so the next request must wait.
    for (let i = 0; i < SEARCH_BURST; i += 1) {
      void limiter.schedule(() => new Promise<void>(() => {})).catch(() => {});
    }

    const controller = new AbortController();
    const parked = vi.fn(async () => 'ran');
    const p = limiter.schedule(parked, controller.signal);
    p.catch(() => {});

    controller.abort();

    await expect(p).rejects.toHaveProperty('name', 'AbortError');
    expect(parked).not.toHaveBeenCalled();
  });

  it('reset() refills the bucket and clears the queue', async () => {
    for (let i = 0; i < SEARCH_BURST; i += 1) {
      void limiter.schedule(() => new Promise<void>(() => {})).catch(() => {});
    }

    limiter.reset();

    const ran = vi.fn(async () => 'ok');
    await expect(limiter.schedule(ran)).resolves.toBe('ok');
    expect(ran).toHaveBeenCalledTimes(1);
  });
});

describe('scheduleSearchRequest (shared singleton)', () => {
  beforeEach(() => {
    searchLimiter.reset();
  });

  afterEach(() => {
    searchLimiter.reset();
  });

  it('delegates to the shared searchLimiter', async () => {
    await expect(scheduleSearchRequest(async () => 7)).resolves.toBe(7);
  });
});
