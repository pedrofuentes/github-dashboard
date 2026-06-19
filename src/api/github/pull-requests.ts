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
import { z } from 'zod';

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
 * @param signal - Optional signal to cancel the in-flight request
 * @returns Number of pull requests matching the filter
 * @throws {GitHubApiError} on API errors
 */
export async function fetchPullRequestCount(
  owner: string,
  repo: string,
  token?: string,
  state: 'open' | 'closed' | 'all' = 'open',
  signal?: AbortSignal,
): Promise<number> {
  const stateQualifier = state === 'all' ? '' : ` is:${state}`;
  const query = `repo:${owner}/${repo} type:pr${stateQualifier}`;
  const url = `${GITHUB_API_BASE}/search/issues?q=${encodeURIComponent(query)}&per_page=1`;
  const headers = buildHeaders(token);

  const response = await fetchWithRetry(url, { headers, signal }, 'fetchPullRequestCount');
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

/** One page of the cross-repo "review-requested:@me" search. */
export interface ReviewRequestedSearchPage {
  /** Search items carrying the `repository_url` used to attribute each PR. */
  items: { repository_url: string }[];
  /** Total matches across every page (GitHub Search `total_count`). */
  totalCount: number;
  /** Absolute URL of the next page (`Link: rel="next"`), or null when last. */
  nextPageUrl: string | null;
}

/**
 * Minimal schema for one review-requested Search page: only `total_count` and
 * each item's `repository_url` are read, so `.passthrough()` keeps the many
 * unused Search fields from failing validation.
 */
const ReviewRequestedSearchPageSchema = z
  .object({
    total_count: z.number(),
    items: z.array(z.object({ repository_url: z.string() }).passthrough()),
  })
  .passthrough();

/**
 * Parses the GitHub `Link` header to extract the `rel="next"` URL.
 *
 * Security: the returned URL is followed with the user's PAT attached, so a
 * forged or MITM'd `Link` header must never redirect that token off-origin.
 * Only URLs on the GitHub API origin are accepted; anything else (or an
 * unparseable value) is treated as "no next page" so pagination simply stops.
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
 * Fetches a single page of the cross-repo "review-requested:@me" search and
 * reports the next-page URL parsed from the `Link` header so callers can follow
 * pagination and count *all* review requests — not just the first page. A user
 * with more than one page of requested reviews would otherwise be undercounted.
 *
 * @param url - Absolute Search URL for this page (first page or a `Link` next)
 * @param options - Auth token and an optional AbortSignal to cancel the fetch
 * @returns The page's items, the fleet-wide `total_count`, and the next-page URL
 * @throws {GitHubApiError} on API errors (401/403/404/429/5xx)
 */
export async function fetchReviewRequestedPage(
  url: string,
  options: { token: string; signal?: AbortSignal },
): Promise<ReviewRequestedSearchPage> {
  const headers = buildHeaders(options.token);
  const response = await fetchWithRetry(
    url,
    { headers, signal: options.signal },
    'fetchReviewRequestedPage',
  );
  const rateLimitInfo = parseRateLimitHeaders(response.headers);

  if (!response.ok) {
    handleApiError(response.status, rateLimitInfo, '', '', parseRetryAfter(response.headers));
  }

  const data = ReviewRequestedSearchPageSchema.parse(await response.json());
  return {
    items: data.items.map((item) => ({ repository_url: item.repository_url })),
    totalCount: data.total_count,
    nextPageUrl: parseNextPageUrl(response.headers.get('link')),
  };
}
