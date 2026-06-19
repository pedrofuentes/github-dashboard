/**
 * Pull request counting and review queue functions.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */

import {
  GITHUB_API_BASE,
  GitHubApiError,
  buildHeaders,
  fetchWithRetry,
  handleApiError,
  parseRateLimitHeaders,
  parseRetryAfter,
} from './core';
import { SearchCountResponseSchema, ReviewSearchResponseSchema } from './schemas';

/** Summary of a PR requesting the user's review */
export interface ReviewRequestedPR {
  number: number;
  title: string;
  user_login: string;
  html_url: string;
  created_at: string;
}

/**
 * Fetches the count of open pull requests for a repository.
 * Uses the GitHub Search API with `type:pr` for reliable counting.
 *
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param token - GitHub personal access token
 * @returns Number of open pull requests
 */
export async function fetchOpenPullRequestCount(
  owner: string,
  repo: string,
  token?: string,
): Promise<number> {
  const query = `repo:${owner}/${repo} type:pr is:open`;
  const url = `${GITHUB_API_BASE}/search/issues?q=${encodeURIComponent(query)}&per_page=1`;
  const headers = buildHeaders(token);

  const response = await fetchWithRetry(url, { headers }, 'fetchOpenPullRequestCount');

  if (!response.ok) {
    return 0; // Graceful fallback — PR count is supplementary data
  }

  const data = SearchCountResponseSchema.parse(await response.json());
  return data.total_count;
}

/**
 * Fetches pull request count for a repository with a given state filter.
 * Uses the GitHub Search API with `type:pr` for reliable counting.
 *
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param token - GitHub personal access token
 * @param state - PR state filter: "open", "closed", or "all"
 * @returns Number of pull requests matching the filter
 * @throws {GitHubApiError} on API errors
 */
export async function fetchPullRequestCount(
  owner: string,
  repo: string,
  token?: string,
  state: 'open' | 'closed' | 'all' = 'open',
): Promise<number> {
  const stateQualifier = state === 'all' ? '' : ` is:${state}`;
  const query = `repo:${owner}/${repo} type:pr${stateQualifier}`;
  const url = `${GITHUB_API_BASE}/search/issues?q=${encodeURIComponent(query)}&per_page=1`;
  const headers = buildHeaders(token);

  const response = await fetchWithRetry(url, { headers }, 'fetchPullRequestCount');
  const rateLimitInfo = parseRateLimitHeaders(response.headers);

  if (!response.ok) {
    handleApiError(response.status, rateLimitInfo, owner, repo, parseRetryAfter(response.headers));
  }

  const data = SearchCountResponseSchema.parse(await response.json());
  return data.total_count;
}

/**
 * Fetches PRs that are requesting the authenticated user's review.
 * Uses the Search API with the review-requested qualifier.
 *
 * @param token - GitHub personal access token
 * @param repo - Optional "owner/repo" filter (shows all repos if omitted)
 * @returns Object with total_count and array of PR summary objects
 * @throws {GitHubApiError} on API errors
 */
export async function fetchReviewRequestedPRs(
  token: string,
  repo?: string,
): Promise<{ total_count: number; items: ReviewRequestedPR[] }> {
  let query = 'is:open is:pr review-requested:@me';
  if (repo) {
    query += ` repo:${repo}`;
  }

  const url = `${GITHUB_API_BASE}/search/issues?q=${encodeURIComponent(query)}&per_page=10&sort=created&order=desc`;
  const headers = buildHeaders(token);

  const response = await fetchWithRetry(url, { headers }, 'fetchReviewRequestedPRs');
  const rateLimitInfo = parseRateLimitHeaders(response.headers);

  if (!response.ok) {
    if (response.status === 401) {
      throw new GitHubApiError('Invalid or expired GitHub token', response.status, rateLimitInfo);
    }
    if (response.status === 422) {
      throw new GitHubApiError(
        'Search query error — token may lack permissions',
        response.status,
        rateLimitInfo,
      );
    }
    if (response.status === 429) {
      const retryAfterSeconds = parseRetryAfter(response.headers);
      const waitSec =
        retryAfterSeconds ??
        Math.max(Math.ceil((rateLimitInfo.reset.getTime() - Date.now()) / 1000), 60);
      throw new GitHubApiError(
        `GitHub API rate limit exceeded (429). Retry after ${waitSec}s`,
        response.status,
        rateLimitInfo,
        waitSec,
      );
    }
    if (response.status === 403 && rateLimitInfo.remaining === 0) {
      const resetTime = rateLimitInfo.reset.toLocaleTimeString();
      const waitSec = Math.max(Math.ceil((rateLimitInfo.reset.getTime() - Date.now()) / 1000), 0);
      throw new GitHubApiError(
        `GitHub API rate limit exceeded. Resets at ${resetTime}`,
        response.status,
        rateLimitInfo,
        waitSec > 0 ? waitSec : undefined,
      );
    }
    if (response.status === 403) {
      throw new GitHubApiError(
        'Access denied. Check token permissions.',
        response.status,
        rateLimitInfo,
      );
    }
    throw new GitHubApiError(
      `GitHub API error (${response.status})`,
      response.status,
      rateLimitInfo,
    );
  }

  const data = ReviewSearchResponseSchema.parse(await response.json());
  const items = data.items.map((item) => ({
    number: item.number,
    title: item.title,
    user_login: item.user?.login ?? '',
    html_url: item.html_url,
    created_at: item.created_at,
  }));

  return {
    total_count: data.total_count,
    items,
  };
}
