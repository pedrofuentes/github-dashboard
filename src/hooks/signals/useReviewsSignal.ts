import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';

import { GITHUB_API_BASE, fetchWithETag } from '../../api/github';
import { isAbortError } from '../../lib/abort';
import type { Repo, ReviewsSignalSlice } from '../../types/fleet';

/**
 * Reviews signal — PRs awaiting the authenticated user's review (issue #15).
 *
 * A single cross-repo GitHub Search call (`review-requested:@me`) covers the
 * whole fleet — far cheaper than one request per repo and well inside the
 * 30 req/min Search bucket — then the results are distributed into one
 * {@link ReviewsSignalSlice} per repo. Repos with no awaiting review zero-fill
 * to `requestedCount: 0`. The fetch is race-guarded so a superseded token's
 * response can never overwrite the current one, and goes through
 * {@link fetchWithETag} so a `304` serves cached data at zero rate-limit cost.
 *
 * This replaces the stub and edits nothing shared — `useRepoSignals` composes it
 * exactly as before.
 */

/** Awaiting *your* review is high urgency: weight the score accordingly. */
export const REVIEW_SCORE_WEIGHT = 10;

/** Cross-repo Search query for open PRs requesting the viewer's review. */
const REVIEW_REQUESTED_QUERY = 'is:open is:pr review-requested:@me';

/** One Search page comfortably covers a personal fleet in a single call. */
const SEARCH_PAGE_SIZE = 100;

/** Separator for the repo-set dependency key (repo names can't contain it). */
const KEY_SEPARATOR = '\n';

/**
 * Minimal Search response schema (local to this hook). `.passthrough()` keeps
 * the dozens of unused Search fields from breaking validation; only
 * `repository_url` is read, to attribute each PR to a repo.
 */
const ReviewRequestedSearchSchema = z
  .object({
    total_count: z.number(),
    items: z.array(z.object({ repository_url: z.string() }).passthrough()),
  })
  .passthrough();

/** Absolute Search URL for the review-requested query (one call for the fleet). */
export function reviewRequestedSearchUrl(): string {
  const query = encodeURIComponent(REVIEW_REQUESTED_QUERY);
  return `${GITHUB_API_BASE}/search/issues?q=${query}&per_page=${SEARCH_PAGE_SIZE}`;
}

/**
 * Extracts `owner/repo` from a Search item's `repository_url`
 * (`https://api.github.com/repos/owner/repo`). Returns `null` for any URL that
 * doesn't carry a non-empty repo path, so a malformed item is simply skipped.
 */
export function repoFullNameFromUrl(repositoryUrl: string): string | null {
  const marker = '/repos/';
  const index = repositoryUrl.indexOf(marker);
  if (index < 0) {
    return null;
  }
  const fullName = repositoryUrl.slice(index + marker.length);
  return fullName.length > 0 ? fullName : null;
}

/**
 * Folds the cross-repo Search items into one ready {@link ReviewsSignalSlice}
 * per repo in `repoNames`: each repo's `requestedCount` is how many returned
 * PRs target it (zero when none), and `score` is that count weighted for sort.
 * Items for repos outside the fleet are ignored.
 */
export function distributeReviewCounts(
  repoNames: string[],
  items: { repository_url: string }[],
): Map<string, ReviewsSignalSlice> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const fullName = repoFullNameFromUrl(item.repository_url);
    if (fullName !== null) {
      counts.set(fullName, (counts.get(fullName) ?? 0) + 1);
    }
  }

  const slices = new Map<string, ReviewsSignalSlice>();
  for (const name of repoNames) {
    const requestedCount = counts.get(name) ?? 0;
    slices.set(name, {
      status: 'ready',
      requestedCount,
      score: requestedCount * REVIEW_SCORE_WEIGHT,
    });
  }
  return slices;
}

/** Builds a map assigning the same lifecycle status to every repo. */
function uniformSlices(
  repoNames: string[],
  status: 'loading' | 'error',
): Map<string, ReviewsSignalSlice> {
  const slices = new Map<string, ReviewsSignalSlice>();
  for (const name of repoNames) {
    slices.set(name, { status });
  }
  return slices;
}

/**
 * Resolves the review-request queue for every repo in `repos`.
 *
 * @param repos - Repositories to surface review counts for.
 * @param token - Auth token; `null` yields an empty map and skips the network.
 * @returns A map keyed by `repo.nameWithOwner` of {@link ReviewsSignalSlice}.
 */
export function useReviewsSignal(
  repos: Repo[],
  token: string | null,
): Map<string, ReviewsSignalSlice> {
  const [slices, setSlices] = useState<Map<string, ReviewsSignalSlice>>(() => new Map());
  const generationRef = useRef(0);
  const reposKey = repos.map((repo) => repo.nameWithOwner).join(KEY_SEPARATOR);

  useEffect(() => {
    const generation = (generationRef.current += 1);
    const repoNames = reposKey.length === 0 ? [] : reposKey.split(KEY_SEPARATOR);

    if (token === null || repoNames.length === 0) {
      setSlices(new Map());
      return;
    }

    // One controller per run: cleanup (or a repos/token change) aborts the
    // in-flight request so superseded work stops instead of racing to set state.
    const controller = new AbortController();

    setSlices(uniformSlices(repoNames, 'loading'));

    fetchWithETag(reviewRequestedSearchUrl(), ReviewRequestedSearchSchema, {
      token,
      context: 'useReviewsSignal',
      signal: controller.signal,
    })
      .then((data) => {
        if (generation !== generationRef.current) {
          return;
        }
        setSlices(distributeReviewCounts(repoNames, data.items));
      })
      .catch((err) => {
        // A cancelled request is not a failure: stay quiet (no log, no error).
        if (controller.signal.aborted || isAbortError(err)) return;
        console.error(
          `useReviewsSignal: failed to fetch review requests for ${repoNames.join(', ')}`,
          err,
        );
        if (generation !== generationRef.current) {
          return;
        }
        setSlices(uniformSlices(repoNames, 'error'));
      });

    return () => controller.abort();
  }, [token, reposKey]);

  return slices;
}
