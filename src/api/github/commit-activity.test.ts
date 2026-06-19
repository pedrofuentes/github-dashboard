/**
 * Tests for fetchCommitActivityWeeks (src/api/github/security-branches.ts),
 * which github-api.test.ts and network-graph-api.test.ts do not exercise.
 * Covers the 202 (computing), 204 (empty), success and error paths.
 *
 * Mocks the global fetch so no real HTTP calls are made.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchCommitActivityWeeks } from './security-branches';
import { GitHubApiError } from './index';

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

describe('fetchCommitActivityWeeks', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns null while GitHub is still computing the stats (202)', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(mockFetchResponse(202, ''));

    const result = await fetchCommitActivityWeeks('owner', 'repo', 'ghp_test');
    expect(result).toBeNull();
  });

  it('returns an empty array for an empty repository (204)', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(mockFetchResponse(204, ''));

    const result = await fetchCommitActivityWeeks('owner', 'repo', 'ghp_test');
    expect(result).toEqual([]);
  });

  it('returns the parsed weekly activity on success', async () => {
    const weeks = [
      { total: 5, week: 1700000000, days: [0, 1, 2, 0, 1, 1, 0] },
      { total: 0, week: 1700604800, days: [0, 0, 0, 0, 0, 0, 0] },
    ];
    vi.mocked(globalThis.fetch).mockResolvedValue(mockFetchResponse(200, weeks));

    const result = await fetchCommitActivityWeeks('owner', 'repo', 'ghp_test');
    expect(result).toHaveLength(2);
    expect(result?.[0].total).toBe(5);
    expect(result?.[0].days).toHaveLength(7);
  });

  it('works without a token for a public repository', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(mockFetchResponse(204, ''));

    const result = await fetchCommitActivityWeeks('owner', 'repo');
    expect(result).toEqual([]);
  });

  it('throws a GitHubApiError on API failure', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      mockFetchResponse(500, { message: 'server error' }),
    );

    await expect(fetchCommitActivityWeeks('owner', 'repo', 'ghp_test')).rejects.toThrow(
      GitHubApiError,
    );
  });
});
