/**
 * Additional tests for the issues-releases module covering the
 * include-pre-releases error path and the formatRelativeTime helper, which
 * github-api.test.ts does not exercise.
 *
 * Mocks the global fetch so no real HTTP calls are made.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchLatestRelease, formatRelativeTime } from './issues-releases';
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
