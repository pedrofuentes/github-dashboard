/**
 * Security alerts, branch operations, and commit activity functions.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */

import { z } from 'zod';

import {
  GITHUB_API_BASE,
  GitHubApiError,
  GitHubErrorCode,
  buildHeaders,
  fetchWithRetry,
  handleApiError,
  parseRateLimitHeaders,
  parseRetryAfter,
} from './core';
import { ETagCache } from './etag-cache';
import {
  DependabotAlertSchema,
  BranchComparisonResponseSchema,
  BranchListItemSchema,
  CommitActivityWeekSchema,
  CommitListItemSchema,
  TagListItemSchema,
} from './schemas';
import type { CommitActivityWeek } from './commit-activity';
import type { SecurityAlertRow } from '../../types/fleet';

// ─── Security Alert APIs ────────────────────────────────────────────

/** Dependabot alert severity levels */
export type AlertSeverity = 'critical' | 'high' | 'medium' | 'low';

/** Summary of security alerts for a repository */
export interface SecurityAlertSummary {
  critical: number;
  high: number;
  medium: number;
  low: number;
  total: number;
  /**
   * `true` when pagination stopped at {@link MAX_ALERT_PAGES} while the feed
   * still advertised another page — the counts are a **lower bound**, not a
   * complete tally, so callers can flag the grade as partial (issue #77).
   */
  truncated: boolean;
}

/**
 * A fully-read alert feed: the severity {@link SecurityAlertSummary} widened
 * with the per-alert {@link SecurityAlertRow} identities retained from the SAME
 * 200 body. Persisting the rows in the bespoke conditional cache lets a later
 * 304 replay them byte-identically (mirroring how `fetchWithETag` replays the
 * full body), so the derived inbox items stay stable across a refresh instead
 * of vanishing when the per-alert loop is skipped on a cache hit (INBOX-2B,
 * issue #216). It re-uses already-fetched data — it adds ZERO new requests.
 */
export interface SecurityAlertFeed extends SecurityAlertSummary {
  /** One row per counted open alert, in feed (page) order. */
  rows: SecurityAlertRow[];
}

/**
 * Hard ceiling on the number of alert pages followed per feed. At 100 alerts a
 * page this covers 5,000 open alerts — far beyond any healthy repo — while
 * guaranteeing pagination terminates even if a forged/looping `Link` header
 * keeps advertising another on-origin "next" page (issue #63).
 */
export const MAX_ALERT_PAGES = 50;

/** The single origin (`https://api.github.com`) every alert request may target. */
const GITHUB_API_ORIGIN = new URL(GITHUB_API_BASE).origin;

/**
 * Asserts that `url` is on the GitHub API origin before it is fetched with the
 * user's PAT — and, for page 1, an `If-None-Match` validator — attached.
 *
 * Defense-in-depth symmetry with the ETag path (issue #66): the conditional
 * caching layer in `etag-cache.ts` guards every request this way, and the alert
 * feeds follow attacker-influenced `Link: rel="next"` URLs, so each page must be
 * proven on-origin before the token/ETag is sent. {@link parseNextPageUrl}
 * already drops off-origin "next" links; this is the belt to that suspenders and
 * additionally guards the initial page-1 URL.
 *
 * @throws {Error} when `url` is unparseable or not on the GitHub API origin
 */
export function assertGitHubApiOrigin(url: string): void {
  let origin: string;
  try {
    origin = new URL(url).origin;
  } catch {
    throw new Error(`assertGitHubApiOrigin: invalid request URL "${url}"`);
  }
  if (origin !== GITHUB_API_ORIGIN) {
    throw new Error(
      `assertGitHubApiOrigin: refusing to send a request to non-GitHub origin "${origin}"`,
    );
  }
}

/**
 * Process-local cache used by the alert feeds when a caller does not inject its
 * own. Keyed by the page-1 URL, it stores the last fully-read
 * {@link SecurityAlertFeed} (severity counts **and** per-alert rows) plus the
 * page-1 `ETag` so a subsequent refresh can replay the validator and, on a
 * `304`, replay the whole feed — counts and rows — without re-paginating
 * (issues #78, #216).
 */
const defaultAlertCache = new ETagCache();

/**
 * Parses the GitHub `Link` header to extract the URL for the next page.
 * Returns null when there is no next page.
 *
 * Security: the returned URL is followed with the user's PAT attached, so a
 * forged or MITM'd `Link` header must never redirect that PAT off-origin. Only
 * URLs on the GitHub API origin are accepted; anything else (or an unparseable
 * value) is treated as "no next page" so pagination simply stops.
 */
function parseNextPageUrl(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
  if (!match) return null;

  const next = match[1];
  try {
    if (new URL(next).origin !== new URL(GITHUB_API_BASE).origin) {
      return null;
    }
  } catch {
    return null;
  }
  return next;
}

/**
 * Outcome of a (possibly conditional) alert-feed read.
 *
 * Either the feed's first page was unchanged since the last successful read — so
 * the previously read feed (counts + per-alert rows) is served straight from
 * cache without re-paginating (`hit: true`, issues #78, #216) — or every page
 * was (re)read and the raw rows are returned for the caller to tally with its
 * feed-specific severity rules, along with a {@link AlertFeedFresh.commit} hook
 * that persists the resulting feed for the next conditional read.
 */
type AlertFeedRead<T> = { hit: true; feed: SecurityAlertFeed } | AlertFeedFresh<T>;

interface AlertFeedFresh<T> {
  hit: false;
  /** Concatenated raw rows across page 1 plus any `Link: rel="next"` pages. */
  items: T[];
  /** `true` when {@link MAX_ALERT_PAGES} stopped pagination with pages remaining. */
  truncated: boolean;
  /**
   * Persists `feed` (counts + per-alert rows) as the cached answer for the next
   * conditional read, keyed by the page-1 URL and tagged with page 1's `ETag`.
   * A no-op when the read was truncated — a lower-bound feed must never be
   * replayed as a `304` "unchanged" answer (issues #77, #78, #216).
   */
  commit: (feed: SecurityAlertFeed) => void;
}

/**
 * Reads an alert feed with page-1 conditional caching, following
 * `Link: rel="next"` until the feed is exhausted or {@link MAX_ALERT_PAGES} is
 * reached. A single `per_page=100` request silently undercounts any repo with
 * more than 100 open alerts, so every page is enumerated before grading (issues
 * #63, #77).
 *
 * Conditional caching (issue #78): the feed is requested
 * `sort=updated&direction=desc` and page 1 carries an `If-None-Match` built from
 * the previously stored `ETag`. Sorting by `updated` is what makes the page-1
 * short-circuit sound: ANY change to the open set — a brand-new alert or a
 * **reopened/un-dismissed** one — bumps that alert's `updated_at` to now (GitHub
 * preserves the original `created_at` on reopen) and floats it to the head of
 * page 1, changing page 1's bytes/`ETag` so the server returns `200` and every
 * page is re-counted. A `304 Not Modified` therefore means page 1 is
 * byte-identical AND, because the newest `updated_at` has not advanced, nothing
 * entered the open set since last time — so the cached summary is reused
 * verbatim and pages 2..N are not re-fetched, restoring the 304 rate-limit
 * savings that #76 lost when code-scanning moved off the ETag path to read
 * `Link` headers.
 *
 * Why `updated` and not `created` (the API default): a reopened alert keeps its
 * old `created_at`, so under `created` it re-enters on page ≥2 and leaves a
 * multi-page feed's page 1 unchanged → `304` → its (possibly **critical**) count
 * is silently dropped — an UNDER-report in the unsafe direction. Under `updated`
 * the only remaining 304 case is an alert dismissed/fixed off page ≥2 that
 * leaves page 1's 100 items unchanged: that yields a transient **over**-count
 * until page 1 next changes — the grade errs toward "needs attention" and never
 * hides a problem. Truncated reads are never cached, so a lower-bound tally can
 * never be served as an "unchanged" 304.
 *
 * Every page URL — including attacker-influenceable `Link` targets — is passed
 * through {@link assertGitHubApiOrigin} before the PAT/ETag is attached (issue
 * #66).
 */
async function readAlertFeed<T>(
  initialUrl: string,
  schema: z.ZodType<T[]>,
  token: string,
  context: string,
  owner: string,
  repo: string,
  cache: ETagCache,
  signal?: AbortSignal,
): Promise<AlertFeedRead<T>> {
  const headers = buildHeaders(token);
  const cached = cache.get<SecurityAlertFeed>(initialUrl);

  // Page 1 is conditional: replay the stored validator so an unchanged feed head
  // answers 304 and reuses the cached tally without re-paginating (issue #78).
  const firstHeaders: Record<string, string> = { ...headers };
  if (cached?.etag) {
    firstHeaders['If-None-Match'] = cached.etag;
  }

  assertGitHubApiOrigin(initialUrl);
  const first = await fetchWithRetry(initialUrl, { headers: firstHeaders, signal }, context);

  // 304 must be checked before `!ok` (a 304 reports `ok === false`). Replay the
  // whole cached feed — counts AND per-alert rows — so the derived inbox items
  // stay byte-identical across the refresh (issue #216).
  if (first.status === 304 && cached) {
    return { hit: true, feed: cached.data };
  }

  // A 304 with no cached feed is a protocol violation: we only send
  // `If-None-Match` when we already hold an ETag, so the server cannot validly
  // answer 304 on a cold cache. Surface it as an explicit cold-cache diagnostic
  // rather than the generic `GitHub API error (304)` the `!ok` path throws (#234).
  if (first.status === 304) {
    throw new GitHubApiError(
      'Received 304 Not Modified but no cached alert feed is available',
      304,
      parseRateLimitHeaders(first.headers),
      undefined,
      GitHubErrorCode.SERVER_ERROR,
    );
  }

  if (!first.ok) {
    handleApiError(
      first.status,
      parseRateLimitHeaders(first.headers),
      owner,
      repo,
      parseRetryAfter(first.headers),
    );
  }

  const pageOneEtag = first.headers.get('etag');
  const items: T[] = [];
  for (const item of schema.parse(await first.json())) items.push(item);

  let url: string | null = parseNextPageUrl(first.headers.get('link'));
  let pagesFetched = 1;
  while (url && pagesFetched < MAX_ALERT_PAGES) {
    assertGitHubApiOrigin(url);
    const response = await fetchWithRetry(url, { headers, signal }, context);

    if (!response.ok) {
      handleApiError(
        response.status,
        parseRateLimitHeaders(response.headers),
        owner,
        repo,
        parseRetryAfter(response.headers),
      );
    }

    for (const item of schema.parse(await response.json())) items.push(item);
    pagesFetched++;
    url = parseNextPageUrl(response.headers.get('link'));
  }

  // A still-non-null `url` means the cap stopped us with pages remaining.
  const truncated = url !== null;
  const commit = (feed: SecurityAlertFeed): void => {
    // Only a complete read may seed a future 304 short-circuit/replay.
    if (feed.truncated) return;
    cache.set<SecurityAlertFeed>(initialUrl, {
      etag: pageOneEtag,
      data: feed,
      storedAt: Date.now(),
    });
  };

  return { hit: false, items, truncated, commit };
}

/** Narrows an arbitrary string to a known {@link AlertSeverity}. */
function isAlertSeverity(value: string): value is AlertSeverity {
  return value === 'critical' || value === 'high' || value === 'medium' || value === 'low';
}

/**
 * Builds the per-alert identity {@link SecurityAlertRow} the Notifications Inbox
 * addresses an item with, or `null` when the alert lacks a field the inbox
 * needs (its `number`, `html_url` deep link, or `created_at`). Skipping
 * incomplete alerts keeps the retained rows in lock-step with the tally and
 * means a minimal/legacy alert shape degrades to "no inbox row", never a crash.
 */
function buildAlertRow(
  type: 'dependabot' | 'code-scanning',
  severity: AlertSeverity,
  alert: { number?: number | null; html_url?: string | null; created_at?: string | null },
): SecurityAlertRow | null {
  const { number, html_url, created_at } = alert;
  if (typeof number !== 'number' || !html_url || !created_at) return null;
  return { number, type, severity, html_url, created_at };
}

/**
 * Builds an alert's inbox identity row and pushes it onto `rows`, or debug-logs
 * the skip when {@link buildAlertRow} returns `null` because the alert lacked an
 * identity field (its `number`, `html_url`, or `created_at`). The alert is still
 * counted in the tally — only its inbox row is dropped — so this surfaces an
 * otherwise-silent divergence between the counts and the retained rows (#235).
 */
function pushAlertRow(
  rows: SecurityAlertRow[],
  type: 'dependabot' | 'code-scanning',
  severity: AlertSeverity,
  alert: { number?: number | null; html_url?: string | null; created_at?: string | null },
): void {
  const row = buildAlertRow(type, severity, alert);
  if (row) {
    rows.push(row);
    return;
  }
  console.debug(
    `[security] skipped ${type} alert from inbox rows: missing identity field (number/html_url/created_at)`,
    { number: alert.number ?? null },
  );
}

/**
 * Fetches open Dependabot alerts across every page and summarizes by severity.
 * Requires `Dependabot alerts: Read` permission.
 *
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param token - GitHub PAT
 * @param signal - Optional signal to cancel the in-flight request
 * @param cache - Conditional-request cache (defaults to a shared instance);
 *   injectable for test isolation
 * @returns Alert summary with counts by severity
 * @throws {GitHubApiError} on API errors
 */
export async function fetchDependabotAlerts(
  owner: string,
  repo: string,
  token: string,
  signal?: AbortSignal,
  cache: ETagCache = defaultAlertCache,
): Promise<SecurityAlertFeed> {
  // sort=updated floats any new OR reopened alert (updated_at = now) to page 1's
  // head, so the page-1 304 short-circuit can never hide it on page ≥2 (#78).
  const initialUrl =
    `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}` +
    `/dependabot/alerts?state=open&per_page=100&sort=updated&direction=desc`;
  const read = await readAlertFeed(
    initialUrl,
    z.array(DependabotAlertSchema),
    token,
    'fetchDependabotAlerts',
    owner,
    repo,
    cache,
    signal,
  );
  if (read.hit) return read.feed;

  const summary: SecurityAlertSummary = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    total: 0,
    truncated: read.truncated,
  };
  const rows: SecurityAlertRow[] = [];
  for (const alert of read.items) {
    const severity = alert.security_advisory?.severity ?? 'low';
    if (
      severity === 'critical' ||
      severity === 'high' ||
      severity === 'medium' ||
      severity === 'low'
    ) {
      summary[severity]++;
    }
    summary.total++;
    // Retain this alert's identity for the inbox; severity falls back to 'low'
    // for the same unrecognized values the counts already bucket out (#216). A
    // skipped row (missing identity) is debug-logged rather than silent (#235).
    pushAlertRow(rows, 'dependabot', isAlertSeverity(severity) ? severity : 'low', alert);
  }
  const feed: SecurityAlertFeed = { ...summary, rows };
  read.commit(feed);
  return feed;
}

/** Code-scanning alert shape we care about: the rule's severity plus identity. */
const CodeScanningAlertSchema = z
  .object({
    // Per-alert identity retained for the Notifications Inbox so a 304 refresh
    // can replay it (INBOX-2B, issue #216). Optional: minimal fixtures and any
    // unexpectedly-shaped alert simply yield no inbox row, never a parse error.
    number: z.number().optional(),
    html_url: z.string().optional(),
    created_at: z.string().optional(),
    rule: z
      .object({
        severity: z.string().nullable().optional(),
        security_severity_level: z.string().nullable().optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
  })
  .passthrough();
type CodeScanningAlert = z.infer<typeof CodeScanningAlertSchema>;

/**
 * Buckets a code-scanning alert by its CVSS `security_severity_level`, falling
 * back to the rule's lint-style `severity` (error→high, warning→medium,
 * note→low). Returns null for anything unrecognized so it is ignored.
 */
function codeScanningSeverity(alert: CodeScanningAlert): AlertSeverity | null {
  const level = alert.rule?.security_severity_level?.toLowerCase();
  if (level === 'critical' || level === 'high' || level === 'medium' || level === 'low') {
    return level;
  }
  switch (alert.rule?.severity?.toLowerCase()) {
    case 'error':
      return 'high';
    case 'warning':
      return 'medium';
    case 'note':
      return 'low';
    default:
      return null;
  }
}

/**
 * Fetches open code-scanning alerts across every page and summarizes by
 * severity. Requires `Code scanning alerts: Read` permission.
 *
 * Mirrors {@link fetchDependabotAlerts}: it follows `Link: rel="next"` so a
 * repo with more than 100 open alerts is fully counted instead of being
 * silently over-graded (issue #63). Following `Link` requires reading the
 * response headers, so this path cannot route through the body-only
 * `fetchWithETag` wrapper; instead it restores conditional-request savings with
 * a page-1 `If-None-Match` short-circuit (issue #78 — see
 * {@link readAlertFeed}).
 *
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param token - GitHub PAT
 * @param signal - Optional signal to cancel the in-flight request
 * @param cache - Conditional-request cache (defaults to a shared instance);
 *   injectable for test isolation
 * @returns Alert summary with counts by severity
 * @throws {GitHubApiError} on API errors
 */
export async function fetchCodeScanningAlerts(
  owner: string,
  repo: string,
  token: string,
  signal?: AbortSignal,
  cache: ETagCache = defaultAlertCache,
): Promise<SecurityAlertFeed> {
  // sort=updated floats any new OR reopened alert (updated_at = now) to page 1's
  // head, so the page-1 304 short-circuit can never hide it on page ≥2 (#78).
  const initialUrl =
    `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}` +
    `/code-scanning/alerts?state=open&per_page=100&sort=updated&direction=desc`;
  const read = await readAlertFeed(
    initialUrl,
    z.array(CodeScanningAlertSchema),
    token,
    'fetchCodeScanningAlerts',
    owner,
    repo,
    cache,
    signal,
  );
  if (read.hit) return read.feed;

  const summary: SecurityAlertSummary = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    total: 0,
    truncated: read.truncated,
  };
  const rows: SecurityAlertRow[] = [];
  for (const alert of read.items) {
    const severity = codeScanningSeverity(alert);
    if (severity) {
      summary[severity]++;
      summary.total++;
      // Retain identity for the inbox only for alerts the tally recognized, so
      // rows and counts stay in lock-step (issue #216). A skipped row (missing
      // identity) is debug-logged rather than dropped silently (#235).
      pushAlertRow(rows, 'code-scanning', severity, alert);
    }
  }
  const feed: SecurityAlertFeed = { ...summary, rows };
  read.commit(feed);
  return feed;
}

// ─── Branch Network API ──────────────────────────────────────

/** Branch comparison data */
export interface BranchComparison {
  ahead_by: number;
  behind_by: number;
  total_commits: number;
  html_url: string;
  status: 'ahead' | 'behind' | 'diverged' | 'identical';
}

/**
 * Fetches branch comparison (ahead/behind counts) between two branches.
 *
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param base - Base branch (e.g. "main")
 * @param head - Head branch to compare (e.g. "develop")
 * @param token - GitHub personal access token
 * @returns Branch comparison info
 * @throws {GitHubApiError} on API errors
 */
export async function fetchBranchComparison(
  owner: string,
  repo: string,
  base: string,
  head: string,
  token?: string,
): Promise<BranchComparison> {
  const url = `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`;
  const headers = buildHeaders(token);

  const response = await fetchWithRetry(url, { headers }, 'fetchBranchComparison');
  const rateLimitInfo = parseRateLimitHeaders(response.headers);

  if (!response.ok) {
    handleApiError(response.status, rateLimitInfo, owner, repo, parseRetryAfter(response.headers));
  }

  const data = BranchComparisonResponseSchema.parse(await response.json());
  return {
    ahead_by: data.ahead_by,
    behind_by: data.behind_by,
    total_commits: data.total_commits,
    html_url: data.html_url,
    status: (data.status as BranchComparison['status']) ?? 'identical',
  };
}

/** Branch info with latest commit for network visualization */
export interface BranchInfo {
  name: string;
  commitSha: string;
}

/**
 * Fetches branch info for network visualization.
 * Returns the list of branches with their latest commit SHA.
 *
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param token - GitHub personal access token
 * @returns Array of branch info
 * @throws {GitHubApiError} on API errors
 */
export async function fetchBranchNetwork(
  owner: string,
  repo: string,
  token: string,
): Promise<BranchInfo[]> {
  const url = `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches?per_page=100`;
  const headers = buildHeaders(token);

  const response = await fetchWithRetry(url, { headers }, 'fetchBranchNetwork');
  const rateLimitInfo = parseRateLimitHeaders(response.headers);

  if (!response.ok) {
    handleApiError(response.status, rateLimitInfo, owner, repo, parseRetryAfter(response.headers));
  }

  const data = z.array(BranchListItemSchema).parse(await response.json());
  return data.map((b) => ({
    name: b.name,
    commitSha: b.commit.sha,
  }));
}

// ─── Commit Activity API ─────────────────────────────────────

/**
 * Fetches commit activity (weekly commit counts) for a repository.
 * Uses the stats/commit_activity endpoint which returns the last 52 weeks.
 *
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param token - GitHub personal access token
 * @param timeRange - "24h", "7d", or "30d"
 * @returns Commit count for the specified time range
 * @throws {GitHubApiError} on API errors
 */
export async function fetchCommitActivityCount(
  owner: string,
  repo: string,
  token?: string,
  timeRange: '24h' | '7d' | '30d' = '7d',
): Promise<number> {
  const url = `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/stats/commit_activity`;
  const headers = buildHeaders(token);

  const response = await fetchWithRetry(url, { headers }, 'fetchCommitActivityCount');
  const rateLimitInfo = parseRateLimitHeaders(response.headers);

  // Stats endpoints return 202 while computing — treat as "data not ready"
  if (response.status === 202) {
    return -1; // Signal to show "Computing…"
  }

  if (response.status === 204) {
    return 0; // Empty repo — no commits
  }

  if (!response.ok) {
    handleApiError(response.status, rateLimitInfo, owner, repo, parseRetryAfter(response.headers));
  }

  const weeks = z.array(CommitActivityWeekSchema).parse(await response.json());
  if (weeks.length === 0) {
    return 0;
  }

  const now = new Date();
  const nowMs = now.getTime();

  if (timeRange === '24h') {
    // Get today's day index within the most recent week
    const latestWeek = weeks[weeks.length - 1];
    const weekStartMs = latestWeek.week * 1000;
    const dayOfWeek = Math.floor((nowMs - weekStartMs) / 86400000);
    if (dayOfWeek >= 0 && dayOfWeek < 7) {
      return latestWeek.days[dayOfWeek] ?? 0;
    }
    return 0;
  }

  if (timeRange === '7d') {
    // Sum the most recent week
    const latestWeek = weeks[weeks.length - 1];
    return latestWeek.total;
  }

  // 30d — sum the last ~4 weeks
  const weeksToSum = Math.min(4, weeks.length);
  let total = 0;
  for (let i = weeks.length - weeksToSum; i < weeks.length; i++) {
    total += weeks[i].total;
  }
  return total;
}

/**
 * Fetches raw weekly commit activity data for a repository.
 * Returns the full 52-week history with daily breakdowns, suitable for
 * rendering contribution heatmaps.
 *
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param token - GitHub personal access token
 * @returns Array of weekly commit data, or null if still computing
 * @throws {GitHubApiError} on API errors
 */
export async function fetchCommitActivityWeeks(
  owner: string,
  repo: string,
  token?: string,
): Promise<CommitActivityWeek[] | null> {
  const url = `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/stats/commit_activity`;
  const headers = buildHeaders(token);

  const response = await fetchWithRetry(url, { headers }, 'fetchCommitActivityWeeks');
  const rateLimitInfo = parseRateLimitHeaders(response.headers);

  // Stats endpoints return 202 while computing — data not ready yet
  if (response.status === 202) {
    return null;
  }

  if (response.status === 204) {
    return [];
  }

  if (!response.ok) {
    handleApiError(response.status, rateLimitInfo, owner, repo, parseRetryAfter(response.headers));
  }

  const weeks = z.array(CommitActivityWeekSchema).parse(await response.json());
  return weeks;
}

// ─── Network Graph Data APIs ────────────────────────────────────────────

/** Commit data shaped for git-network-graph's RawCommit input */
export interface NetworkGraphCommit {
  oid: string;
  parentOids: string[];
  message: string;
  author?: {
    name: string;
    email: string;
    timestamp: number;
    timezoneOffset: number;
  };
  committer?: {
    name: string;
    email: string;
    timestamp: number;
    timezoneOffset: number;
  };
}

/** Tag data shaped for git-network-graph's RawTag input */
export interface NetworkGraphTag {
  name: string;
  oid: string;
}

/**
 * Fetches commits for the network graph visualization.
 * Returns commits with parent OIDs, suitable for `createGitGraphFromData()`.
 *
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param token - GitHub personal access token
 * @param maxCount - Maximum commits to fetch (default 30)
 * @returns Array of commits shaped for RawGraphInput
 * @throws {GitHubApiError} on API errors
 */
export async function fetchCommitsForGraph(
  owner: string,
  repo: string,
  token: string,
  maxCount = 100,
): Promise<NetworkGraphCommit[]> {
  const allCommits: NetworkGraphCommit[] = [];
  const perPage = Math.min(maxCount, 100);
  let page = 1;

  while (allCommits.length < maxCount) {
    const url = `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits?per_page=${perPage}&page=${page}`;
    const headers = buildHeaders(token);

    const response = await fetchWithRetry(url, { headers }, 'fetchCommitsForGraph');
    const rateLimitInfo = parseRateLimitHeaders(response.headers);

    if (!response.ok) {
      handleApiError(
        response.status,
        rateLimitInfo,
        owner,
        repo,
        parseRetryAfter(response.headers),
      );
    }

    const data = z.array(CommitListItemSchema).parse(await response.json());
    if (data.length === 0) break;

    for (const c of data) {
      if (allCommits.length >= maxCount) break;
      const authorDate = c.commit.author?.date;
      const committerDate = c.commit.committer?.date;
      allCommits.push({
        oid: c.sha,
        parentOids: c.parents.map((p) => p.sha),
        message: c.commit.message,
        author: c.commit.author
          ? {
              name: c.commit.author.name,
              email: '',
              timestamp: authorDate ? Math.floor(new Date(authorDate).getTime() / 1000) : 0,
              timezoneOffset: 0,
            }
          : undefined,
        committer: c.commit.committer
          ? {
              name: c.commit.committer.name,
              email: '',
              timestamp: committerDate ? Math.floor(new Date(committerDate).getTime() / 1000) : 0,
              timezoneOffset: 0,
            }
          : undefined,
      });
    }

    if (data.length < perPage) break;
    page++;
  }

  return allCommits;
}

/**
 * Fetches tags for the network graph visualization.
 * Returns tag names with their commit SHAs, suitable for `createGitGraphFromData()`.
 *
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param token - GitHub personal access token
 * @returns Array of tags shaped for RawGraphInput
 * @throws {GitHubApiError} on API errors
 */
export async function fetchTagsForGraph(
  owner: string,
  repo: string,
  token: string,
): Promise<NetworkGraphTag[]> {
  const url = `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/tags?per_page=20`;
  const headers = buildHeaders(token);

  const response = await fetchWithRetry(url, { headers }, 'fetchTagsForGraph');
  const rateLimitInfo = parseRateLimitHeaders(response.headers);

  if (!response.ok) {
    handleApiError(response.status, rateLimitInfo, owner, repo, parseRetryAfter(response.headers));
  }

  const data = z.array(TagListItemSchema).parse(await response.json());
  return data.map((t) => ({
    name: t.name,
    oid: t.commit.sha,
  }));
}
