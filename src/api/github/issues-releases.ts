/**
 * Issue counting and release tracking functions.
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
import { SearchCountResponseSchema, ReleaseResponseSchema } from './schemas';
import { fetchRepoStats } from './repos';
import { fetchPullRequestCount } from './pull-requests';

/** Release information from the GitHub API */
export interface ReleaseInfo {
  tag_name: string;
  name: string;
  html_url: string;
  published_at: string;
  prerelease: boolean;
  draft: boolean;
}

/**
 * Fetches issue count for a repository with a given state filter.
 * For "open" state, uses repo stats minus open PRs.
 * For "closed" or "all", uses the GitHub Search API with `type:issue` qualifier
 * which returns an exact count excluding PRs.
 *
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param token - GitHub personal access token
 * @param state - Issue state filter: "open", "closed", or "all"
 * @returns Number of issues (excluding PRs) matching the filter
 * @throws {GitHubApiError} on API errors
 */
export async function fetchIssueCount(
  owner: string,
  repo: string,
  token?: string,
  state: 'open' | 'closed' | 'all' = 'open',
): Promise<number> {
  // For "open" state, use the repo's open_issues_count and subtract open PRs
  // This is more accurate and saves an API call
  if (state === 'open') {
    const [stats, prCount] = await Promise.all([
      fetchRepoStats(owner, repo, token),
      fetchPullRequestCount(owner, repo, token, 'open'),
    ]);
    // GitHub's open_issues_count includes PRs, so subtract open PR count
    return Math.max(stats.open_issues_count - prCount, 0);
  }

  // For "closed" or "all", use the GitHub Search API with type:issue qualifier.
  // This returns total_count which accurately excludes PRs in a single call,
  // avoiding unreliable pagination-based counting via Link headers.
  const stateQualifier = state === 'all' ? '' : ` is:${state}`;
  const query = `repo:${owner}/${repo} type:issue${stateQualifier}`;
  const url = `${GITHUB_API_BASE}/search/issues?q=${encodeURIComponent(query)}&per_page=1`;
  const headers = buildHeaders(token);

  const response = await fetchWithRetry(url, { headers }, 'fetchIssueCount');
  const rateLimitInfo = parseRateLimitHeaders(response.headers);

  if (!response.ok) {
    handleApiError(response.status, rateLimitInfo, owner, repo, parseRetryAfter(response.headers));
  }

  const data = SearchCountResponseSchema.parse(await response.json());
  return data.total_count;
}

/**
 * Fetches the latest release for a repository.
 *
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param token - GitHub personal access token
 * @param includePreReleases - Whether to include pre-releases (default: false)
 * @returns Latest release info, or null if no releases
 * @throws {GitHubApiError} on API errors (except 404)
 */
export async function fetchLatestRelease(
  owner: string,
  repo: string,
  token?: string,
  includePreReleases = false,
): Promise<ReleaseInfo | null> {
  const headers = buildHeaders(token);

  if (!includePreReleases) {
    // GET /repos/{owner}/{repo}/releases/latest — skips pre-releases and drafts
    const url = `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases/latest`;
    const response = await fetchWithRetry(url, { headers }, 'fetchLatestRelease');
    const rateLimitInfo = parseRateLimitHeaders(response.headers);

    if (response.status === 404) {
      return null; // No releases
    }

    if (!response.ok) {
      handleApiError(
        response.status,
        rateLimitInfo,
        owner,
        repo,
        parseRetryAfter(response.headers),
      );
    }

    const data = ReleaseResponseSchema.parse(await response.json());
    return {
      tag_name: data.tag_name,
      name: data.name ?? '',
      html_url: data.html_url,
      published_at: data.published_at ?? '',
      prerelease: data.prerelease,
      draft: data.draft,
    };
  }

  // Include pre-releases: get the first release (most recent)
  const url = `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases?per_page=1`;
  const response = await fetchWithRetry(url, { headers }, 'fetchLatestRelease');
  const rateLimitInfo = parseRateLimitHeaders(response.headers);

  if (!response.ok) {
    handleApiError(response.status, rateLimitInfo, owner, repo, parseRetryAfter(response.headers));
  }

  const releases = z.array(ReleaseResponseSchema).parse(await response.json());
  if (releases.length === 0) {
    return null;
  }

  const data = releases[0];
  return {
    tag_name: data.tag_name,
    name: data.name ?? '',
    html_url: data.html_url,
    published_at: data.published_at ?? '',
    prerelease: data.prerelease,
    draft: data.draft,
  };
}

/**
 * Formats a relative time string from an ISO date (e.g. "2d ago", "3h ago").
 *
 * @param isoDate - ISO 8601 date string
 * @returns Human-readable relative time
 */
export function formatRelativeTime(isoDate: string): string {
  if (!isoDate) return '';
  const date = new Date(isoDate);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMs / 3600000);
  const diffDay = Math.floor(diffMs / 86400000);
  const diffWeek = Math.floor(diffDay / 7);
  const diffMonth = Math.floor(diffDay / 30);
  const diffYear = Math.floor(diffDay / 365);

  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  if (diffWeek < 5) return `${diffWeek}w ago`;
  if (diffMonth < 12) return `${diffMonth}mo ago`;
  return `${diffYear}y ago`;
}
