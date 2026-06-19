/**
 * Tests for the rate-limit budget guard (src/api/github/rate-limit.ts).
 *
 * Mocks the global fetch so no real HTTP calls are made. `GET /rate_limit`
 * itself is free (it does not count against the primary limit), so callers use
 * it to pre-check the budget and degrade gracefully when remaining is low.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';

import { GitHubApiError, type RateLimitInfo } from './core';
import { checkRateLimitBudget, evaluateBudget, fetchRateLimit, isBudgetLow } from './rate-limit';

// ──────────────────────────────────────────────
// Fixtures & helpers
// ──────────────────────────────────────────────

function rateBody(
  coreRemaining: number,
  coreLimit = 5000,
  resetEpoch = Math.floor(Date.now() / 1000 + 3600),
): Record<string, unknown> {
  const resource = (remaining: number, limit: number) => ({
    limit,
    remaining,
    reset: resetEpoch,
    used: limit - remaining,
  });
  return {
    resources: {
      core: resource(coreRemaining, coreLimit),
      search: resource(30, 30),
      graphql: resource(5000, 5000),
    },
    rate: resource(coreRemaining, coreLimit),
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

function info(remaining: number, limit = 5000, resetMsFromNow = 3_600_000): RateLimitInfo {
  return {
    limit,
    remaining,
    used: limit - remaining,
    reset: new Date(Date.now() + resetMsFromNow),
  };
}

// ──────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────

describe('fetchRateLimit', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('GETs /rate_limit, threads the token, and returns a validated snapshot', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(jsonResponse(rateBody(4321)));

    const snapshot = await fetchRateLimit('ghp_token');

    expect(snapshot.core.remaining).toBe(4321);
    expect(snapshot.core.limit).toBe(5000);
    expect(snapshot.core.reset).toBeInstanceOf(Date);
    expect(snapshot.graphql?.remaining).toBe(5000);
    expect(snapshot.search?.limit).toBe(30);

    const call = vi.mocked(globalThis.fetch).mock.calls[0];
    expect(call[0]).toBe('https://api.github.com/rate_limit');
    const headers = (call[1]?.headers ?? {}) as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer ghp_token');
  });

  it('throws a GitHubApiError on a non-ok response', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(jsonResponse({ message: 'bad' }, 401));
    await expect(fetchRateLimit('bad')).rejects.toBeInstanceOf(GitHubApiError);
  });

  it('throws a ZodError when the body is malformed', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(jsonResponse({ nope: true }));
    await expect(fetchRateLimit()).rejects.toBeInstanceOf(ZodError);
  });
});

describe('evaluateBudget', () => {
  it('reports a healthy budget as not low', () => {
    const status = evaluateBudget(info(4999));
    expect(status.low).toBe(false);
    expect(status.remaining).toBe(4999);
    expect(status.limit).toBe(5000);
    expect(status.fractionRemaining).toBeCloseTo(0.9998, 4);
  });

  it('flags low budget when remaining falls to/under the absolute threshold', () => {
    // Isolate the absolute rule by disabling the fractional rule (minFraction 0).
    expect(evaluateBudget(info(100), { minFraction: 0 }).low).toBe(true); // default minRemaining = 100
    expect(evaluateBudget(info(101), { minFraction: 0 }).low).toBe(false);
    expect(evaluateBudget(info(50), { minRemaining: 10, minFraction: 0 }).low).toBe(false);
    expect(evaluateBudget(info(5), { minRemaining: 10, minFraction: 0 }).low).toBe(true);
  });

  it('flags low budget when the remaining fraction falls to/under the threshold', () => {
    // 400/5000 = 0.08 <= default 0.1 → low even though remaining > 100
    expect(evaluateBudget(info(400)).low).toBe(true);
    expect(evaluateBudget(info(400), { minFraction: 0.05 }).low).toBe(false);
  });

  it('computes resetInSeconds and clamps a past reset to zero', () => {
    const now = 1_000_000_000_000;
    const future = evaluateBudget(info(5000, 5000, 60_000), undefined, now);
    expect(future.resetInSeconds).toBeGreaterThanOrEqual(0);

    const past: RateLimitInfo = {
      limit: 5000,
      remaining: 5000,
      used: 0,
      reset: new Date(now - 10_000),
    };
    expect(evaluateBudget(past, undefined, now).resetInSeconds).toBe(0);
  });

  it('treats a zero limit as a zero fraction without dividing by zero', () => {
    const status = evaluateBudget({ limit: 0, remaining: 0, used: 0, reset: new Date() });
    expect(status.fractionRemaining).toBe(0);
    expect(status.low).toBe(true);
  });
});

describe('isBudgetLow', () => {
  it('delegates to evaluateBudget', () => {
    expect(isBudgetLow(info(4999))).toBe(false);
    expect(isBudgetLow(info(10))).toBe(true);
    expect(isBudgetLow(info(10), { minRemaining: 1, minFraction: 0 })).toBe(false);
  });
});

describe('checkRateLimitBudget', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('fetches /rate_limit and evaluates the core budget', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(jsonResponse(rateBody(20)));
    const status = await checkRateLimitBudget('ghp_token');
    expect(status.low).toBe(true);
    expect(status.remaining).toBe(20);
  });

  it('reports a healthy budget when remaining is high', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(jsonResponse(rateBody(4800)));
    const status = await checkRateLimitBudget();
    expect(status.low).toBe(false);
  });
});
