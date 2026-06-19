/**
 * Tests for the security-alert fetchers in security-branches.ts:
 * `fetchCodeScanningAlerts` and `fetchDependabotAlerts`.
 *
 * Both feeds enumerate *open* alerts to grade a repo, so both must follow
 * `Link: rel="next"` pagination — a single `per_page=100` page silently
 * undercounts any repo with more than 100 open alerts (issues #63). The global
 * fetch is mocked so no real HTTP calls are made.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  MAX_ALERT_PAGES,
  assertGitHubApiOrigin,
  fetchCodeScanningAlerts,
  fetchDependabotAlerts,
} from './security-branches';
import { ETagCache } from './etag-cache';
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

/**
 * Builds a fake `Response`; pass `link` to advertise a `rel="next"` page and
 * `etag` to set the validator a later conditional request echoes back.
 */
function mockResponse(status: number, body: unknown, link?: string, etag?: string): Response {
  const headers = mockHeaders({
    ...(link ? { link } : {}),
    ...(etag ? { etag } : {}),
  });
  return {
    ok: status >= 200 && status < 300,
    status,
    headers,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

/** A code-scanning alert keyed by CVSS `security_severity_level`. */
function levelAlert(level: string): Record<string, unknown> {
  return { rule: { security_severity_level: level } };
}

/** A Dependabot alert keyed by advisory `severity`. */
function advisoryAlert(severity: string): Record<string, unknown> {
  return { security_advisory: { severity } };
}

const NEXT_PAGE_2 =
  '<https://api.github.com/repositories/1/code-scanning/alerts?state=open&per_page=100&page=2>; rel="next"';

describe('fetchCodeScanningAlerts', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('counts a single page of open alerts by severity', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      mockResponse(200, [levelAlert('critical'), levelAlert('high'), levelAlert('high')]),
    );

    const summary = await fetchCodeScanningAlerts('octo', 'a', 'tok');

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(summary).toEqual({
      critical: 1,
      high: 2,
      medium: 0,
      low: 0,
      total: 3,
      truncated: false,
    });
  });

  it('follows Link rel="next" and counts alerts across every page (>100)', async () => {
    const page1 = Array.from({ length: 100 }, () => levelAlert('high'));
    const page2 = Array.from({ length: 30 }, () => levelAlert('critical'));

    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(mockResponse(200, page1, NEXT_PAGE_2))
      .mockResolvedValueOnce(mockResponse(200, page2));

    const summary = await fetchCodeScanningAlerts('octo', 'a', 'tok');

    // Without the pagination follow only the first 100 alerts are seen and the
    // 30 criticals on page 2 vanish — silently over-grading the repo.
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(summary.high).toBe(100);
    expect(summary.critical).toBe(30);
    expect(summary.total).toBe(130);
    // The feed was exhausted within the cap, so the tally is complete (#77).
    expect(summary.truncated).toBe(false);
  });

  it('buckets every severity source (level + rule.severity), ignoring unknowns', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      mockResponse(200, [
        { rule: { security_severity_level: 'critical' } },
        { rule: { security_severity_level: 'high' } },
        { rule: { security_severity_level: 'medium' } },
        { rule: { security_severity_level: 'low' } },
        { rule: { severity: 'error' } }, // -> high
        { rule: { severity: 'warning' } }, // -> medium
        { rule: { severity: 'note' } }, // -> low
        { rule: { severity: 'unknown' } }, // ignored
        { rule: null }, // ignored
        {}, // ignored
      ]),
    );

    const summary = await fetchCodeScanningAlerts('octo', 'a', 'tok');

    expect(summary).toEqual({
      critical: 1,
      high: 2,
      medium: 2,
      low: 2,
      total: 7,
      truncated: false,
    });
  });

  it('stops after a single request when there is no Link next header', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(mockResponse(200, [levelAlert('low')]));

    await fetchCodeScanningAlerts('octo', 'a', 'tok');

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('does not follow an off-origin Link next URL (no PAT leak to a forged host)', async () => {
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(
        mockResponse(
          200,
          [levelAlert('high')],
          '<https://evil.example.com/code-scanning/alerts?page=2>; rel="next"',
        ),
      )
      .mockResolvedValueOnce(mockResponse(200, [levelAlert('critical')]));

    const summary = await fetchCodeScanningAlerts('octo', 'a', 'ghp_secret');

    // Pagination must stop at the on-origin first page.
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    for (const call of vi.mocked(globalThis.fetch).mock.calls) {
      expect(String(call[0])).not.toContain('evil.example.com');
    }
    expect(summary.high).toBe(1);
    expect(summary.critical).toBe(0);
  });

  it('caps pagination at MAX_ALERT_PAGES to avoid a pathological loop', async () => {
    // Every page advertises another on-origin next page; only the cap stops it.
    vi.mocked(globalThis.fetch).mockResolvedValue(
      mockResponse(
        200,
        [levelAlert('low')],
        '<https://api.github.com/repositories/1/code-scanning/alerts?state=open&per_page=100&page=99>; rel="next"',
      ),
    );

    const summary = await fetchCodeScanningAlerts('octo', 'a', 'tok');

    expect(globalThis.fetch).toHaveBeenCalledTimes(MAX_ALERT_PAGES);
    expect(summary.low).toBe(MAX_ALERT_PAGES);
    // The same-origin `Link` chain was still advertising another page when the
    // cap stopped the loop, so the tally is partial, not complete (issue #77).
    expect(summary.truncated).toBe(true);
  });

  it('throws an access-denied GitHubApiError on 403 (surfaces as "no access")', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(mockResponse(403, { message: 'forbidden' }));

    await expect(fetchCodeScanningAlerts('octo', 'a', 'tok')).rejects.toMatchObject({
      status: 403,
      code: GitHubErrorCode.ACCESS_DENIED,
    });
  });

  it('throws a not-found GitHubApiError on 404 (feature disabled)', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(mockResponse(404, { message: 'nope' }));

    await expect(fetchCodeScanningAlerts('octo', 'a', 'tok')).rejects.toBeInstanceOf(
      GitHubApiError,
    );
  });
});

describe('fetchDependabotAlerts', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('summarizes a single page of open alerts by severity', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      mockResponse(200, [advisoryAlert('critical'), advisoryAlert('medium')]),
    );

    const summary = await fetchDependabotAlerts('octo', 'a', 'tok');

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(summary).toEqual({
      critical: 1,
      high: 0,
      medium: 1,
      low: 0,
      total: 2,
      truncated: false,
    });
  });

  it('follows Link rel="next" and counts alerts across every page (>100)', async () => {
    const page1 = Array.from({ length: 100 }, () => advisoryAlert('high'));
    const page2 = Array.from({ length: 30 }, () => advisoryAlert('critical'));

    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(mockResponse(200, page1, NEXT_PAGE_2))
      .mockResolvedValueOnce(mockResponse(200, page2));

    const summary = await fetchDependabotAlerts('octo', 'a', 'tok');

    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(summary.high).toBe(100);
    expect(summary.critical).toBe(30);
    expect(summary.total).toBe(130);
  });

  it('caps pagination at MAX_ALERT_PAGES to avoid a pathological loop', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      mockResponse(
        200,
        [advisoryAlert('low')],
        '<https://api.github.com/repositories/1/dependabot/alerts?state=open&per_page=100&page=99>; rel="next"',
      ),
    );

    const summary = await fetchDependabotAlerts('octo', 'a', 'tok');

    expect(globalThis.fetch).toHaveBeenCalledTimes(MAX_ALERT_PAGES);
    expect(summary.total).toBe(MAX_ALERT_PAGES);
    expect(summary.truncated).toBe(true);
  });
});

// ──────────────────────────────────────────────
// Page-1 conditional caching — issue #78
// ──────────────────────────────────────────────

describe('alert feeds — page-1 conditional caching (#78)', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('sends no If-None-Match on a cold cache and stores page 1\u2019s ETag', async () => {
    const cache = new ETagCache();
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      mockResponse(200, [levelAlert('high')], undefined, 'W/"v1"'),
    );

    const summary = await fetchCodeScanningAlerts('octo', 'cs', 'tok', undefined, cache);

    expect(summary).toEqual({
      critical: 0,
      high: 1,
      medium: 0,
      low: 0,
      total: 1,
      truncated: false,
    });
    const headers = (vi.mocked(globalThis.fetch).mock.calls[0][1] as RequestInit).headers as Record<
      string,
      string
    >;
    expect(headers['If-None-Match']).toBeUndefined();
  });

  it('replays the stored validator and short-circuits to the cached count on 304', async () => {
    const cache = new ETagCache();
    // First refresh: a 200 on page 1 caches both the ETag and the summary.
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      mockResponse(200, [levelAlert('critical'), levelAlert('high')], undefined, 'W/"v1"'),
    );
    const first = await fetchCodeScanningAlerts('octo', 'cs', 'tok', undefined, cache);
    expect(first).toEqual({ critical: 1, high: 1, medium: 0, low: 0, total: 2, truncated: false });

    // Second refresh: the head of the feed is unchanged, so the server answers
    // 304 and the cached summary is reused without re-reading the body.
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(mockResponse(304, null, undefined, 'W/"v1"'));
    const second = await fetchCodeScanningAlerts('octo', 'cs', 'tok', undefined, cache);

    expect(second).toEqual(first);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    const conditionalHeaders = (vi.mocked(globalThis.fetch).mock.calls[1][1] as RequestInit)
      .headers as Record<string, string>;
    expect(conditionalHeaders['If-None-Match']).toBe('W/"v1"');
  });

  it('skips re-paginating later pages when page 1 is a 304', async () => {
    const cache = new ETagCache();
    const page1 = Array.from({ length: 100 }, () => levelAlert('high'));
    const page2 = Array.from({ length: 5 }, () => levelAlert('critical'));
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(mockResponse(200, page1, NEXT_PAGE_2, 'W/"v1"'))
      .mockResolvedValueOnce(mockResponse(200, page2));
    const first = await fetchCodeScanningAlerts('octo', 'cs', 'tok', undefined, cache);
    expect(first.high).toBe(100);
    expect(first.critical).toBe(5);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);

    // A 304 on page 1 returns the full cached summary with exactly ONE request —
    // no page-2 re-fetch — proving the short-circuit skips re-pagination.
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(mockResponse(304, null, undefined, 'W/"v1"'));
    const second = await fetchCodeScanningAlerts('octo', 'cs', 'tok', undefined, cache);

    expect(second).toEqual(first);
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
  });

  it('re-paginates and refreshes the cache when page 1 changed (200, new ETag)', async () => {
    const cache = new ETagCache();
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      mockResponse(200, [levelAlert('high')], undefined, 'W/"v1"'),
    );
    await fetchCodeScanningAlerts('octo', 'cs', 'tok', undefined, cache);

    // The head changed: a 200 (not 304) with a new ETag re-counts and re-caches.
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      mockResponse(200, [levelAlert('critical'), levelAlert('critical')], undefined, 'W/"v2"'),
    );
    const refreshed = await fetchCodeScanningAlerts('octo', 'cs', 'tok', undefined, cache);
    expect(refreshed).toEqual({
      critical: 2,
      high: 0,
      medium: 0,
      low: 0,
      total: 2,
      truncated: false,
    });

    // A third refresh now conditionalizes on the *new* validator.
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(mockResponse(304, null, undefined, 'W/"v2"'));
    const cached = await fetchCodeScanningAlerts('octo', 'cs', 'tok', undefined, cache);
    expect(cached).toEqual(refreshed);
  });

  it('isolates caches per feed/instance so distinct URLs never collide', async () => {
    const cache = new ETagCache();
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      mockResponse(200, [advisoryAlert('critical')], undefined, 'W/"dep"'),
    );
    const dep = await fetchDependabotAlerts('octo', 'cs', 'tok', undefined, cache);
    expect(dep.critical).toBe(1);

    // Same repo, different feed/URL → no 304 reuse; a fresh 200 is counted.
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      mockResponse(200, [levelAlert('low')], undefined, 'W/"cs"'),
    );
    const cs = await fetchCodeScanningAlerts('octo', 'cs', 'tok', undefined, cache);
    expect(cs.low).toBe(1);
    expect(cs.critical).toBe(0);
  });
});

// ──────────────────────────────────────────────
// Origin-assert symmetry — issue #66
// ──────────────────────────────────────────────

describe('assertGitHubApiOrigin (#66)', () => {
  it('accepts a GitHub API origin URL', () => {
    expect(() =>
      assertGitHubApiOrigin('https://api.github.com/repos/octo/a/dependabot/alerts'),
    ).not.toThrow();
  });

  it('refuses an off-origin URL so the PAT/ETag never leak to a forged host', () => {
    expect(() => assertGitHubApiOrigin('https://evil.example.com/dependabot/alerts')).toThrow(
      /origin/i,
    );
  });

  it('refuses an unparseable URL', () => {
    expect(() => assertGitHubApiOrigin('not-a-valid-url')).toThrow();
  });
});
