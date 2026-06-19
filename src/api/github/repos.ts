/**
 * Repository statistics and metadata functions.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */

import {
  GITHUB_API_BASE,
  GitHubApiError,
  GitHubErrorCode,
  buildHeaders,
  fetchWithRetry,
  parseRateLimitHeaders,
} from './core';
import { RepoStatsResponseSchema } from './schemas';

/** Stat types supported by the plugin */
export type StatType =
  | 'stars'
  | 'issues'
  | 'forks'
  | 'watchers'
  | 'pull_requests'
  | 'language'
  | 'size'
  | 'license'
  | 'default_branch'
  | 'visibility';

/** Ordered list of all stat types (used for cycling on short press) */
export const STAT_TYPES: readonly StatType[] = [
  'stars',
  'issues',
  'forks',
  'watchers',
  'pull_requests',
  'language',
  'size',
  'license',
  'default_branch',
  'visibility',
] as const;

/** Stat types that display a numeric count */
export type NumericStatType = 'stars' | 'issues' | 'forks' | 'watchers' | 'pull_requests';

/** Subset of the GitHub repository response we care about */
export interface RepoStats {
  stargazers_count: number;
  open_issues_count: number;
  forks_count: number;
  watchers_count: number;
  full_name: string;
  description: string | null;
  visibility: string;
  html_url: string;
  language: string | null;
  size: number;
  license: string | null;
  default_branch: string;
  open_pull_request_count?: number;
}

/**
 * Fetches repository statistics from the GitHub API.
 *
 * @param owner - Repository owner (user or organization)
 * @param repo - Repository name
 * @param token - Optional GitHub personal access token for authenticated requests
 * @param signal - Optional signal to cancel the in-flight request
 * @returns Repository statistics
 * @throws {GitHubApiError} on API errors (401, 403, 404, rate limit, etc.)
 */
export async function fetchRepoStats(
  owner: string,
  repo: string,
  token?: string,
  signal?: AbortSignal,
): Promise<RepoStats> {
  const url = `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const headers = buildHeaders(token);

  const response = await fetchWithRetry(url, { headers, signal }, 'fetchRepoStats');
  const rateLimitInfo = parseRateLimitHeaders(response.headers);

  if (!response.ok) {
    const errorBody = await response.text().catch(() => 'Unknown error');

    if (response.status === 401) {
      throw new GitHubApiError(
        'Invalid or expired GitHub token',
        response.status,
        rateLimitInfo,
        undefined,
        GitHubErrorCode.AUTH_ERROR,
      );
    }

    if (response.status === 429) {
      const resetTime = rateLimitInfo.reset.toLocaleTimeString();
      throw new GitHubApiError(
        `GitHub API rate limit exceeded (429). Resets at ${resetTime}`,
        response.status,
        rateLimitInfo,
        undefined,
        GitHubErrorCode.RATE_LIMITED,
      );
    }

    if (response.status === 403 && rateLimitInfo.remaining === 0) {
      const resetTime = rateLimitInfo.reset.toLocaleTimeString();
      throw new GitHubApiError(
        `GitHub API rate limit exceeded. Resets at ${resetTime}`,
        response.status,
        rateLimitInfo,
        undefined,
        GitHubErrorCode.RATE_LIMITED,
      );
    }

    if (response.status === 403) {
      throw new GitHubApiError(
        'Access denied. Check token permissions.',
        response.status,
        rateLimitInfo,
        undefined,
        GitHubErrorCode.ACCESS_DENIED,
      );
    }

    if (response.status === 404) {
      throw new GitHubApiError(
        `Repository "${owner}/${repo}" not found or is private`,
        response.status,
        rateLimitInfo,
        undefined,
        GitHubErrorCode.NOT_FOUND,
      );
    }

    throw new GitHubApiError(
      `GitHub API error (${response.status}): ${errorBody}`,
      response.status,
      rateLimitInfo,
      undefined,
      GitHubErrorCode.SERVER_ERROR,
    );
  }

  const data = RepoStatsResponseSchema.parse(await response.json());

  const licenseObj = data.license;
  const licenseId = licenseObj?.spdx_id ?? null;

  return {
    stargazers_count: data.stargazers_count,
    open_issues_count: data.open_issues_count,
    forks_count: data.forks_count,
    watchers_count: data.watchers_count,
    full_name: data.full_name,
    description: data.description,
    visibility: data.visibility,
    html_url: data.html_url,
    language: data.language,
    size: data.size,
    license: licenseId && licenseId !== 'NOASSERTION' ? licenseId : null,
    default_branch: data.default_branch,
  };
}

/**
 * Extracts the count for a numeric stat type from repo stats.
 */
export function getStatValue(stats: RepoStats, statType: StatType): number {
  switch (statType) {
    case 'stars':
      return stats.stargazers_count;
    case 'issues':
      return stats.open_issues_count;
    case 'forks':
      return stats.forks_count;
    case 'watchers':
      return stats.watchers_count;
    case 'pull_requests':
      return stats.open_pull_request_count ?? 0;
    case 'size':
      return stats.size;
    default:
      return 0;
  }
}

/**
 * Returns the display string for a stat type.
 * Numeric stats get formatted with formatCount; text stats return the raw value.
 */
export function getStatDisplay(
  stats: RepoStats,
  statType: StatType,
  formatCountFn: (n: number) => string,
): string {
  switch (statType) {
    case 'stars':
    case 'issues':
    case 'forks':
    case 'watchers':
    case 'pull_requests':
      return formatCountFn(getStatValue(stats, statType));
    case 'language':
      return stats.language ?? 'None';
    case 'size':
      return formatRepoSize(stats.size);
    case 'license':
      return stats.license ?? 'None';
    case 'default_branch':
      return stats.default_branch;
    case 'visibility':
      return stats.visibility === 'private' ? 'Private' : 'Public';
  }
}

/**
 * Formats a repository size (in KB from the GitHub API) to a human-readable string.
 */
export function formatRepoSize(sizeKb: number): string {
  if (sizeKb < 1024) return `${sizeKb} KB`;
  const mb = sizeKb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(1)} GB`;
}

/**
 * Returns a human-readable label for a stat type.
 */
export function getStatLabel(statType: StatType): string {
  switch (statType) {
    case 'stars':
      return 'Stars';
    case 'issues':
      return 'Issues';
    case 'forks':
      return 'Forks';
    case 'watchers':
      return 'Watchers';
    case 'pull_requests':
      return 'Pull Requests';
    case 'language':
      return 'Language';
    case 'size':
      return 'Size';
    case 'license':
      return 'License';
    case 'default_branch':
      return 'Branch';
    case 'visibility':
      return 'Visibility';
  }
}

/**
 * Returns the GitHub web URL for a specific stat type's detail page.
 *
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param statType - Which stat to link to
 * @returns The URL to open in the browser
 */
export function getStatUrl(owner: string, repo: string, statType: StatType): string {
  const base = `https://github.com/${owner}/${repo}`;
  switch (statType) {
    case 'stars':
      return `${base}/stargazers`;
    case 'issues':
      return `${base}/issues`;
    case 'forks':
      return `${base}/forks`;
    case 'watchers':
      return `${base}/watchers`;
    case 'pull_requests':
      return `${base}/pulls`;
    case 'language':
      return `${base}`;
    case 'size':
      return `${base}`;
    case 'license':
      return `${base}`;
    case 'default_branch':
      return `${base}`;
    case 'visibility':
      return `${base}/settings`;
  }
}
