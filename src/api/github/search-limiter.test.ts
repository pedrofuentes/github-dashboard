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
    vi.restoreAllMocks();
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

  it('re-acquires a token before retrying after a secondary-limit Retry-After', async () => {
    limiter = new SearchLimiter(1, 1000);
    let active = 0;
    let maxActive = 0;
    let firstTaskAttempts = 0;
    const enterRequest = (): void => {
      active += 1;
      maxActive = Math.max(maxActive, active);
    };
    const exitRequest = (): void => {
      active -= 1;
    };

    const firstTask = vi.fn(async () => {
      firstTaskAttempts += 1;
      if (firstTaskAttempts === 1) throw rateLimitError(1);
      enterRequest();
      await Promise.resolve();
      exitRequest();
      return 'first';
    });
    const secondTask = vi.fn(async () => {
      enterRequest();
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 1);
      });
      exitRequest();
      return 'second';
    });

    const first = limiter.schedule(firstTask);
    first.catch(() => {});
    const second = limiter.schedule(secondTask);
    second.catch(() => {});

    await Promise.resolve();
    expect(firstTask).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);

    expect(secondTask).toHaveBeenCalledTimes(1);
    expect(firstTask).toHaveBeenCalledTimes(1);
    expect(maxActive).toBe(1);

    await vi.advanceTimersByTimeAsync(1001);
    await expect(Promise.all([first, second])).resolves.toEqual(['first', 'second']);
    expect(firstTask).toHaveBeenCalledTimes(2);
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

  // ── #514 ─────────────────────────────────────────────────────────────────
  it('rejects immediately when schedule() is called with a pre-aborted signal, never running the task', async () => {
    const controller = new AbortController();
    controller.abort();
    const task = vi.fn(async () => 'ran');

    await expect(limiter.schedule(task, controller.signal)).rejects.toHaveProperty(
      'name',
      'AbortError',
    );
    expect(task).not.toHaveBeenCalled();
  });

  // ── #600 ─────────────────────────────────────────────────────────────────
  // The race exercised by these two tests:
  //   abortableSleep removes its own abort listener before calling resolve(),
  //   so an abort fired in that narrow window is NOT intercepted by
  //   abortableSleep — the sleep resolves despite signal.aborted becoming true.
  //   The acquireToken guard (search-limiter.ts:173-175) is the only net that
  //   catches this; without it, a token would be silently wasted (or the waiter
  //   would queue indefinitely with no abort listener to free it).
  //
  // Test orchestration:
  //   1. await Promise.resolve() — flush one microtask tick so runWithRetry
  //      reaches abortableSleep and its 0 ms fake timer is registered.
  //   2. vi.advanceTimersByTime(1) — fire the sleep timer SYNCHRONOUSLY so its
  //      abort listener is removed before the continuation microtask runs.
  //   3. controller.abort() — abort while the continuation is still queued;
  //      acquireToken will see signal.aborted === true.

  it('acquireToken rejects with AbortError when the signal aborts between the back-off sleep and re-acquiring a token (token available)', async () => {
    const controller = new AbortController();
    const task = vi.fn(async () => {
      throw rateLimitError(0); // retryAfter=0 → 0 ms back-off sleep
    });

    const p = limiter.schedule(task, controller.signal);
    p.catch(() => {});

    await Promise.resolve(); // let runWithRetry register the 0 ms sleep timer
    vi.advanceTimersByTime(1); // fire timer synchronously — listener removed, sleep resolves
    controller.abort(); // abort lands after listener removal: acquireToken sees it

    await expect(p).rejects.toHaveProperty('name', 'AbortError');
    expect(task).toHaveBeenCalledTimes(1); // no retry
  });

  it('acquireToken rejects with AbortError when the signal aborts between the back-off sleep and re-acquiring a token (no tokens available)', async () => {
    // 1-token limiter: token is exhausted after the first dispatch, so the
    // retry's acquireToken call would have to queue without the guard.
    limiter = new SearchLimiter(1, 5000);
    const controller = new AbortController();
    const task = vi.fn(async () => {
      throw rateLimitError(0);
    });

    const p = limiter.schedule(task, controller.signal);
    p.catch(() => {});

    await Promise.resolve();
    vi.advanceTimersByTime(1);
    controller.abort();

    await expect(p).rejects.toHaveProperty('name', 'AbortError');
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('keeps refilling after the last queued waiter aborts while the bucket is below capacity', async () => {
    limiter = new SearchLimiter(1, 1000);
    void limiter.schedule(() => new Promise<void>(() => {})).catch(() => {});

    const controller = new AbortController();
    const abortedTask = vi.fn(async () => 'aborted');
    const aborted = limiter.schedule(abortedTask, controller.signal);
    aborted.catch(() => {});

    await vi.advanceTimersByTimeAsync(900);
    controller.abort();

    await expect(aborted).rejects.toHaveProperty('name', 'AbortError');
    expect(abortedTask).not.toHaveBeenCalled();

    const servedTask = vi.fn(async () => 'served');
    const served = limiter.schedule(servedTask);
    served.catch(() => {});

    await vi.advanceTimersByTimeAsync(100);
    expect(servedTask).toHaveBeenCalledTimes(1);
    await expect(served).resolves.toBe('served');
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

  // ── #527(a): retry-exhaustion observability ────────────────────────────────
  // A persistent secondary limit is observable only via the thrown error today.
  // In this client-only SPA the console is the only sink, so leaving a breadcrumb
  // when the limiter gives up distinguishes "exhausted retries" from an immediate
  // failure (mirrors the GraphQLLimiter breadcrumb, #528).
  it('warns once with context when it gives up after exhausting retries (#527)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const task = vi.fn(async () => {
      throw rateLimitError(1);
    });

    const p = limiter.schedule(task);
    p.catch(() => {});

    await vi.advanceTimersByTimeAsync(1000 * (SEARCH_MAX_RETRIES + 1));
    await expect(p).rejects.toBeInstanceOf(GitHubApiError);

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toMatch(/SearchLimiter.*exhaust/i);
    expect(warnSpy.mock.calls[0]?.[1]).toBeInstanceOf(GitHubApiError);
  });

  it('does not warn when a rate-limit error has no Retry-After (no retries attempted, #527)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const task = vi.fn(async () => {
      throw rateLimitError(undefined);
    });

    await expect(limiter.schedule(task)).rejects.toBeInstanceOf(GitHubApiError);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  // ── #527(b): waiter-queue depth observability ──────────────────────────────
  // The queue is bounded only by memory; on a very large fleet it can grow well
  // past the budget's drain rate. A one-time warning surfaces the backlog without
  // ever dropping queued work. The third constructor argument injects a small
  // threshold so the behaviour is exercisable without queueing hundreds of tasks.
  it('warns once when the waiter queue depth reaches the configured threshold (#527)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // capacity 1 ⇒ the running task holds the only token, so every later
    // schedule() queues. Depth reaches the threshold (3) on the fourth call.
    limiter = new SearchLimiter(1, 1000, 3);
    for (let i = 0; i < 4; i += 1) {
      void limiter.schedule(() => new Promise<void>(() => {})).catch(() => {});
    }

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toMatch(/SearchLimiter.*queue/i);
  });

  it('does not warn again while the waiter queue stays above the threshold (#527)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    limiter = new SearchLimiter(1, 1000, 3);
    for (let i = 0; i < 6; i += 1) {
      void limiter.schedule(() => new Promise<void>(() => {})).catch(() => {});
    }

    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('does not warn while the waiter queue stays below the threshold (#527)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // capacity 1 + 2 queued ⇒ depth 2 (< 3): no warning.
    limiter = new SearchLimiter(1, 1000, 3);
    for (let i = 0; i < 3; i += 1) {
      void limiter.schedule(() => new Promise<void>(() => {})).catch(() => {});
    }

    expect(warnSpy).not.toHaveBeenCalled();
  });

  // ── #589: retry token-stall observability ──────────────────────────────────
  // After a secondary-limit Retry-After back-off, runWithRetry re-acquires a
  // token before re-issuing the task. When the bucket is empty at that moment
  // the retry additionally stalls in the queue until a refill — a delay that is
  // invisible today. Surface it once on the same logger as the other limiter
  // breadcrumbs (#527/#704).
  it('warns when a retry stalls re-acquiring a token on an empty bucket (#589)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // capacity 1: the running task holds the only token. A concurrent task takes
    // the next refilled token, so firstTask's retry re-acquire finds an empty
    // bucket and must wait — a token stall.
    limiter = new SearchLimiter(1, 1000);

    let firstAttempts = 0;
    const firstTask = vi.fn(async () => {
      firstAttempts += 1;
      if (firstAttempts === 1) throw rateLimitError(1);
      return 'first';
    });
    const secondTask = vi.fn(async () => 'second');

    const first = limiter.schedule(firstTask);
    first.catch(() => {});
    const second = limiter.schedule(secondTask);
    second.catch(() => {});

    // 1s: the refill hands its token to the queued second task; the back-off
    // sleep resolves and firstTask's re-acquire finds tokens === 0 → stall warn.
    await vi.advanceTimersByTimeAsync(1000);
    // 2s: the next refill releases firstTask's queued re-acquire; it retries and
    // resolves.
    await vi.advanceTimersByTimeAsync(1000);

    await expect(Promise.all([first, second])).resolves.toEqual(['first', 'second']);
    expect(firstTask).toHaveBeenCalledTimes(2);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toMatch(/SearchLimiter.*stall/i);
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
