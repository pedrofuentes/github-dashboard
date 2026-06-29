import { useEffect, useRef, useState } from 'react';

import { GITHUB_API_BASE, fetchReviewRequestedPage } from '../../api/github';
import type { ReviewRequestedSearchItem } from '../../api/github';
import { isAbortError } from '../../lib/abort';
import {
  MAX_REVIEW_PAGES,
  REVIEW_REQUESTED_QUERY,
  REVIEW_SCORE_WEIGHT,
} from '../../lib/reviews-constants';
import type { Repo, ReviewRequestedPullRequest, ReviewsSignalSlice } from '../../types/fleet';

/**
 * Re-exported from `lib/reviews-constants` so the REST hook and the GraphQL
 * deriver share one source of truth while existing call sites keep importing
 * from here.
 */
export { MAX_REVIEW_PAGES, REVIEW_REQUESTED_QUERY, REVIEW_SCORE_WEIGHT };

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
 * When the batched GraphQL loader is enabled (see {@link useRepoSignals}), an
 * `override` map is supplied and the hook returns it directly, skipping all REST
 * work — mirroring {@link useCiSignal}.
 */

/** One Search page covers most fleets; further pages are followed via `Link`. */
const SEARCH_PAGE_SIZE = 100;

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
 * PRs target it (zero when none), `score` is that count weighted for sort, and
 * `requests` un-projects each targeting PR's per-item identity (in result
 * order, omitted when the repo has none) for the Notifications Inbox. Items for
 * repos outside the fleet are ignored.
 */
export function distributeReviewCounts(
  repoNames: string[],
  items: ReviewRequestedSearchItem[],
): Map<string, ReviewsSignalSlice> {
  const requestsByRepo = new Map<string, ReviewRequestedPullRequest[]>();
  for (const item of items) {
    const fullName = repoFullNameFromUrl(item.repository_url);
    if (fullName !== null) {
      const list = requestsByRepo.get(fullName) ?? [];
      list.push({
        number: item.number,
        title: item.title,
        html_url: item.html_url,
        created_at: item.created_at,
        user_login: item.user_login,
      });
      requestsByRepo.set(fullName, list);
    }
  }

  const slices = new Map<string, ReviewsSignalSlice>();
  for (const name of repoNames) {
    const requests = requestsByRepo.get(name) ?? [];
    const requestedCount = requests.length;
    const slice: ReviewsSignalSlice = {
      status: 'ready',
      requestedCount,
      score: requestedCount * REVIEW_SCORE_WEIGHT,
    };
    if (requestedCount > 0) {
      slice.requests = requests;
    }
    slices.set(name, slice);
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
 * adversarial `Link` chain can never loop indefinitely; if the cap is reached
 * while more pages are still advertised it warns, since the counts may then
 * undercount.
 */
async function collectReviewRequestedItems(
  token: string,
  signal: AbortSignal,
): Promise<ReviewRequestedSearchItem[]> {
  const items: ReviewRequestedSearchItem[] = [];
  let nextUrl: string | null = reviewRequestedSearchUrl();

  for (let pageNumber = 0; nextUrl !== null && pageNumber < MAX_REVIEW_PAGES; pageNumber += 1) {
    if (signal.aborted) break;
    const page = await fetchReviewRequestedPage(nextUrl, { token, signal });
    items.push(...page.items);
    nextUrl = page.nextPageUrl;
  }

  // Stopped at the cap while GitHub still advertised more pages: the counts may
  // undercount, so surface it rather than silently truncating (an aborted run
  // is an intentional stop, not a cap hit).
  if (nextUrl !== null && !signal.aborted) {
    console.warn(
      `useReviewsSignal: stopped following review-request pagination at the ` +
        `${MAX_REVIEW_PAGES}-page cap while more pages were available; counts may undercount`,
    );
  }

  return items;
}

/**
 * Resolves the review-request queue for every repo in `repos`.
 *
 * @param repos - Repositories to surface review counts for.
 * @param token - Auth token; `null` yields an empty map and skips the network.
 * @param override - When provided, the hook returns it immediately and makes
 *   zero network calls (used by {@link useRepoSignals} to inject slices from the
 *   batched GraphQL loader when the `reviews` flag is enabled). `undefined`
 *   restores normal REST behavior.
 * @returns A map keyed by `repo.nameWithOwner` of {@link ReviewsSignalSlice}.
 */
export function useReviewsSignal(
  repos: Repo[],
  token: string | null,
  override?: Map<string, ReviewsSignalSlice>,
): Map<string, ReviewsSignalSlice> {
  const [slices, setSlices] = useState<Map<string, ReviewsSignalSlice>>(() => new Map());
  const generationRef = useRef(0);
  const reposKey = repos.map((repo) => repo.nameWithOwner).join(KEY_SEPARATOR);

  useEffect(() => {
    // When an override is supplied the caller owns the data; skip all REST work.
    if (override) return;

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
  }, [token, reposKey, override]);

  return override ?? slices;
}
