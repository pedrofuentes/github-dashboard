import { useEffect, useRef, useState } from 'react';

import { GITHUB_API_BASE, fetchReviewRequestedPage } from '../../api/github';
import { isAbortError } from '../../lib/abort';
import type { Repo, ReviewsSignalSlice } from '../../types/fleet';

/**
 * Reviews signal — PRs awaiting the authenticated user's review (issue #15).
 *
 * A single cross-repo GitHub Search call (`review-requested:@me`) covers the
 * whole fleet — far cheaper than one request per repo and well inside the
 * 30 req/min Search bucket — then the results are distributed into one
 * {@link ReviewsSignalSlice} per repo. Repos with no awaiting review zero-fill
 * to `requestedCount: 0`.
 *
 * A reviewer can have more than one page of requested reviews, so the search is
 * paginated: each page's `Link: rel="next"` URL is followed (up to
 * {@link MAX_REVIEW_PAGES}) and every page's items are counted, so a user with
 * over {@link SEARCH_PAGE_SIZE} review requests is no longer undercounted
 * (issue #62). The fetch is race-guarded so a superseded token's response can
 * never overwrite the current one, and threads an {@link AbortSignal} so a
 * repos/token change or unmount cancels the in-flight pages.
 *
 * This replaces the stub and edits nothing shared — `useRepoSignals` composes it
 * exactly as before.
 */

/** Awaiting *your* review is high urgency: weight the score accordingly. */
export const REVIEW_SCORE_WEIGHT = 10;

/** Cross-repo Search query for open PRs requesting the viewer's review. */
const REVIEW_REQUESTED_QUERY = 'is:open is:pr review-requested:@me';

/** One Search page covers most fleets; further pages are followed via `Link`. */
const SEARCH_PAGE_SIZE = 100;

/**
 * Cap on pages followed via `Link: rel="next"`. At {@link SEARCH_PAGE_SIZE}
 * results per page this counts up to 1,000 review requests — far beyond any
 * realistic review queue — while guaranteeing pagination can never loop
 * indefinitely on a malformed or adversarial `Link` header.
 */
export const MAX_REVIEW_PAGES = 10;

/** Separator for the repo-set dependency key (repo names can't contain it). */
const KEY_SEPARATOR = '\n';

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
 * Walks the review-requested Search result set page by page, following each
 * response's `Link: rel="next"` URL, and returns every item across all pages so
 * counts include PRs beyond the first {@link SEARCH_PAGE_SIZE}. Stops at
 * {@link MAX_REVIEW_PAGES} (or sooner when `signal` aborts) so a malformed or
 * adversarial `Link` chain can never loop indefinitely.
 */
async function collectReviewRequestedItems(
  token: string,
  signal: AbortSignal,
): Promise<{ repository_url: string }[]> {
  const items: { repository_url: string }[] = [];
  let nextUrl: string | null = reviewRequestedSearchUrl();

  for (let pageNumber = 0; nextUrl !== null && pageNumber < MAX_REVIEW_PAGES; pageNumber += 1) {
    if (signal.aborted) break;
    const page = await fetchReviewRequestedPage(nextUrl, { token, signal });
    items.push(...page.items);
    nextUrl = page.nextPageUrl;
  }

  return items;
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
    // in-flight pages so superseded work stops instead of racing to set state.
    const controller = new AbortController();

    setSlices(uniformSlices(repoNames, 'loading'));

    collectReviewRequestedItems(token, controller.signal)
      .then((items) => {
        if (generation !== generationRef.current) {
          return;
        }
        setSlices(distributeReviewCounts(repoNames, items));
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
