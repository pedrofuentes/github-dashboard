/**
 * Tests for the registry-driven batched GraphQL fleet-query infrastructure.
 *
 * Covers:
 *  - buildFleetQuery: top-level singular `r{i}: repository(...)` aliases (no
 *    connection / cost multiplier), the CI fragment, viewer + rateLimit, and
 *    injection-safe owner/name handling (GraphQL variables, never literals)
 *  - buildFleetVariables: the `owner{i}`/`name{i}` map paired with the query
 *  - buildErrorIndex: dot-joined path → error mapping with subtree coverage
 *  - executeFleetBatch: per-repo CI slices for success/failure/pending, null
 *    rollup / no-default-branch / archived → none, partial path-error isolation,
 *    chunking + merge, per-chunk hard-failure isolation, and cost accounting
 *
 * The GraphQL layer is exercised end-to-end through a stubbed `globalThis.fetch`
 * (the same pattern as graphql.test.ts — no MSW).
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CiSignalSlice, Repo, SignalSlice } from '../../types/fleet';
import {
  FLEET_QUERY_CHUNK_SIZE,
  SIGNAL_DERIVERS,
  buildErrorIndex,
  buildFleetQuery,
  buildFleetVariables,
  executeFleetBatch,
  type FleetBatchResult,
} from './fleet-query';
import { graphqlLimiter, graphqlRateLimitStore } from './graphql';

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

function repo(nameWithOwner: string): Repo {
  const [owner, name] = nameWithOwner.split('/');
  return { nameWithOwner, owner, name, isPrivate: false };
}

function futureIso(): string {
  return new Date(Date.now() + 3_600_000).toISOString();
}

function rollupNode(nameWithOwner: string, state: string): unknown {
  return {
    nameWithOwner,
    isArchived: false,
    defaultBranchRef: { target: { statusCheckRollup: { state } } },
  };
}

function ci(result: Map<string, SignalSlice>, key: string): CiSignalSlice {
  return result.get(key) as CiSignalSlice;
}

function ciMapOf(result: FleetBatchResult): Map<string, SignalSlice> {
  const map = result.get('ci');
  if (!map) throw new Error('expected a ci slice map');
  return map;
}

const TOKEN = 'ghs_token';

// ── buildFleetQuery / buildFleetVariables ──────────────────────────────────

describe('buildFleetQuery', () => {
  const repos = [repo('octocat/hello-world'), repo('github/docs')];

  it('emits one top-level singular repository alias per repo (no connection)', () => {
    const query = buildFleetQuery(repos, null);
    expect(query).toContain('r0: repository(owner: $owner0, name: $name0)');
    expect(query).toContain('r1: repository(owner: $owner1, name: $name1)');
    // Two singular repository(...) selections — never a `repositories(` connection.
    expect(query.match(/repository\(/g)).toHaveLength(2);
    expect(query).not.toContain('repositories(');
  });

  it('composes the CI per-repo fragment inside each repository alias', () => {
    const query = buildFleetQuery(repos, null);
    expect(query).toContain('nameWithOwner');
    expect(query).toContain('defaultBranchRef');
    expect(query).toContain('statusCheckRollup');
  });

  it('includes isArchived in the per-repo selection (guards the archived-repo no-CI path)', () => {
    const query = buildFleetQuery(repos, null);
    expect(query).toContain('isArchived');
  });

  it('appends viewer and rateLimit at the top level', () => {
    const query = buildFleetQuery(repos, null);
    expect(query).toContain('viewer { login }');
    expect(query).toContain('rateLimit');
  });

  it('passes owner/name as GraphQL variables, never as query literals (injection-safe)', () => {
    const malicious = repo('evil") { id } injected:repository(owner:"x/y');
    const query = buildFleetQuery([malicious], null);
    // The raw owner/name must not appear inline — only variable references.
    expect(query).not.toContain('injected:repository');
    expect(query).toContain('repository(owner: $owner0, name: $name0)');
    expect(query).toContain('$owner0: String!');
    expect(query).toContain('$name0: String!');
  });
});

describe('buildFleetVariables', () => {
  it('maps each repo to owner{i}/name{i} variables', () => {
    const vars = buildFleetVariables([repo('octocat/hello-world'), repo('github/docs')]);
    expect(vars).toEqual({
      owner0: 'octocat',
      name0: 'hello-world',
      owner1: 'github',
      name1: 'docs',
    });
  });
});

// ── buildErrorIndex ─────────────────────────────────────────────────────────

describe('buildErrorIndex', () => {
  it('keys errors by their dot-joined path', () => {
    const index = buildErrorIndex([
      { message: 'gone', path: ['r0'] },
      { message: 'bad field', path: ['r2', 'defaultBranchRef'] },
    ]);
    expect(index.has('r0')).toBe(true);
    expect(index.has('r2.defaultBranchRef')).toBe(true);
    expect(index.has('r2')).toBe(false);
    expect(index.has('r1')).toBe(false);
  });

  it('coversField matches an exact path or any descendant in its subtree', () => {
    const index = buildErrorIndex([{ message: 'bad field', path: ['r2', 'defaultBranchRef'] }]);
    expect(index.coversField('r2')).toBe(true); // descendant errored
    expect(index.coversField('r2.defaultBranchRef')).toBe(true); // exact
    expect(index.coversField('r2.pullRequests')).toBe(false); // sibling, isolated
    expect(index.coversField('r3')).toBe(false);
  });

  it('ignores pathless (global) errors', () => {
    const index = buildErrorIndex([{ message: 'top-level failure' }]);
    expect(index.paths.size).toBe(0);
    expect(index.coversField('r0')).toBe(false);
  });
});

// ── executeFleetBatch ───────────────────────────────────────────────────────

describe('executeFleetBatch', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn();
    graphqlLimiter.reset();
    graphqlRateLimitStore.reset();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    graphqlLimiter.reset();
    graphqlRateLimitStore.reset();
  });

  it('derives CI slices matching useCiSignal semantics across rollup states', async () => {
    const repos = [
      repo('o/success'),
      repo('o/failure'),
      repo('o/pending'),
      repo('o/nullrollup'),
      repo('o/nobranch'),
      repo('o/archived'),
    ];

    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      mockJsonResponse(200, {
        data: {
          viewer: { login: 'me' },
          rateLimit: { cost: 1, remaining: 4990, resetAt: futureIso() },
          r0: rollupNode('o/success', 'SUCCESS'),
          r1: rollupNode('o/failure', 'FAILURE'),
          r2: rollupNode('o/pending', 'PENDING'),
          r3: {
            nameWithOwner: 'o/nullrollup',
            isArchived: false,
            defaultBranchRef: { target: { statusCheckRollup: null } },
          },
          r4: { nameWithOwner: 'o/nobranch', isArchived: false, defaultBranchRef: null },
          r5: {
            nameWithOwner: 'o/archived',
            isArchived: true,
            defaultBranchRef: { target: { statusCheckRollup: { state: 'SUCCESS' } } },
          },
        },
      }),
    );

    const result = await executeFleetBatch(repos, 'me', TOKEN);
    const ciMap = ciMapOf(result);

    expect(ci(ciMap, 'o/success')).toEqual({
      status: 'ready',
      conclusion: 'success',
      score: 0,
      failingCount: 0,
    });
    expect(ci(ciMap, 'o/failure')).toEqual({
      status: 'ready',
      conclusion: 'failure',
      score: 100,
      failingCount: 1,
    });
    expect(ci(ciMap, 'o/pending')).toEqual({
      status: 'ready',
      conclusion: 'in_progress',
      score: 10,
      failingCount: 0,
    });
    const none = { status: 'ready', conclusion: 'none', score: 0, failingCount: 0 };
    expect(ci(ciMap, 'o/nullrollup')).toEqual(none);
    expect(ci(ciMap, 'o/nobranch')).toEqual(none);
    expect(ci(ciMap, 'o/archived')).toEqual(none);
  });

  it('isolates a per-repo path error: only that repo errors, siblings stay correct', async () => {
    const repos = [repo('o/ok'), repo('o/broken')];

    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      mockJsonResponse(200, {
        data: {
          viewer: { login: 'me' },
          rateLimit: { cost: 1, remaining: 4990, resetAt: futureIso() },
          r0: rollupNode('o/ok', 'SUCCESS'),
          r1: null,
        },
        errors: [{ message: 'Something went wrong', path: ['r1'] }],
      }),
    );

    const result = await executeFleetBatch(repos, 'me', TOKEN);
    const ciMap = ciMapOf(result);

    expect(ci(ciMap, 'o/ok')).toEqual({
      status: 'ready',
      conclusion: 'success',
      score: 0,
      failingCount: 0,
    });
    expect(ci(ciMap, 'o/broken')).toEqual({ status: 'error' });
  });

  it('treats a null repo node WITHOUT a matching error as no-data (none), not error', async () => {
    const repos = [repo('o/nodata')];

    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      mockJsonResponse(200, {
        data: {
          viewer: { login: 'me' },
          rateLimit: { cost: 1, remaining: 4990, resetAt: futureIso() },
          r0: null,
        },
      }),
    );

    const result = await executeFleetBatch(repos, 'me', TOKEN);
    expect(ci(ciMapOf(result), 'o/nodata')).toEqual({
      status: 'ready',
      conclusion: 'none',
      score: 0,
      failingCount: 0,
    });
  });

  it('chunks large fleets into multiple queries and merges the results', async () => {
    const repos = Array.from({ length: FLEET_QUERY_CHUNK_SIZE + 2 }, (_, i) => repo(`o${i}/n${i}`));

    vi.mocked(globalThis.fetch).mockImplementation((_url, init) => {
      const vars = JSON.parse((init as RequestInit).body as string).variables as Record<
        string,
        string
      >;
      const data: Record<string, unknown> = {
        viewer: { login: 'me' },
        rateLimit: { cost: 1, remaining: 4990, resetAt: futureIso() },
      };
      let i = 0;
      while (`owner${i}` in vars) {
        data[`r${i}`] = rollupNode(`${vars[`owner${i}`]}/${vars[`name${i}`]}`, 'SUCCESS');
        i += 1;
      }
      return Promise.resolve(mockJsonResponse(200, { data }));
    });

    const result = await executeFleetBatch(repos, 'me', TOKEN);
    const ciMap = ciMapOf(result);

    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(ciMap.size).toBe(FLEET_QUERY_CHUNK_SIZE + 2);
    for (const r of repos) {
      expect(ci(ciMap, r.nameWithOwner).conclusion).toBe('success');
    }
  });

  it('isolates a hard chunk failure: that chunk errors, other chunks still resolve', async () => {
    const repos = Array.from({ length: FLEET_QUERY_CHUNK_SIZE + 2 }, (_, i) => repo(`o${i}/n${i}`));

    vi.mocked(globalThis.fetch).mockImplementation((_url, init) => {
      const vars = JSON.parse((init as RequestInit).body as string).variables as Record<
        string,
        string
      >;
      // The first chunk (owner0 === 'o0') hard-fails with a 500.
      if (vars.owner0 === 'o0') {
        return Promise.resolve(mockJsonResponse(500, { message: 'server error' }));
      }
      const data: Record<string, unknown> = {
        viewer: { login: 'me' },
        rateLimit: { cost: 1, remaining: 4990, resetAt: futureIso() },
      };
      let i = 0;
      while (`owner${i}` in vars) {
        data[`r${i}`] = rollupNode(`${vars[`owner${i}`]}/${vars[`name${i}`]}`, 'SUCCESS');
        i += 1;
      }
      return Promise.resolve(mockJsonResponse(200, { data }));
    });

    const result = await executeFleetBatch(repos, 'me', TOKEN);
    const ciMap = ciMapOf(result);

    // First chunk repos all error.
    for (let i = 0; i < FLEET_QUERY_CHUNK_SIZE; i += 1) {
      expect(ci(ciMap, `o${i}/n${i}`)).toEqual({ status: 'error' });
    }
    // Second chunk repos still resolve.
    expect(ci(ciMap, `o${FLEET_QUERY_CHUNK_SIZE}/n${FLEET_QUERY_CHUNK_SIZE}`).conclusion).toBe(
      'success',
    );
  });

  it('marks every repo in a data-less response as error', async () => {
    const repos = [repo('o/a'), repo('o/b')];

    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      mockJsonResponse(200, { errors: [{ message: 'total failure' }] }),
    );

    const result = await executeFleetBatch(repos, 'me', TOKEN);
    const ciMap = ciMapOf(result);
    expect(ci(ciMap, 'o/a')).toEqual({ status: 'error' });
    expect(ci(ciMap, 'o/b')).toEqual({ status: 'error' });
  });

  it('records the GraphQL cost from the rateLimit fragment', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      mockJsonResponse(200, {
        data: {
          viewer: { login: 'me' },
          rateLimit: { cost: 1, remaining: 4321, resetAt: futureIso() },
          r0: rollupNode('o/x', 'SUCCESS'),
        },
      }),
    );

    await executeFleetBatch([repo('o/x')], 'me', TOKEN);
    expect(graphqlRateLimitStore.getState().info?.remaining).toBe(4321);
  });

  it('returns empty per-signal maps for an empty fleet without any request', async () => {
    const result = await executeFleetBatch([], 'me', TOKEN);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(ciMapOf(result).size).toBe(0);
  });

  it('maps EXPECTED rollup state to a queued CI slice (score 10)', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      mockJsonResponse(200, {
        data: {
          viewer: { login: 'me' },
          rateLimit: { cost: 1, remaining: 4990, resetAt: futureIso() },
          r0: rollupNode('o/x', 'EXPECTED'),
        },
      }),
    );

    const result = await executeFleetBatch([repo('o/x')], 'me', TOKEN);
    expect(ci(ciMapOf(result), 'o/x')).toEqual({
      status: 'ready',
      conclusion: 'queued',
      score: 10,
      failingCount: 0,
    });
  });

  it('errors only the repo whose defaultBranchRef path errored; sibling with SUCCESS stays ok', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      mockJsonResponse(200, {
        data: {
          viewer: { login: 'me' },
          rateLimit: { cost: 1, remaining: 4990, resetAt: futureIso() },
          r0: { nameWithOwner: 'o/x', isArchived: false, defaultBranchRef: null },
          r1: rollupNode('o/y', 'SUCCESS'),
        },
        errors: [{ message: 'field error', path: ['r0', 'defaultBranchRef'] }],
      }),
    );

    const result = await executeFleetBatch([repo('o/x'), repo('o/y')], 'me', TOKEN);
    const ciMap = ciMapOf(result);
    // r0's defaultBranchRef path errored → CI slice is error.
    expect(ci(ciMap, 'o/x')).toEqual({ status: 'error' });
    // r1 has no error path and a SUCCESS rollup → remains ok.
    expect(ci(ciMap, 'o/y')).toEqual({
      status: 'ready',
      conclusion: 'success',
      score: 0,
      failingCount: 0,
    });
  });
});

// ── registry ────────────────────────────────────────────────────────────────

describe('SIGNAL_DERIVERS registry', () => {
  it('starts with only the CI deriver registered', () => {
    expect(SIGNAL_DERIVERS).toHaveLength(1);
    expect(SIGNAL_DERIVERS[0].signal).toBe('ci');
    expect(SIGNAL_DERIVERS[0].kind).toBe('per-repo');
  });
});
