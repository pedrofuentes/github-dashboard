/**
 * Tests for the GraphQL client, limiter, and cost-accounting helpers.
 *
 * Covers:
 *  - fetchGraphQL: successful POST, Zod-validated data
 *  - fetchGraphQL: partial {data, errors} returns both without throwing
 *  - fetchGraphQL: hard 5xx retried then throws a classified GitHubApiError
 *  - fetchGraphQL: 403+Retry-After → RATE_LIMITED classification
 *  - fetchGraphQL: 401 → AUTH_ERROR classification
 *  - GraphQLLimiter: cold-start burst, spacing, Retry-After recovery, abort, reset
 *  - scheduleGraphQLRequest: delegates to the shared singleton
 *  - recordGraphQLCost: writes the graphql bucket into graphqlRateLimitStore
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { GitHubApiError, GitHubErrorCode } from './core';
import {
  GQL_BURST,
  GQL_MAX_RETRIES,
  GQL_MIN_INTERVAL_MS,
  GraphQLLimiter,
  fetchGraphQL,
  graphqlLimiter,
  graphqlRateLimitStore,
  recordGraphQLCost,
  scheduleGraphQLRequest,
} from './graphql';

// ── Helpers ────────────────────────────────────────────────────────────────

function mockJsonResponse(
  status: number,
  body: unknown,
  extraHeaders: Record<string, string> = {},
): Response {
  const headers = new Headers({ 'content-type': 'application/json', ...extraHeaders });
  return {
    ok: status >= 200 && status < 300,
    status,
    headers,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

function rateLimitError(retryAfterSeconds?: number): GitHubApiError {
  return new GitHubApiError(
    'secondary rate limit',
    403,
    undefined,
    retryAfterSeconds,
    GitHubErrorCode.RATE_LIMITED,
  );
}

const TestSchema = z.object({ viewer: z.object({ login: z.string() }) });

// ── fetchGraphQL ──────────────────────────────────────────────────────────

describe('fetchGraphQL', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn();
    vi.useFakeTimers();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
  });

  it('sends a POST to api.github.com/graphql with the correct headers and body', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      mockJsonResponse(200, { data: { viewer: { login: 'octocat' } } }),
    );

    await fetchGraphQL({
      query: '{ viewer { login } }',
      token: 'ghs_token',
      dataSchema: TestSchema,
    });

    expect(globalThis.fetch).toHaveBeenCalledOnce();
    const [url, init] = vi.mocked(globalThis.fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.github.com/graphql');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer ghs_token');
    expect(headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual({
      query: '{ viewer { login } }',
      variables: undefined,
    });
  });

  it('returns validated data and empty errors on a clean 200 response', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      mockJsonResponse(200, { data: { viewer: { login: 'octocat' } } }),
    );

    const result = await fetchGraphQL({
      query: '{ viewer { login } }',
      token: 'ghs_token',
      dataSchema: TestSchema,
    });

    expect(result.data).toEqual({ viewer: { login: 'octocat' } });
    expect(result.errors).toEqual([]);
  });

  it('returns both data and errors on a partial-success 200 (no throw)', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      mockJsonResponse(200, {
        data: { viewer: { login: 'octocat' } },
        errors: [{ message: 'Field is deprecated', path: ['viewer', 'login'] }],
      }),
    );

    const result = await fetchGraphQL({
      query: '{ viewer { login } }',
      token: 'ghs_token',
      dataSchema: TestSchema,
    });

    expect(result.data).toEqual({ viewer: { login: 'octocat' } });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toBe('Field is deprecated');
  });

  it('returns null data and errors when data is absent', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      mockJsonResponse(200, {
        errors: [{ message: 'Not authorized', type: 'FORBIDDEN' }],
      }),
    );

    const result = await fetchGraphQL({
      query: '{ viewer { login } }',
      token: 'ghs_token',
      dataSchema: TestSchema,
    });

    expect(result.data).toBeNull();
    expect(result.errors[0].message).toBe('Not authorized');
    expect(result.errors[0].type).toBe('FORBIDDEN');
  });

  it('retries on 503 and throws SERVER_ERROR after all retries exhausted', async () => {
    const serverErr = mockJsonResponse(503, {});
    vi.mocked(globalThis.fetch).mockResolvedValue(serverErr);

    const promise = fetchGraphQL({
      query: '{ viewer { login } }',
      token: 'ghs_token',
      dataSchema: TestSchema,
    });
    promise.catch(() => {});

    // Advance past all retry delays (1s + 2s + 4s = 7s total)
    await vi.advanceTimersByTimeAsync(8000);

    await expect(promise).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof GitHubApiError && e.code === GitHubErrorCode.SERVER_ERROR && e.status === 503,
    );
  });

  it('throws RATE_LIMITED on 429 with Retry-After after retries exhausted', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      mockJsonResponse(429, { message: 'rate limit exceeded' }, { 'retry-after': '2' }),
    );

    const promise = fetchGraphQL({
      query: '{ viewer { login } }',
      token: 'ghs_token',
      dataSchema: TestSchema,
    });
    promise.catch(() => {});

    // fetchWithRetry retries the 429 (3 × 2s Retry-After) then returns it.
    await vi.advanceTimersByTimeAsync(8000);

    await expect(promise).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof GitHubApiError &&
        e.code === GitHubErrorCode.RATE_LIMITED &&
        e.status === 429 &&
        e.retryAfterSeconds === 2,
    );
  });

  it('throws RATE_LIMITED on 429 without Retry-After, applying a 60s fallback wait', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      mockJsonResponse(429, { message: 'rate limited' }),
    );

    const promise = fetchGraphQL({
      query: '{ viewer { login } }',
      token: 'ghs_token',
      dataSchema: TestSchema,
    });
    promise.catch(() => {});

    // No Retry-After → exponential backoff (1s + 2s + 4s) before the 429 surfaces.
    await vi.advanceTimersByTimeAsync(8000);

    await expect(promise).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof GitHubApiError &&
        e.code === GitHubErrorCode.RATE_LIMITED &&
        e.status === 429 &&
        e.retryAfterSeconds === 60,
    );
  });

  it('throws RATE_LIMITED on 403 with Retry-After header', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      mockJsonResponse(403, { message: 'secondary rate limit' }, { 'retry-after': '30' }),
    );

    await expect(
      fetchGraphQL({ query: '{ viewer { login } }', token: 'ghs_token', dataSchema: TestSchema }),
    ).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof GitHubApiError &&
        e.code === GitHubErrorCode.RATE_LIMITED &&
        e.retryAfterSeconds === 30,
    );
  });

  it('throws ACCESS_DENIED on 403 without Retry-After header', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      mockJsonResponse(403, { message: 'forbidden' }),
    );

    await expect(
      fetchGraphQL({ query: '{ viewer { login } }', token: 'ghs_token', dataSchema: TestSchema }),
    ).rejects.toSatisfy(
      (e: unknown) => e instanceof GitHubApiError && e.code === GitHubErrorCode.ACCESS_DENIED,
    );
  });

  it('throws AUTH_ERROR on 401', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      mockJsonResponse(401, { message: 'Bad credentials' }),
    );

    await expect(
      fetchGraphQL({ query: '{ viewer { login } }', token: 'ghs_token', dataSchema: TestSchema }),
    ).rejects.toSatisfy(
      (e: unknown) => e instanceof GitHubApiError && e.code === GitHubErrorCode.AUTH_ERROR,
    );
  });

  it('passes variables in the request body', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      mockJsonResponse(200, { data: { viewer: { login: 'octocat' } } }),
    );

    await fetchGraphQL({
      query: 'query($owner: String!) { viewer { login } }',
      variables: { owner: 'github' },
      token: 'ghs_token',
      dataSchema: TestSchema,
    });

    const [, init] = vi.mocked(globalThis.fetch).mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      query: 'query($owner: String!) { viewer { login } }',
      variables: { owner: 'github' },
    });
  });
});

// ── GraphQLLimiter ────────────────────────────────────────────────────────

describe('GraphQLLimiter', () => {
  let limiter: GraphQLLimiter;

  beforeEach(() => {
    vi.useFakeTimers();
    limiter = new GraphQLLimiter();
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
    const total = GQL_BURST + 2;
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

    // Cold start: burst runs immediately
    await Promise.resolve();
    const burst = Array.from({ length: GQL_BURST }, (_, i) => i);
    expect(order).toEqual(burst);

    // Each request beyond the burst is released one min-interval apart
    await vi.advanceTimersByTimeAsync(GQL_MIN_INTERVAL_MS);
    expect(order).toEqual([...burst, GQL_BURST]);

    await vi.advanceTimersByTimeAsync(GQL_MIN_INTERVAL_MS);
    expect(order).toEqual([...burst, GQL_BURST, GQL_BURST + 1]);

    await Promise.all(tasks);
  });

  it('retries a secondary-limit 403 after Retry-After, then resolves', async () => {
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

  it('does not shorten secondary-limit Retry-After delays with jitter', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    let calls = 0;
    const task = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw rateLimitError(4);
      return 'ok';
    });

    const p = limiter.schedule(task);
    p.catch(() => {});

    await vi.advanceTimersByTimeAsync(3999);
    expect(task).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(task).toHaveBeenCalledTimes(2);
    await expect(p).resolves.toBe('ok');
    expect(task).toHaveBeenCalledTimes(2);
  });

  it('gives up after GQL_MAX_RETRIES persistent secondary limits', async () => {
    const task = vi.fn(async () => {
      throw rateLimitError(1);
    });

    const p = limiter.schedule(task);
    p.catch(() => {});

    await vi.advanceTimersByTimeAsync(1000 * (GQL_MAX_RETRIES + 1));
    await expect(p).rejects.toBeInstanceOf(GitHubApiError);
    expect(task).toHaveBeenCalledTimes(GQL_MAX_RETRIES + 1);
  });

  it('logs a breadcrumb when it gives up after exhausting retries (#528)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const task = vi.fn(async () => {
      throw rateLimitError(1);
    });

    const p = limiter.schedule(task);
    p.catch(() => {});

    await vi.advanceTimersByTimeAsync(1000 * (GQL_MAX_RETRIES + 1));
    await expect(p).rejects.toBeInstanceOf(GitHubApiError);

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0]?.[0]).toMatch(/GraphQLLimiter.*exhaust/i);
    expect(errorSpy.mock.calls[0]?.[1]).toBeInstanceOf(GitHubApiError);
  });

  it('does not log when a rate-limit error has no Retry-After (no retries attempted, #528)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const task = vi.fn(async () => {
      throw rateLimitError(undefined);
    });

    await expect(limiter.schedule(task)).rejects.toBeInstanceOf(GitHubApiError);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('propagates a rate-limit error without Retry-After without retrying', async () => {
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

  it('rejects a queued task when its signal aborts before it starts', async () => {
    // Exhaust burst with never-settling tasks
    for (let i = 0; i < GQL_BURST; i += 1) {
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
    for (let i = 0; i < GQL_BURST; i += 1) {
      void limiter.schedule(() => new Promise<void>(() => {})).catch(() => {});
    }

    limiter.reset();

    const ran = vi.fn(async () => 'ok');
    await expect(limiter.schedule(ran)).resolves.toBe('ok');
    expect(ran).toHaveBeenCalledTimes(1);
  });
});

// ── scheduleGraphQLRequest (shared singleton) ─────────────────────────────

describe('scheduleGraphQLRequest (shared singleton)', () => {
  beforeEach(() => {
    graphqlLimiter.reset();
  });

  afterEach(() => {
    graphqlLimiter.reset();
  });

  it('delegates to the shared graphqlLimiter', async () => {
    await expect(scheduleGraphQLRequest(async () => 7)).resolves.toBe(7);
  });
});

// ── recordGraphQLCost ─────────────────────────────────────────────────────

describe('recordGraphQLCost', () => {
  afterEach(() => {
    graphqlRateLimitStore.reset();
  });

  it('records remaining into the graphql rate-limit store', () => {
    recordGraphQLCost({ remaining: 4800, resetAt: new Date(Date.now() + 3_600_000).toISOString() });

    const state = graphqlRateLimitStore.getState();
    expect(state.info).toBeDefined();
    expect(state.info?.remaining).toBe(4800);
  });

  it('uses the provided limit when present', () => {
    recordGraphQLCost({
      remaining: 3000,
      resetAt: new Date(Date.now() + 3_600_000).toISOString(),
      limit: 5000,
    });

    const state = graphqlRateLimitStore.getState();
    expect(state.info?.limit).toBe(5000);
    expect(state.info?.remaining).toBe(3000);
  });

  it('defaults limit to 5000 when not provided', () => {
    recordGraphQLCost({ remaining: 4500, resetAt: new Date(Date.now() + 3_600_000).toISOString() });

    const state = graphqlRateLimitStore.getState();
    expect(state.info?.limit).toBe(5000);
  });

  it('parses the resetAt ISO string into a Date for the store', () => {
    const resetAt = new Date(Date.now() + 3_600_000);
    recordGraphQLCost({ remaining: 4000, resetAt: resetAt.toISOString() });

    const state = graphqlRateLimitStore.getState();
    expect(state.info?.reset.getTime()).toBeCloseTo(resetAt.getTime(), -2);
  });

  it('computes used = limit - remaining', () => {
    recordGraphQLCost({
      remaining: 4750,
      resetAt: new Date(Date.now() + 3_600_000).toISOString(),
      limit: 5000,
    });

    const state = graphqlRateLimitStore.getState();
    expect(state.info?.used).toBe(250);
  });

  it('marks status as low when remaining is critically low', () => {
    recordGraphQLCost({
      remaining: 50,
      resetAt: new Date(Date.now() + 3_600_000).toISOString(),
      limit: 5000,
    });

    const state = graphqlRateLimitStore.getState();
    expect(state.status?.low).toBe(true);
  });
});
