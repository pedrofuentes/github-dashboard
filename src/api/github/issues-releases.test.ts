/**
 * Additional tests for the issues-releases module covering the
 * include-pre-releases error path and the formatRelativeTime helper, which
 * github-api.test.ts does not exercise.
 *
 * Mocks the global fetch so no real HTTP calls are made.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchLatestRelease, formatRelativeTime, fetchViewerIssueCount } from './issues-releases';
import { GitHubApiError, searchLimiter } from './index';

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

// ──────────────────────────────────────────────
// fetchViewerIssueCount
// ──────────────────────────────────────────────

describe('fetchViewerIssueCount', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn();
    searchLimiter.reset();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    searchLimiter.reset();
  });

  it('returns total_count from the Search API', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(mockFetchResponse(200, { total_count: 7 }));

    const result = await fetchViewerIssueCount('owner', 'repo', 'alice');
    expect(result).toBe(7);
  });

  it('retries through the shared Search limiter on a secondary-limit 403, then resolves', async () => {
    // A 403 carrying Retry-After is a secondary rate limit: routed through the
    // shared Search limiter it is reclassified RATE_LIMITED and retried, so the
    // count resolves instead of erroring the repo (T-bf2 / #495).
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(
        mockFetchResponse(
          403,
          { message: 'secondary rate limit' },
          mockHeaders({ 'retry-after': '0' }),
        ),
      )
      .mockResolvedValueOnce(mockFetchResponse(200, { total_count: 4 }));

    const result = await fetchViewerIssueCount('owner', 'repo', 'alice', 'ghp_test');
    expect(result).toBe(4);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it('builds URL with repo, type:issue, is:open and author:<login> qualifiers', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(mockFetchResponse(200, { total_count: 3 }));

    await fetchViewerIssueCount('owner', 'repo', 'alice', 'ghp_test');
    const url = vi.mocked(globalThis.fetch).mock.calls[0][0] as string;
    const decoded = decodeURIComponent(url);
    expect(decoded).toContain('repo:owner/repo');
    expect(decoded).toContain('type:issue');
    expect(decoded).toContain('is:open');
    expect(decoded).toContain('author:alice');
    expect(url).toContain('per_page=1');
    // The token must be forwarded as an Authorization header so private-repo
    // searches are authenticated; dropping it causes silent 401/under-counts.
    const opts = vi.mocked(globalThis.fetch).mock.calls[0][1];
    expect((opts?.headers as Record<string, string>)['Authorization']).toBe('Bearer ghp_test');
  });

  it('URL-encodes the search query so no raw spaces appear in the query param', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(mockFetchResponse(200, { total_count: 0 }));

    await fetchViewerIssueCount('my-org', 'my-repo', 'dev-bot');
    const url = vi.mocked(globalThis.fetch).mock.calls[0][0] as string;
    const qIndex = url.indexOf('?q=');
    expect(qIndex).toBeGreaterThan(0);
    expect(url.slice(qIndex)).not.toContain(' ');
  });

  it('throws GitHubApiError on non-OK response', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      mockFetchResponse(401, { message: 'Bad credentials' }),
    );

    await expect(fetchViewerIssueCount('owner', 'repo', 'alice', 'bad_token')).rejects.toThrow(
      GitHubApiError,
    );
    await expect(fetchViewerIssueCount('owner', 'repo', 'alice', 'bad_token')).rejects.toThrow(
      /Invalid or expired/,
    );
  });
});

describe('fetchLatestRelease — includePreReleases error path', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('throws when the /releases list request fails', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      mockFetchResponse(500, { message: 'server error' }),
    );

    await expect(fetchLatestRelease('owner', 'repo', 'ghp_test', true)).rejects.toThrow(
      GitHubApiError,
    );
  });
});

describe('formatRelativeTime', () => {
  it('returns an empty string for empty input', () => {
    expect(formatRelativeTime('')).toBe('');
  });

  it('returns "just now" for less than a minute', () => {
    expect(formatRelativeTime(new Date(Date.now() - 30 * 1000).toISOString())).toBe('just now');
  });

  it('formats minutes', () => {
    expect(formatRelativeTime(new Date(Date.now() - 5 * 60 * 1000).toISOString())).toBe('5m ago');
  });

  it('formats hours', () => {
    expect(formatRelativeTime(new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString())).toBe(
      '3h ago',
    );
  });

  it('formats days', () => {
    expect(formatRelativeTime(new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString())).toBe(
      '2d ago',
    );
  });

  it('formats weeks', () => {
    expect(
      formatRelativeTime(new Date(Date.now() - 2 * 7 * 24 * 60 * 60 * 1000).toISOString()),
    ).toBe('2w ago');
  });

  it('formats months', () => {
    expect(formatRelativeTime(new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString())).toBe(
      '2mo ago',
    );
  });

  it('formats years', () => {
    expect(formatRelativeTime(new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString())).toBe(
      '1y ago',
    );
  });
});
