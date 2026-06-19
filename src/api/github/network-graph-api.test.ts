/**
 * Tests for fetchCommitsForGraph and fetchTagsForGraph
 * (src/utils/github-api/security-branches.ts).
 *
 * Mocks the global fetch so no real HTTP calls are made. Tests cover happy
 * paths, edge cases (null authors, merge commits), parameter clamping, and
 * standard API error codes.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchCommitsForGraph, fetchTagsForGraph } from './security-branches';
import { GitHubApiError, GitHubErrorCode } from './index';

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function mockHeaders(overrides: Record<string, string> = {}): Headers {
  const defaults: Record<string, string> = {
    'x-ratelimit-limit': '5000',
    'x-ratelimit-remaining': '4999',
    'x-ratelimit-reset': Math.floor(Date.now() / 1000 + 3600).toString(),
    'x-ratelimit-used': '1',
  };
  return new Headers({ ...defaults, ...overrides });
}

function mockFetchResponse(status: number, body: unknown, headers?: Headers): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: headers ?? mockHeaders(),
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

/** Builds a single commit object matching the GitHub REST API shape. */
function makeApiCommit(
  overrides: {
    sha?: string;
    parentShas?: string[];
    message?: string;
    authorName?: string | null;
    authorDate?: string | null;
    committerName?: string | null;
    committerDate?: string | null;
  } = {},
): Record<string, unknown> {
  const sha = overrides.sha ?? 'abc123';
  const parentShas = overrides.parentShas ?? [];

  const author =
    overrides.authorName === null
      ? null
      : {
          name: overrides.authorName ?? 'Alice',
          ...(overrides.authorDate !== null
            ? { date: overrides.authorDate ?? '2024-01-15T10:30:00Z' }
            : {}),
        };

  const committer =
    overrides.committerName === null
      ? null
      : {
          name: overrides.committerName ?? 'Bob',
          ...(overrides.committerDate !== null
            ? { date: overrides.committerDate ?? '2024-01-15T10:30:00Z' }
            : {}),
        };

  return {
    sha,
    parents: parentShas.map((s) => ({ sha: s })),
    commit: { message: overrides.message ?? 'feat: init', author, committer },
  };
}

/** Builds a single tag object matching the GitHub REST API shape. */
function makeApiTag(name: string, sha: string): Record<string, unknown> {
  return { name, commit: { sha } };
}

// ──────────────────────────────────────────────
// Tests — fetchCommitsForGraph
// ──────────────────────────────────────────────

describe('fetchCommitsForGraph', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns commits with the correct shape', async () => {
    const apiCommit = makeApiCommit({
      sha: 'aaa111',
      parentShas: ['bbb222'],
      message: 'feat: add widget',
      authorName: 'Alice',
      authorDate: '2024-06-01T12:00:00Z',
      committerName: 'Bob',
      committerDate: '2024-06-01T13:00:00Z',
    });

    vi.mocked(globalThis.fetch).mockResolvedValueOnce(mockFetchResponse(200, [apiCommit]));

    const commits = await fetchCommitsForGraph('owner', 'repo', 'tok_123');

    expect(commits).toHaveLength(1);
    expect(commits[0]).toEqual({
      oid: 'aaa111',
      parentOids: ['bbb222'],
      message: 'feat: add widget',
      author: {
        name: 'Alice',
        email: '',
        timestamp: Math.floor(new Date('2024-06-01T12:00:00Z').getTime() / 1000),
        timezoneOffset: 0,
      },
      committer: {
        name: 'Bob',
        email: '',
        timestamp: Math.floor(new Date('2024-06-01T13:00:00Z').getTime() / 1000),
        timezoneOffset: 0,
      },
    });
  });

  it('handles merge commits with multiple parents', async () => {
    const apiCommit = makeApiCommit({
      sha: 'merge1',
      parentShas: ['parent1', 'parent2', 'parent3'],
      message: "Merge branch 'feature' into main",
    });

    vi.mocked(globalThis.fetch).mockResolvedValueOnce(mockFetchResponse(200, [apiCommit]));

    const commits = await fetchCommitsForGraph('owner', 'repo', 'tok_123');

    expect(commits[0].parentOids).toEqual(['parent1', 'parent2', 'parent3']);
  });

  it('handles null author/committer dates with timestamp 0 fallback', async () => {
    const apiCommit = makeApiCommit({
      sha: 'nodate1',
      authorName: 'Alice',
      authorDate: null,
      committerName: 'Bob',
      committerDate: null,
    });

    vi.mocked(globalThis.fetch).mockResolvedValueOnce(mockFetchResponse(200, [apiCommit]));

    const commits = await fetchCommitsForGraph('owner', 'repo', 'tok_123');

    expect(commits[0].author).toEqual({
      name: 'Alice',
      email: '',
      timestamp: 0,
      timezoneOffset: 0,
    });
    expect(commits[0].committer).toEqual({
      name: 'Bob',
      email: '',
      timestamp: 0,
      timezoneOffset: 0,
    });
  });

  it('handles null author/committer objects by mapping to undefined', async () => {
    const apiCommit = makeApiCommit({
      sha: 'nullpeople',
      authorName: null,
      committerName: null,
    });

    vi.mocked(globalThis.fetch).mockResolvedValueOnce(mockFetchResponse(200, [apiCommit]));

    const commits = await fetchCommitsForGraph('owner', 'repo', 'tok_123');

    expect(commits[0].author).toBeUndefined();
    expect(commits[0].committer).toBeUndefined();
  });

  it('respects maxCount parameter in the URL', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(mockFetchResponse(200, []));

    await fetchCommitsForGraph('owner', 'repo', 'tok_123', 50);

    const calledUrl = vi.mocked(globalThis.fetch).mock.calls[0][0] as string;
    expect(calledUrl).toContain('per_page=50');
  });

  it('defaults maxCount to 100', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(mockFetchResponse(200, []));

    await fetchCommitsForGraph('owner', 'repo', 'tok_123');

    const calledUrl = vi.mocked(globalThis.fetch).mock.calls[0][0] as string;
    expect(calledUrl).toContain('per_page=100');
  });

  it('caps maxCount at 100', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(mockFetchResponse(200, []));

    await fetchCommitsForGraph('owner', 'repo', 'tok_123', 250);

    const calledUrl = vi.mocked(globalThis.fetch).mock.calls[0][0] as string;
    expect(calledUrl).toContain('per_page=100');
  });

  it('throws GitHubApiError with AUTH_ERROR on 401', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      mockFetchResponse(401, { message: 'Bad credentials' }),
    );

    const err = await fetchCommitsForGraph('owner', 'repo', 'bad_token').catch((e) => e);
    expect(err).toBeInstanceOf(GitHubApiError);
    expect(err).toMatchObject({ status: 401, code: GitHubErrorCode.AUTH_ERROR });
  });

  it('throws GitHubApiError with NOT_FOUND on 404', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      mockFetchResponse(404, { message: 'Not Found' }),
    );

    const err = await fetchCommitsForGraph('owner', 'repo', 'tok_123').catch((e) => e);
    expect(err).toBeInstanceOf(GitHubApiError);
    expect(err).toMatchObject({ status: 404, code: GitHubErrorCode.NOT_FOUND });
  });

  it('throws GitHubApiError with RATE_LIMITED on 403 with zero remaining', async () => {
    const rateLimitHeaders = mockHeaders({
      'x-ratelimit-remaining': '0',
    });

    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      mockFetchResponse(403, { message: 'rate limit' }, rateLimitHeaders),
    );

    const err = await fetchCommitsForGraph('owner', 'repo', 'tok_123').catch((e) => e);
    expect(err).toBeInstanceOf(GitHubApiError);
    expect(err).toMatchObject({ status: 403, code: GitHubErrorCode.RATE_LIMITED });
  });
});

// ──────────────────────────────────────────────
// Tests — fetchTagsForGraph
// ──────────────────────────────────────────────

describe('fetchTagsForGraph', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns tags with correct shape', async () => {
    const apiTags = [makeApiTag('v1.0.0', 'sha_100'), makeApiTag('v2.0.0', 'sha_200')];

    vi.mocked(globalThis.fetch).mockResolvedValueOnce(mockFetchResponse(200, apiTags));

    const tags = await fetchTagsForGraph('owner', 'repo', 'tok_123');

    expect(tags).toEqual([
      { name: 'v1.0.0', oid: 'sha_100' },
      { name: 'v2.0.0', oid: 'sha_200' },
    ]);
  });

  it('handles empty tag list', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(mockFetchResponse(200, []));

    const tags = await fetchTagsForGraph('owner', 'repo', 'tok_123');

    expect(tags).toEqual([]);
  });

  it('throws GitHubApiError on API errors', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      mockFetchResponse(401, { message: 'Bad credentials' }),
    );

    const err = await fetchTagsForGraph('owner', 'repo', 'bad_token').catch((e) => e);
    expect(err).toBeInstanceOf(GitHubApiError);
    expect(err).toMatchObject({ status: 401, code: GitHubErrorCode.AUTH_ERROR });
  });
});
