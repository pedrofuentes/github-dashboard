/**
 * Tests for the live rate-limit store (src/api/github/rate-limit-store.ts).
 *
 * The store records the latest `x-ratelimit-*` snapshot observed on a response
 * and exposes a "pause" window so callers can defensively defer non-essential
 * polls when the primary budget is critically low or a secondary-limit
 * `Retry-After` is in effect. Time is injected (`now`) so the pause math is
 * deterministic without fake timers.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { type RateLimitInfo } from './core';
import { RateLimitStore, rateLimitStore } from './rate-limit-store';

function info(
  remaining: number,
  limit = 5000,
  resetMsFromNow = 3_600_000,
  now = Date.now(),
): RateLimitInfo {
  return { limit, remaining, used: limit - remaining, reset: new Date(now + resetMsFromNow) };
}

afterEach(() => {
  rateLimitStore.reset();
});

describe('RateLimitStore.record', () => {
  it('records a healthy snapshot without pausing', () => {
    const store = new RateLimitStore();
    store.record(info(4999));

    expect(store.getStatus()?.low).toBe(false);
    expect(store.isPaused()).toBe(false);
    expect(store.getState().info?.remaining).toBe(4999);
  });

  it('pauses until the window reset when the primary budget is critically low', () => {
    const now = 1_000_000_000_000;
    const store = new RateLimitStore();

    store.record(info(5, 5000, 600_000, now), { now }); // 5 remaining → low

    expect(store.getStatus()?.low).toBe(true);
    expect(store.isPaused(now)).toBe(true);
    expect(store.pauseRemainingMs(now)).toBe(600_000); // paused until reset
    expect(store.isPaused(now + 600_001)).toBe(false); // self-clears after reset
  });

  it('honors a secondary-limit Retry-After even when remaining looks healthy', () => {
    const now = 2_000_000_000_000;
    const store = new RateLimitStore();

    store.record(info(4999, 5000, 3_600_000, now), { retryAfterSeconds: 30, now });

    expect(store.isPaused(now)).toBe(true);
    expect(store.pauseRemainingMs(now)).toBe(30_000);
  });

  it('clears an active pause once a healthy response arrives', () => {
    const now = 3_000_000_000_000;
    const store = new RateLimitStore();

    store.record(info(5, 5000, 600_000, now), { now });
    expect(store.isPaused(now)).toBe(true);

    store.record(info(4999, 5000, 3_600_000, now), { now });
    expect(store.isPaused(now)).toBe(false);
  });

  it('keeps the longer pause window when records overlap', () => {
    const now = 4_000_000_000_000;
    const store = new RateLimitStore();

    store.record(info(5, 5000, 600_000, now), { now }); // pause until reset (600s)
    store.record(info(5, 5000, 600_000, now), { retryAfterSeconds: 10, now }); // 10s < 600s

    expect(store.pauseRemainingMs(now)).toBe(600_000); // does not shorten the pause
  });
});

describe('RateLimitStore.subscribe', () => {
  it('notifies subscribers on record and stops after unsubscribe', () => {
    const store = new RateLimitStore();
    const listener = vi.fn();

    const off = store.subscribe(listener);
    store.record(info(4999));
    expect(listener).toHaveBeenCalledTimes(1);

    off();
    store.record(info(4000));
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('RateLimitStore.configure', () => {
  it('applies custom thresholds when evaluating low budget', () => {
    const store = new RateLimitStore();
    store.configure({ minRemaining: 10, minFraction: 0 });

    store.record(info(50)); // 50 > 10, fraction rule disabled → not low
    expect(store.getStatus()?.low).toBe(false);

    store.record(info(5)); // 5 <= 10 → low
    expect(store.getStatus()?.low).toBe(true);
  });
});

describe('rateLimitStore singleton', () => {
  it('starts un-paused and resets cleanly', () => {
    rateLimitStore.record(info(5, 5000, 600_000));
    expect(rateLimitStore.isPaused()).toBe(true);

    rateLimitStore.reset();
    expect(rateLimitStore.isPaused()).toBe(false);
    expect(rateLimitStore.getStatus()).toBeUndefined();
    expect(rateLimitStore.getState().info).toBeUndefined();
  });
});
