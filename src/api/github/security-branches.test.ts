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
  fetchCodeScanningAlerts,
  fetchDependabotAlerts,
} from './security-branches';
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

/** Builds a fake `Response`; pass `link` to advertise a `rel="next"` page. */
function mockResponse(status: number, body: unknown, link?: string): Response {
  const headers = mockHeaders(link ? { link } : {});
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
    expect(summary).toEqual({ critical: 1, high: 2, medium: 0, low: 0, total: 3 });
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

    expect(summary).toEqual({ critical: 1, high: 2, medium: 2, low: 2, total: 7 });
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
    expect(summary).toEqual({ critical: 1, high: 0, medium: 1, low: 0, total: 2 });
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
  });
});
