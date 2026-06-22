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
  fetchCommitActivityWeeks,
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
      rows: [],
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
      rows: [],
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
      rows: [],
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
      rows: [],
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
    expect(first).toEqual({
      critical: 1,
      high: 1,
      medium: 0,
      low: 0,
      total: 2,
      truncated: false,
      rows: [],
    });

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
      rows: [],
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
// Reopened/un-dismissed alert re-entering on page ≥2 — issue #78 follow-up
//
// GitHub preserves an alert's original `created_at` when it is reopened, and
// these feeds pin neither sort nor direction (so they inherit the API default
// `sort=created&direction=desc`). On a feed with >100 open alerts a reopened
// alert re-enters at its OLD created position on page ≥2 and leaves page 1
// byte-identical, so the page-1 `If-None-Match` yields `304`, the stale cached
// summary is served, and pages 2..N — including the reopened (possibly
// critical) alert — are skipped: a silent UNDER-report in the unsafe direction.
//
// Requesting `sort=updated&direction=desc` makes any new/reopened alert (whose
// `updated_at` is "now") sort to the TOP of page 1, changing page 1's body/ETag
// → `200` → full re-pagination → correct count.
// ──────────────────────────────────────────────

describe('alert feeds — reopened alert re-entering on page ≥2 (#78 follow-up)', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  /**
   * A stateful fake GitHub alert feed of >100 OPEN alerts (so page ≥2 exists)
   * with one CRITICAL alert that gets reopened. The reopen keeps the alert's
   * OLD `created_at` (so under `sort=created` it stays on page 2 and page 1 is
   * byte-identical → 304) but sets `updated_at` to "now" (so under
   * `sort=updated` it jumps to the head of page 1 → page 1 changes → 200 →
   * re-pagination). The page-1 ETag therefore only changes once the reopened
   * alert sorts to its head, which happens exclusively under `sort=updated`.
   */
  function makeReopenServer(makeAlert: (severity: string) => Record<string, unknown>) {
    let reopened = false;
    const ETAG_BEFORE = 'W/"page1-v1"';
    const ETAG_AFTER = 'W/"page1-v2"';
    const highs = (n: number) => Array.from({ length: n }, () => makeAlert('high'));
    const mediums = (n: number) => Array.from({ length: n }, () => makeAlert('medium'));
    const reopenedCritical = makeAlert('critical');

    const impl = (
      input: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1],
    ): Promise<Response> => {
      const url = new URL(String(input));
      const sortByUpdated =
        url.searchParams.get('sort') === 'updated' && url.searchParams.get('direction') === 'desc';
      const page = Number(url.searchParams.get('page') ?? '1');
      const ifNoneMatch = (init?.headers as Record<string, string> | undefined)?.['If-None-Match'];

      if (page <= 1) {
        const etag = reopened && sortByUpdated ? ETAG_AFTER : ETAG_BEFORE;
        if (ifNoneMatch && ifNoneMatch === etag) {
          return Promise.resolve(mockResponse(304, null, undefined, etag));
        }
        // Mirror the request's query (incl. sort/direction) onto the next link
        // so the followed page-2 URL stays faithful to the chosen sort regime.
        const next = new URL(url);
        next.searchParams.set('page', '2');
        const link = `<${next.toString()}>; rel="next"`;
        const body = reopened && sortByUpdated ? [reopenedCritical, ...highs(99)] : highs(100);
        return Promise.resolve(mockResponse(200, body, link, etag));
      }

      // Page 2 (last page): the reopened critical lives here under `sort=created`
      // (old created position) and is displaced to page 1 under `sort=updated`.
      const body = reopened
        ? sortByUpdated
          ? [...highs(1), ...mediums(10)]
          : [...mediums(10), reopenedCritical]
        : mediums(10);
      return Promise.resolve(mockResponse(200, body));
    };

    return {
      install: () => vi.mocked(globalThis.fetch).mockImplementation(impl),
      reopen: () => {
        reopened = true;
      },
    };
  }

  it('code-scanning: counts a reopened critical re-entering on page ≥2 (no stale 304 under-report)', async () => {
    const cache = new ETagCache();
    const server = makeReopenServer(levelAlert);
    server.install();

    // Seed the page-1 ETag + full tally from a complete two-page read.
    const seeded = await fetchCodeScanningAlerts('octo', 'cs', 'tok', undefined, cache);
    expect(seeded.critical).toBe(0);
    expect(seeded.total).toBe(110);

    // A previously dismissed CRITICAL alert is reopened. Its created_at is old
    // (page ≥2), so page 1's bytes are unchanged under the default `sort=created`
    // → 304. Only `sort=updated` floats it to page 1's head and forces a recount.
    server.reopen();
    const refreshed = await fetchCodeScanningAlerts('octo', 'cs', 'tok', undefined, cache);

    // The reopened critical MUST be counted — a 304 short-circuit hides it and
    // silently under-grades the repo (worst-severity F shown as the stale C).
    expect(refreshed.critical).toBe(1);
    expect(refreshed.total).toBe(111);

    // Regression guard: the conditional read must pin sort=updated&direction=desc
    // so a future revert to `created`/unsorted re-breaks this test.
    const firstUrl = String(vi.mocked(globalThis.fetch).mock.calls[0][0]);
    expect(firstUrl).toContain('sort=updated');
    expect(firstUrl).toContain('direction=desc');
  });

  it('dependabot: counts a reopened critical re-entering on page ≥2 (no stale 304 under-report)', async () => {
    const cache = new ETagCache();
    const server = makeReopenServer(advisoryAlert);
    server.install();

    const seeded = await fetchDependabotAlerts('octo', 'dep', 'tok', undefined, cache);
    expect(seeded.critical).toBe(0);
    expect(seeded.total).toBe(110);

    server.reopen();
    const refreshed = await fetchDependabotAlerts('octo', 'dep', 'tok', undefined, cache);

    expect(refreshed.critical).toBe(1);
    expect(refreshed.total).toBe(111);

    const firstUrl = String(vi.mocked(globalThis.fetch).mock.calls[0][0]);
    expect(firstUrl).toContain('sort=updated');
    expect(firstUrl).toContain('direction=desc');
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

// ──────────────────────────────────────────────
// Per-alert identity rows + 304 replay — INBOX-2B (issue #216, DESIGN-INBOX §1.4)
//
// The Notifications Inbox derives one item per OPEN alert, so each feed must
// expose per-alert identity ({number, type, severity, html_url, created_at}),
// not just severity counts. Security is the one signal that bypasses
// `fetchWithETag`, so `readAlertFeed`'s bespoke cache must persist those rows
// alongside the summary and REPLAY them on a 304 — otherwise the app's
// steady-state 304 refreshes (useRepoSignals) would skip the per-alert loop and
// emit zero security items, so the inbox would flicker every cycle. Replaying
// the cached rows re-uses more of the already-fetched 200 body — ZERO new
// requests (no new endpoint, page, or permission). Mirrors how `fetchWithETag`
// replays the full body on a 304 (etag-cache.ts).
// ──────────────────────────────────────────────

describe('alert feeds — per-alert identity rows + 304 replay (INBOX-2B #216)', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  /** A fully-identified code-scanning alert (number + deep link + created_at). */
  function csFullAlert(
    number: number,
    level: string,
    html_url: string,
    created_at: string,
  ): Record<string, unknown> {
    return { number, html_url, created_at, rule: { security_severity_level: level } };
  }

  /** A fully-identified Dependabot alert (number + deep link + created_at). */
  function depFullAlert(
    number: number,
    severity: string,
    html_url: string,
    created_at: string,
  ): Record<string, unknown> {
    return { number, html_url, created_at, security_advisory: { severity } };
  }

  it('exposes per-alert identity rows derived from the already-fetched 200 body (AC-4)', async () => {
    const cache = new ETagCache();
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      mockResponse(
        200,
        [
          csFullAlert(
            7,
            'critical',
            'https://github.com/octo/cs/security/code-scanning/7',
            '2026-02-01T00:00:00Z',
          ),
          csFullAlert(
            8,
            'medium',
            'https://github.com/octo/cs/security/code-scanning/8',
            '2026-02-02T00:00:00Z',
          ),
        ],
        undefined,
        'W/"v1"',
      ),
    );

    const feed = await fetchCodeScanningAlerts('octo', 'cs', 'tok', undefined, cache);

    // Counts are unchanged (back-compat); the rows carry the inbox identity.
    expect(feed.total).toBe(2);
    expect(feed.rows).toEqual([
      {
        number: 7,
        type: 'code-scanning',
        severity: 'critical',
        html_url: 'https://github.com/octo/cs/security/code-scanning/7',
        created_at: '2026-02-01T00:00:00Z',
      },
      {
        number: 8,
        type: 'code-scanning',
        severity: 'medium',
        html_url: 'https://github.com/octo/cs/security/code-scanning/8',
        created_at: '2026-02-02T00:00:00Z',
      },
    ]);
  });

  it('tags Dependabot rows with type "dependabot" and advisory severity (AC-4)', async () => {
    const cache = new ETagCache();
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      mockResponse(
        200,
        [
          depFullAlert(
            3,
            'high',
            'https://github.com/octo/dep/security/dependabot/3',
            '2026-03-01T00:00:00Z',
          ),
        ],
        undefined,
        'W/"v1"',
      ),
    );

    const feed = await fetchDependabotAlerts('octo', 'dep', 'tok', undefined, cache);

    expect(feed.rows).toEqual([
      {
        number: 3,
        type: 'dependabot',
        severity: 'high',
        html_url: 'https://github.com/octo/dep/security/dependabot/3',
        created_at: '2026-03-01T00:00:00Z',
      },
    ]);
  });

  it('replays byte-identical code-scanning rows across a 200→304 refresh (AC-17)', async () => {
    const cache = new ETagCache();
    const alerts = [
      csFullAlert(
        7,
        'critical',
        'https://github.com/octo/cs/security/code-scanning/7',
        '2026-02-01T00:00:00Z',
      ),
      csFullAlert(
        8,
        'medium',
        'https://github.com/octo/cs/security/code-scanning/8',
        '2026-02-02T00:00:00Z',
      ),
    ];
    // 200: rows are retained from the parsed body and the page-1 ETag is cached.
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      mockResponse(200, alerts, undefined, 'W/"v1"'),
    );
    const first = await fetchCodeScanningAlerts('octo', 'cs', 'tok', undefined, cache);
    expect(first.rows).toHaveLength(2);

    // 304: the head is unchanged, the body is NOT re-read — rows come from cache.
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(mockResponse(304, null, undefined, 'W/"v1"'));
    const second = await fetchCodeScanningAlerts('octo', 'cs', 'tok', undefined, cache);

    // CRUX (AC-17): identical per-alert identity — same ids, same order — so the
    // derived security items are byte-identical across the 200→304 transition.
    expect(second.rows).toEqual(first.rows);
    // AC-5: the 304 added zero requests — no new endpoint, page, or permission.
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    const conditionalHeaders = (vi.mocked(globalThis.fetch).mock.calls[1][1] as RequestInit)
      .headers as Record<string, string>;
    expect(conditionalHeaders['If-None-Match']).toBe('W/"v1"');
  });

  it('replays byte-identical Dependabot rows across a 200→304 refresh (AC-17)', async () => {
    const cache = new ETagCache();
    const alerts = [
      depFullAlert(
        3,
        'high',
        'https://github.com/octo/dep/security/dependabot/3',
        '2026-03-01T00:00:00Z',
      ),
      depFullAlert(
        5,
        'low',
        'https://github.com/octo/dep/security/dependabot/5',
        '2026-03-02T00:00:00Z',
      ),
    ];
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      mockResponse(200, alerts, undefined, 'W/"dep1"'),
    );
    const first = await fetchDependabotAlerts('octo', 'dep', 'tok', undefined, cache);
    expect(first.rows.map((row) => row.number)).toEqual([3, 5]);

    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      mockResponse(304, null, undefined, 'W/"dep1"'),
    );
    const second = await fetchDependabotAlerts('octo', 'dep', 'tok', undefined, cache);

    expect(second.rows).toEqual(first.rows);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it('never seeds a 304 from a truncated read, so stale rows can never be replayed (AC-5/AC-17)', async () => {
    const cache = new ETagCache();
    // Every page advertises another on-origin next page; only the cap stops it,
    // so the tally is partial. A partial read must NOT be cached (no validator
    // stored), so a later refresh cannot answer 304 with stale rows.
    vi.mocked(globalThis.fetch).mockResolvedValue(
      mockResponse(
        200,
        [
          csFullAlert(
            1,
            'low',
            'https://github.com/octo/cs/security/code-scanning/1',
            '2026-02-01T00:00:00Z',
          ),
        ],
        '<https://api.github.com/repositories/1/code-scanning/alerts?state=open&per_page=100&page=99>; rel="next"',
        'W/"v1"',
      ),
    );
    const first = await fetchCodeScanningAlerts('octo', 'cs', 'tok', undefined, cache);
    expect(first.truncated).toBe(true);

    // A follow-up refresh must carry NO `If-None-Match` (nothing was cached), so
    // the server cannot 304 and rows are always re-derived from a fresh body.
    vi.mocked(globalThis.fetch).mockClear();
    await fetchCodeScanningAlerts('octo', 'cs', 'tok', undefined, cache);
    const headers = (vi.mocked(globalThis.fetch).mock.calls[0][1] as RequestInit).headers as Record<
      string,
      string
    >;
    expect(headers['If-None-Match']).toBeUndefined();
  });
});

describe('alert feeds — diagnostics (#234, #235)', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('throws an explicit cold-cache diagnostic on a 304 with no cached feed (#234)', async () => {
    // A 304 with a fresh cache is a protocol violation (no If-None-Match was
    // sent), so it must surface a specific message — not the generic
    // "GitHub API error (304)" the `!ok` fallthrough would otherwise throw.
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(mockResponse(304, null, undefined, 'W/"v1"'));

    await expect(
      fetchCodeScanningAlerts('octo', 'cs', 'tok', undefined, new ETagCache()),
    ).rejects.toThrow(/304 Not Modified but no cached/i);
  });

  it('debug-logs a Dependabot alert skipped from inbox rows for missing identity (#235)', async () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    // A counted alert lacking number/html_url/created_at yields no inbox row.
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      mockResponse(200, [advisoryAlert('critical')], undefined, 'W/"v1"'),
    );

    const feed = await fetchDependabotAlerts('octo', 'dep', 'tok', undefined, new ETagCache());

    expect(feed.total).toBe(1); // still counted in the tally
    expect(feed.rows).toEqual([]); // but produced no inbox row
    expect(debug).toHaveBeenCalled(); // and the skip was announced
    expect(debug.mock.calls[0]?.[0]).toMatch(/skipped dependabot alert/i);
  });

  it('debug-logs a code-scanning alert skipped from inbox rows for missing identity (#235)', async () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      mockResponse(200, [levelAlert('high')], undefined, 'W/"v1"'),
    );

    const feed = await fetchCodeScanningAlerts('octo', 'cs', 'tok', undefined, new ETagCache());

    expect(feed.total).toBe(1);
    expect(feed.rows).toEqual([]);
    expect(debug).toHaveBeenCalled();
    expect(debug.mock.calls[0]?.[0]).toMatch(/skipped code-scanning alert/i);
  });
});

/**
 * `fetchCommitActivityWeeks` is the aggregate weekly-stats reader colocated with
 * the other security-branches fetchers. github-api.test.ts and
 * network-graph-api.test.ts do not exercise it, so this suite covers the 202
 * (computing), 204 (empty), success and error paths.
 */
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
    vi.mocked(globalThis.fetch).mockResolvedValue(mockResponse(202, ''));

    const result = await fetchCommitActivityWeeks('owner', 'repo', 'ghp_test');
    expect(result).toBeNull();
  });

  it('returns an empty array for an empty repository (204)', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(mockResponse(204, ''));

    const result = await fetchCommitActivityWeeks('owner', 'repo', 'ghp_test');
    expect(result).toEqual([]);
  });

  it('returns the parsed weekly activity on success', async () => {
    const weeks = [
      { total: 5, week: 1700000000, days: [0, 1, 2, 0, 1, 1, 0] },
      { total: 0, week: 1700604800, days: [0, 0, 0, 0, 0, 0, 0] },
    ];
    vi.mocked(globalThis.fetch).mockResolvedValue(mockResponse(200, weeks));

    const result = await fetchCommitActivityWeeks('owner', 'repo', 'ghp_test');
    expect(result).toHaveLength(2);
    expect(result?.[0].total).toBe(5);
    expect(result?.[0].days).toHaveLength(7);
  });

  it('works without a token for a public repository', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(mockResponse(204, ''));

    const result = await fetchCommitActivityWeeks('owner', 'repo');
    expect(result).toEqual([]);
  });

  it('throws a GitHubApiError on API failure', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(mockResponse(500, { message: 'server error' }));

    await expect(fetchCommitActivityWeeks('owner', 'repo', 'ghp_test')).rejects.toThrow(
      GitHubApiError,
    );
  });
});
