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
  buildHeaders,
  fetchWithRetry,
  handleApiError,
  parseRateLimitHeaders,
  parseRetryAfter,
} from './core';
import {
  DependabotAlertSchema,
  BranchComparisonResponseSchema,
  BranchListItemSchema,
  CommitActivityWeekSchema,
  CommitListItemSchema,
  TagListItemSchema,
} from './schemas';

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
}

/**
 * Hard ceiling on the number of alert pages followed per feed. At 100 alerts a
 * page this covers 5,000 open alerts — far beyond any healthy repo — while
 * guaranteeing pagination terminates even if a forged/looping `Link` header
 * keeps advertising another on-origin "next" page (issue #63).
 */
export const MAX_ALERT_PAGES = 50;

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
 * Fetches every page of an alert feed, following `Link: rel="next"` until the
 * feed is exhausted or {@link MAX_ALERT_PAGES} is reached. Returns the
 * concatenated raw rows. A single `per_page=100` request silently undercounts
 * any repo with more than 100 open alerts (issue #63), so both alert feeds
 * enumerate every page before grading.
 */
async function fetchAllAlertPages<T>(
  initialUrl: string,
  schema: z.ZodType<T[]>,
  token: string,
  context: string,
  owner: string,
  repo: string,
  signal?: AbortSignal,
): Promise<T[]> {
  const headers = buildHeaders(token);
  const items: T[] = [];
  let url: string | null = initialUrl;

  for (let page = 0; url && page < MAX_ALERT_PAGES; page++) {
    const response = await fetchWithRetry(url, { headers, signal }, context);

    if (!response.ok) {
      const rateLimitInfo = parseRateLimitHeaders(response.headers);
      handleApiError(
        response.status,
        rateLimitInfo,
        owner,
        repo,
        parseRetryAfter(response.headers),
      );
    }

    const parsed = schema.parse(await response.json());
    for (const item of parsed) items.push(item);

    url = parseNextPageUrl(response.headers.get('link'));
  }

  return items;
}

/**
 * Fetches open Dependabot alerts across every page and summarizes by severity.
 * Requires `Dependabot alerts: Read` permission.
 *
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param token - GitHub PAT
 * @param signal - Optional signal to cancel the in-flight request
 * @returns Alert summary with counts by severity
 * @throws {GitHubApiError} on API errors
 */
export async function fetchDependabotAlerts(
  owner: string,
  repo: string,
  token: string,
  signal?: AbortSignal,
): Promise<SecurityAlertSummary> {
  const initialUrl =
    `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}` +
    `/dependabot/alerts?state=open&per_page=100`;
  const alerts = await fetchAllAlertPages(
    initialUrl,
    z.array(DependabotAlertSchema),
    token,
    'fetchDependabotAlerts',
    owner,
    repo,
    signal,
  );

  const summary: SecurityAlertSummary = { critical: 0, high: 0, medium: 0, low: 0, total: 0 };
  for (const alert of alerts) {
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
  }
  return summary;
}

/** Code-scanning alert shape we care about: just the rule's severity sources. */
const CodeScanningAlertSchema = z
  .object({
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
 * silently over-graded (issue #63). Uses {@link fetchWithRetry} (not the ETag
 * cache) because following `Link` requires the response headers.
 *
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param token - GitHub PAT
 * @param signal - Optional signal to cancel the in-flight request
 * @returns Alert summary with counts by severity
 * @throws {GitHubApiError} on API errors
 */
export async function fetchCodeScanningAlerts(
  owner: string,
  repo: string,
  token: string,
  signal?: AbortSignal,
): Promise<SecurityAlertSummary> {
  const initialUrl =
    `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}` +
    `/code-scanning/alerts?state=open&per_page=100`;
  const alerts = await fetchAllAlertPages(
    initialUrl,
    z.array(CodeScanningAlertSchema),
    token,
    'fetchCodeScanningAlerts',
    owner,
    repo,
    signal,
  );

  const summary: SecurityAlertSummary = { critical: 0, high: 0, medium: 0, low: 0, total: 0 };
  for (const alert of alerts) {
    const severity = codeScanningSeverity(alert);
    if (severity) {
      summary[severity]++;
      summary.total++;
    }
  }
  return summary;
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

/** Commit activity data from the GitHub stats API */
export interface CommitActivityWeek {
  /** Unix timestamp of the start of this week */
  total: number;
  /** Start of week as Unix timestamp */
  week: number;
  /** Daily commit counts (Sun=0 ... Sat=6) */
  days: number[];
}

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
export async function fetchCommitActivity(
  owner: string,
  repo: string,
  token?: string,
  timeRange: '24h' | '7d' | '30d' = '7d',
): Promise<number> {
  const url = `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/stats/commit_activity`;
  const headers = buildHeaders(token);

  const response = await fetchWithRetry(url, { headers }, 'fetchCommitActivity');
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
