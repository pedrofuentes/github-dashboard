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

import type {
  CiSignalSlice,
  IssuesSignalSlice,
  PullRequestsSignalSlice,
  Repo,
  SignalSlice,
  StaleSignalSlice,
} from '../../types/fleet';
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

function issuesMapOf(result: FleetBatchResult): Map<string, SignalSlice> {
  const map = result.get('issues');
  if (!map) throw new Error('expected an issues slice map');
  return map;
}

function issues(result: Map<string, SignalSlice>, key: string): IssuesSignalSlice {
  return result.get(key) as IssuesSignalSlice;
}

function prMapOf(result: FleetBatchResult): Map<string, SignalSlice> {
  const map = result.get('pullRequests');
  if (!map) throw new Error('expected a pullRequests slice map');
  return map;
}

function prSlice(result: Map<string, SignalSlice>, key: string): PullRequestsSignalSlice {
  return result.get(key) as PullRequestsSignalSlice;
}

function staleMapOf(result: FleetBatchResult): Map<string, SignalSlice> {
  const map = result.get('stale');
  if (!map) throw new Error('expected a stale slice map');
  return map;
}

function staleSlice(result: Map<string, SignalSlice>, key: string): StaleSignalSlice {
  return result.get(key) as StaleSignalSlice;
}

/**
 * Builds a minimal GraphQL repo node with a pullRequests connection. Each entry
 * in `prs` only needs `isDraft` and `authorAssociation`; other fields default to
 * safe placeholders so tests that only care about counts stay concise.
 */
function prNode(
  nameWithOwner: string,
  prs: Array<{ isDraft: boolean; authorAssociation: string }>,
): unknown {
  return {
    nameWithOwner,
    pullRequests: {
      nodes: prs.map((p, i) => ({
        number: i + 1,
        title: `PR ${i + 1}`,
        url: `https://github.com/${nameWithOwner}/pull/${i + 1}`,
        createdAt: '2024-01-01T00:00:00Z',
        isDraft: p.isDraft,
        authorAssociation: p.authorAssociation,
        author: { login: `user${i + 1}` },
      })),
    },
  };
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

  it('composes the PR per-repo fragment inside each repository alias', () => {
    const query = buildFleetQuery(repos, null);
    expect(query).toContain('pullRequests(states: OPEN');
    expect(query).toContain('isDraft');
    expect(query).toContain('authorAssociation');
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
    expect(vars).toMatchObject({
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
  it('registers CI, issues, PR (per-repo) then stale (top-level), in that order', () => {
    expect(SIGNAL_DERIVERS).toHaveLength(4);
    expect(SIGNAL_DERIVERS[0].signal).toBe('ci');
    expect(SIGNAL_DERIVERS[0].kind).toBe('per-repo');
    expect(SIGNAL_DERIVERS[1].signal).toBe('issues');
    expect(SIGNAL_DERIVERS[1].kind).toBe('per-repo');
    expect(SIGNAL_DERIVERS[2].signal).toBe('pullRequests');
    expect(SIGNAL_DERIVERS[2].kind).toBe('per-repo');
    expect(SIGNAL_DERIVERS[3].signal).toBe('stale');
    expect(SIGNAL_DERIVERS[3].kind).toBe('top-level');
  });
});

// ── issuesDeriver ────────────────────────────────────────────────────────────

describe('issuesDeriver – buildFleetQuery viewer seam', () => {
  const r = repo('o/r');

  it('includes openIssues selection in every query regardless of viewerLogin', () => {
    expect(buildFleetQuery([r], null)).toContain('openIssues:');
    expect(buildFleetQuery([r], 'octocat')).toContain('openIssues:');
  });

  it('omits myIssues and $viewer when viewerLogin is null', () => {
    const query = buildFleetQuery([r], null);
    expect(query).not.toContain('myIssues');
    expect(query).not.toContain('$viewer');
    expect(query).not.toContain('createdBy');
  });

  it('includes myIssues, $viewer declaration, and createdBy filter when viewerLogin is present', () => {
    const query = buildFleetQuery([r], 'octocat');
    expect(query).toContain('myIssues:');
    expect(query).toContain('$viewer');
    expect(query).toContain('createdBy: $viewer');
  });

  it('buildFleetVariables includes viewer key when viewerLogin is supplied', () => {
    const vars = buildFleetVariables([r], 'octocat');
    expect(vars.viewer).toBe('octocat');
  });

  it('buildFleetVariables omits viewer key when viewerLogin is null/absent', () => {
    expect(buildFleetVariables([r], null)).not.toHaveProperty('viewer');
    expect(buildFleetVariables([r])).not.toHaveProperty('viewer');
  });
});

describe('issuesDeriver – executeFleetBatch', () => {
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

  it('derives ready slice with openCount from openIssues.totalCount', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      mockJsonResponse(200, {
        data: {
          viewer: null,
          rateLimit: { cost: 1, remaining: 4990, resetAt: futureIso() },
          r0: { nameWithOwner: 'o/r', openIssues: { totalCount: 5 } },
        },
      }),
    );

    const result = await executeFleetBatch([repo('o/r')], null, TOKEN);
    expect(issues(issuesMapOf(result), 'o/r')).toMatchObject({
      status: 'ready',
      openCount: 5,
      overThreshold: false,
      score: 1, // Math.floor(5 / 4)
    });
  });

  it('with viewerLogin: mineCount and communityCount are populated from myIssues.totalCount', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      mockJsonResponse(200, {
        data: {
          viewer: { login: 'me' },
          rateLimit: { cost: 1, remaining: 4990, resetAt: futureIso() },
          r0: {
            nameWithOwner: 'o/r',
            openIssues: { totalCount: 10 },
            myIssues: { totalCount: 3 },
          },
        },
      }),
    );

    const result = await executeFleetBatch([repo('o/r')], 'me', TOKEN);
    expect(issues(issuesMapOf(result), 'o/r')).toMatchObject({
      status: 'ready',
      openCount: 10,
      mineCount: 3,
      communityCount: 7,
      overThreshold: false,
    });
  });

  it('without viewerLogin: mineCount and communityCount are undefined', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      mockJsonResponse(200, {
        data: {
          viewer: null,
          rateLimit: { cost: 1, remaining: 4990, resetAt: futureIso() },
          r0: { nameWithOwner: 'o/r', openIssues: { totalCount: 5 } },
        },
      }),
    );

    const result = await executeFleetBatch([repo('o/r')], null, TOKEN);
    const slice = issues(issuesMapOf(result), 'o/r');
    expect(slice.status).toBe('ready');
    expect(slice.mineCount).toBeUndefined();
    expect(slice.communityCount).toBeUndefined();
  });

  it('clamps communityCount to 0 when mineCount exceeds openCount', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      mockJsonResponse(200, {
        data: {
          viewer: { login: 'me' },
          rateLimit: { cost: 1, remaining: 4990, resetAt: futureIso() },
          r0: { nameWithOwner: 'o/r', openIssues: { totalCount: 2 }, myIssues: { totalCount: 5 } },
        },
      }),
    );

    const result = await executeFleetBatch([repo('o/r')], 'me', TOKEN);
    expect(issues(issuesMapOf(result), 'o/r')).toMatchObject({ communityCount: 0 });
  });

  it('score escalates to the full open count when at or above ISSUE_TRIAGE_THRESHOLD (20)', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      mockJsonResponse(200, {
        data: {
          viewer: null,
          rateLimit: { cost: 1, remaining: 4990, resetAt: futureIso() },
          r0: { nameWithOwner: 'o/r', openIssues: { totalCount: 20 } },
        },
      }),
    );

    const result = await executeFleetBatch([repo('o/r')], null, TOKEN);
    const slice = issues(issuesMapOf(result), 'o/r');
    expect(slice.overThreshold).toBe(true);
    expect(slice.score).toBe(20);
  });

  it('openIssues subtree error → error slice; sibling repo with clean data stays ready', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      mockJsonResponse(200, {
        data: {
          viewer: null,
          rateLimit: { cost: 1, remaining: 4990, resetAt: futureIso() },
          r0: { nameWithOwner: 'o/broken', openIssues: null },
          r1: { nameWithOwner: 'o/ok', openIssues: { totalCount: 3 } },
        },
        errors: [{ message: 'issues field error', path: ['r0', 'openIssues'] }],
      }),
    );

    const result = await executeFleetBatch([repo('o/broken'), repo('o/ok')], null, TOKEN);
    expect(issues(issuesMapOf(result), 'o/broken')).toEqual({ status: 'error' });
    expect(issues(issuesMapOf(result), 'o/ok')).toMatchObject({ status: 'ready', openCount: 3 });
  });

  it('whole-repo error (alias path) → issues error slice', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      mockJsonResponse(200, {
        data: {
          viewer: null,
          rateLimit: { cost: 1, remaining: 4990, resetAt: futureIso() },
          r0: null,
        },
        errors: [{ message: 'repo gone', path: ['r0'] }],
      }),
    );

    const result = await executeFleetBatch([repo('o/r')], null, TOKEN);
    expect(issues(issuesMapOf(result), 'o/r')).toEqual({ status: 'error' });
  });

  it('null node without a path error → zero ready slice (no-data, not failure)', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      mockJsonResponse(200, {
        data: {
          viewer: null,
          rateLimit: { cost: 1, remaining: 4990, resetAt: futureIso() },
          r0: null,
        },
      }),
    );

    const result = await executeFleetBatch([repo('o/r')], null, TOKEN);
    expect(issues(issuesMapOf(result), 'o/r')).toMatchObject({
      status: 'ready',
      openCount: 0,
      overThreshold: false,
      score: 0,
    });
  });

  it('overThreshold and score are keyed to the TOTAL openCount, not communityCount', async () => {
    // mineCount === openCount → communityCount === 0, but score must escalate on total
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      mockJsonResponse(200, {
        data: {
          viewer: { login: 'me' },
          rateLimit: { cost: 1, remaining: 4990, resetAt: futureIso() },
          r0: {
            nameWithOwner: 'o/r',
            openIssues: { totalCount: 20 },
            myIssues: { totalCount: 20 },
          },
        },
      }),
    );

    const result = await executeFleetBatch([repo('o/r')], 'me', TOKEN);
    expect(issues(issuesMapOf(result), 'o/r')).toMatchObject({
      overThreshold: true,
      score: 20,
      communityCount: 0,
    });
  });

  it('myIssues subtree error nulls the repo node → error slice, not a false openCount:0', async () => {
    // When `myIssues` errors at runtime, GraphQL null-propagation nulls the whole
    // repository node (nearest nullable ancestor). The error path is [alias, 'myIssues'].
    // Neither `has(alias)` (exact) nor `coversField(alias.openIssues)` matches, so without
    // the myIssues guard the deriver falls through to the !node branch and silently
    // returns openCount:0 — hiding an unhealthy repo. This test asserts the honest result.
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      mockJsonResponse(200, {
        data: {
          viewer: { login: 'me' },
          rateLimit: { cost: 1, remaining: 4990, resetAt: futureIso() },
          r0: null,
          r1: { nameWithOwner: 'o/sibling', openIssues: { totalCount: 7 } },
        },
        errors: [{ message: 'Could not resolve myIssues', path: ['r0', 'myIssues'] }],
      }),
    );

    const result = await executeFleetBatch([repo('o/broken'), repo('o/sibling')], 'me', TOKEN);
    // r0 nulled by myIssues error propagation → must be an honest error slice, not zero.
    expect(issues(issuesMapOf(result), 'o/broken')).toEqual({ status: 'error' });
    // r1 (sibling) is unaffected and derives correctly.
    expect(issues(issuesMapOf(result), 'o/sibling')).toMatchObject({
      status: 'ready',
      openCount: 7,
    });
  });
});

// ── prDeriver ────────────────────────────────────────────────────────────────

describe('prDeriver – executeFleetBatch', () => {
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

  it('openCount counts ONLY non-draft PRs (3 non-draft + 2 draft → openCount: 3)', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      mockJsonResponse(200, {
        data: {
          viewer: null,
          rateLimit: { cost: 1, remaining: 4990, resetAt: futureIso() },
          r0: prNode('o/r', [
            { isDraft: false, authorAssociation: 'MEMBER' },
            { isDraft: false, authorAssociation: 'OWNER' },
            { isDraft: false, authorAssociation: 'COLLABORATOR' },
            { isDraft: true, authorAssociation: 'MEMBER' },
            { isDraft: true, authorAssociation: 'NONE' }, // draft from outside assoc → excluded
          ]),
        },
      }),
    );

    const result = await executeFleetBatch([repo('o/r')], null, TOKEN);
    const slice = prSlice(prMapOf(result), 'o/r');
    expect(slice.status).toBe('ready');
    expect(slice.openCount).toBe(3);
    expect(slice.externalCount).toBe(0);
  });

  it('external = non-draft ∩ OUTSIDE_CONTRIBUTOR_ASSOCIATIONS; CONTRIBUTOR + drafts excluded', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      mockJsonResponse(200, {
        data: {
          viewer: null,
          rateLimit: { cost: 1, remaining: 4990, resetAt: futureIso() },
          r0: prNode('o/r', [
            { isDraft: false, authorAssociation: 'MEMBER' }, // not external
            { isDraft: false, authorAssociation: 'CONTRIBUTOR' }, // returning → excluded
            { isDraft: false, authorAssociation: 'FIRST_TIME_CONTRIBUTOR' }, // external
            { isDraft: false, authorAssociation: 'FIRST_TIMER' }, // external
            { isDraft: false, authorAssociation: 'NONE' }, // external
            { isDraft: false, authorAssociation: 'MANNEQUIN' }, // external
            { isDraft: true, authorAssociation: 'FIRST_TIME_CONTRIBUTOR' }, // draft → excluded
            { isDraft: true, authorAssociation: 'NONE' }, // draft → excluded
          ]),
        },
      }),
    );

    const result = await executeFleetBatch([repo('o/r')], null, TOKEN);
    const slice = prSlice(prMapOf(result), 'o/r');
    expect(slice.openCount).toBe(6); // 8 total minus 2 drafts
    expect(slice.externalCount).toBe(4); // FIRST_TIME_CONTRIBUTOR, FIRST_TIMER, NONE, MANNEQUIN
  });

  it('score = externalCount * 5 + openCount', async () => {
    // 1 non-draft member + 2 non-draft external → openCount 3, externalCount 2 → score 13
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      mockJsonResponse(200, {
        data: {
          viewer: null,
          rateLimit: { cost: 1, remaining: 4990, resetAt: futureIso() },
          r0: prNode('o/r', [
            { isDraft: false, authorAssociation: 'MEMBER' },
            { isDraft: false, authorAssociation: 'NONE' },
            { isDraft: false, authorAssociation: 'FIRST_TIME_CONTRIBUTOR' },
          ]),
        },
      }),
    );

    const result = await executeFleetBatch([repo('o/r')], null, TOKEN);
    expect(prSlice(prMapOf(result), 'o/r')).toMatchObject({
      status: 'ready',
      openCount: 3,
      externalCount: 2,
      score: 13,
    });
  });

  it('externalPullRequests present with mapped fields when externalCount > 0', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      mockJsonResponse(200, {
        data: {
          viewer: null,
          rateLimit: { cost: 1, remaining: 4990, resetAt: futureIso() },
          r0: {
            nameWithOwner: 'o/r',
            pullRequests: {
              nodes: [
                {
                  number: 7,
                  title: 'Great PR',
                  url: 'https://github.com/o/r/pull/7',
                  createdAt: '2024-06-01T00:00:00Z',
                  isDraft: false,
                  authorAssociation: 'NONE',
                  author: { login: 'newbie' },
                },
              ],
            },
          },
        },
      }),
    );

    const result = await executeFleetBatch([repo('o/r')], null, TOKEN);
    const slice = prSlice(prMapOf(result), 'o/r');
    expect(slice.externalPullRequests).toEqual([
      {
        number: 7,
        title: 'Great PR',
        html_url: 'https://github.com/o/r/pull/7',
        created_at: '2024-06-01T00:00:00Z',
        user_login: 'newbie',
        author_association: 'NONE',
      },
    ]);
  });

  it('externalPullRequests omitted when externalCount is 0', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      mockJsonResponse(200, {
        data: {
          viewer: null,
          rateLimit: { cost: 1, remaining: 4990, resetAt: futureIso() },
          r0: prNode('o/r', [
            { isDraft: false, authorAssociation: 'MEMBER' },
            { isDraft: false, authorAssociation: 'OWNER' },
          ]),
        },
      }),
    );

    const result = await executeFleetBatch([repo('o/r')], null, TOKEN);
    const slice = prSlice(prMapOf(result), 'o/r');
    expect(slice.status).toBe('ready');
    expect(slice.externalPullRequests).toBeUndefined();
  });

  it('null author (ghost PR) → user_login empty string without crashing', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      mockJsonResponse(200, {
        data: {
          viewer: null,
          rateLimit: { cost: 1, remaining: 4990, resetAt: futureIso() },
          r0: {
            nameWithOwner: 'o/r',
            pullRequests: {
              nodes: [
                {
                  number: 3,
                  title: 'Ghost PR',
                  url: 'https://github.com/o/r/pull/3',
                  createdAt: '2024-01-01T00:00:00Z',
                  isDraft: false,
                  authorAssociation: 'NONE',
                  author: null,
                },
              ],
            },
          },
        },
      }),
    );

    const result = await executeFleetBatch([repo('o/r')], null, TOKEN);
    const slice = prSlice(prMapOf(result), 'o/r');
    expect(slice.externalCount).toBe(1);
    expect(slice.externalPullRequests?.[0].user_login).toBe('');
  });

  it('pullRequests subtree error → error slice; sibling repo with clean data stays ready', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      mockJsonResponse(200, {
        data: {
          viewer: null,
          rateLimit: { cost: 1, remaining: 4990, resetAt: futureIso() },
          r0: { nameWithOwner: 'o/broken', pullRequests: null },
          r1: prNode('o/ok', [{ isDraft: false, authorAssociation: 'MEMBER' }]),
        },
        errors: [{ message: 'pullRequests field error', path: ['r0', 'pullRequests'] }],
      }),
    );

    const result = await executeFleetBatch([repo('o/broken'), repo('o/ok')], null, TOKEN);
    expect(prSlice(prMapOf(result), 'o/broken')).toEqual({ status: 'error' });
    expect(prSlice(prMapOf(result), 'o/ok')).toMatchObject({ status: 'ready', openCount: 1 });
  });

  it('whole-repo error (alias path) → PR error slice', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      mockJsonResponse(200, {
        data: {
          viewer: null,
          rateLimit: { cost: 1, remaining: 4990, resetAt: futureIso() },
          r0: null,
        },
        errors: [{ message: 'repo gone', path: ['r0'] }],
      }),
    );

    const result = await executeFleetBatch([repo('o/r')], null, TOKEN);
    expect(prSlice(prMapOf(result), 'o/r')).toEqual({ status: 'error' });
  });

  it('absent pullRequests (null node, no error) → zero ready slice', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      mockJsonResponse(200, {
        data: {
          viewer: null,
          rateLimit: { cost: 1, remaining: 4990, resetAt: futureIso() },
          r0: null,
        },
      }),
    );

    const result = await executeFleetBatch([repo('o/r')], null, TOKEN);
    expect(prSlice(prMapOf(result), 'o/r')).toMatchObject({
      status: 'ready',
      openCount: 0,
      externalCount: 0,
      score: 0,
    });
  });
});

// ── staleDeriver (first top-level deriver: GraphQL search) ───────────────────

describe('staleDeriver – buildFleetQuery / buildFleetVariables (top-level seam)', () => {
  it('declares a $stale_r{i}: String! variable per repo in the query header', () => {
    const query = buildFleetQuery([repo('o/a'), repo('o/b')], null);
    expect(query).toContain('$stale_r0: String!');
    expect(query).toContain('$stale_r1: String!');
  });

  it('emits one aliased top-level search per repo bound to its $stale_r{i} variable', () => {
    const query = buildFleetQuery([repo('o/a')], null);
    expect(query).toContain('stale_r0: search(');
    expect(query).toContain('type: ISSUE');
    expect(query).toContain('first: 30');
    expect(query).toContain('query: $stale_r0');
    expect(query).toContain('issueCount');
    expect(query).toContain('__typename');
  });

  it('passes the per-repo search query ONLY as a bound variable, never inline (injection-safe)', () => {
    const query = buildFleetQuery([repo('o/a')], null);
    // The raw search qualifier must reach the document solely via $stale_r0 —
    // no inline `repo:`/`is:open` literal may appear in the query string.
    expect(query).not.toContain('repo:o/a');
    expect(query).not.toContain('is:open');
    expect(query).toContain('query: $stale_r0');
  });

  it('binds each stale_r{i} variable to the repo search query shape', () => {
    const vars = buildFleetVariables([repo('o/a'), repo('o/b')]);
    // Date is omitted to avoid flakiness; the prefix is the stable contract.
    expect(vars.stale_r0.startsWith('repo:o/a is:open updated:<')).toBe(true);
    expect(vars.stale_r1.startsWith('repo:o/b is:open updated:<')).toBe(true);
  });
});

describe('staleDeriver – executeFleetBatch', () => {
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

  it('maps issueCount→staleCount and search nodes→staleItems (pr vs issue via __typename)', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      mockJsonResponse(200, {
        data: {
          viewer: null,
          rateLimit: { cost: 1, remaining: 4990, resetAt: futureIso() },
          r0: { nameWithOwner: 'o/a' },
          stale_r0: {
            issueCount: 2,
            nodes: [
              {
                __typename: 'PullRequest',
                number: 7,
                title: 'Old PR',
                url: 'https://github.com/o/a/pull/7',
                updatedAt: '2023-01-01T00:00:00Z',
              },
              {
                __typename: 'Issue',
                number: 9,
                title: 'Old issue',
                url: 'https://github.com/o/a/issues/9',
                updatedAt: '2023-02-01T00:00:00Z',
              },
            ],
          },
        },
      }),
    );

    const result = await executeFleetBatch([repo('o/a')], null, TOKEN);
    const slice = staleSlice(staleMapOf(result), 'o/a');
    expect(slice).toEqual({
      status: 'ready',
      staleCount: 2,
      score: 2,
      staleItems: [
        {
          number: 7,
          title: 'Old PR',
          html_url: 'https://github.com/o/a/pull/7',
          updated_at: '2023-01-01T00:00:00Z',
          type: 'pr',
        },
        {
          number: 9,
          title: 'Old issue',
          html_url: 'https://github.com/o/a/issues/9',
          updated_at: '2023-02-01T00:00:00Z',
          type: 'issue',
        },
      ],
    });
  });

  it('omits staleItems when the search returned no nodes (score still equals staleCount)', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      mockJsonResponse(200, {
        data: {
          viewer: null,
          rateLimit: { cost: 1, remaining: 4990, resetAt: futureIso() },
          r0: { nameWithOwner: 'o/a' },
          stale_r0: { issueCount: 5, nodes: [] },
        },
      }),
    );

    const result = await executeFleetBatch([repo('o/a')], null, TOKEN);
    const slice = staleSlice(staleMapOf(result), 'o/a');
    expect(slice).toEqual({ status: 'ready', staleCount: 5, score: 5 });
    expect(slice.staleItems).toBeUndefined();
  });

  it('isolates a per-repo search error: only that repo errors, siblings stay ready', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      mockJsonResponse(200, {
        data: {
          viewer: null,
          rateLimit: { cost: 1, remaining: 4990, resetAt: futureIso() },
          r0: { nameWithOwner: 'o/a' },
          r1: { nameWithOwner: 'o/b' },
          stale_r0: { issueCount: 1, nodes: [] },
          stale_r1: null,
        },
        errors: [{ message: 'search failed', path: ['stale_r1'] }],
      }),
    );

    const result = await executeFleetBatch([repo('o/a'), repo('o/b')], null, TOKEN);
    const staleMap = staleMapOf(result);
    expect(staleSlice(staleMap, 'o/a')).toEqual({ status: 'ready', staleCount: 1, score: 1 });
    expect(staleSlice(staleMap, 'o/b')).toEqual({ status: 'error' });
  });

  it('treats a missing search alias WITHOUT a matching error as ready-zero (no data), not error', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      mockJsonResponse(200, {
        data: {
          viewer: null,
          rateLimit: { cost: 1, remaining: 4990, resetAt: futureIso() },
          r0: { nameWithOwner: 'o/a' },
          // stale_r0 alias intentionally absent, no error references it.
        },
      }),
    );

    const result = await executeFleetBatch([repo('o/a')], null, TOKEN);
    expect(staleSlice(staleMapOf(result), 'o/a')).toEqual({
      status: 'ready',
      staleCount: 0,
      score: 0,
    });
  });
});
