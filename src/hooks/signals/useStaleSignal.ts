import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';

import { SIGNAL_FETCH_CONCURRENCY, mapWithConcurrency } from '../../api/concurrency';
import { GITHUB_API_BASE, fetchWithETag, scheduleSearchRequest } from '../../api/github';
import { isAbortError } from '../../lib/abort';
import type { Repo, StaleItem, StaleSignalSlice } from '../../types/fleet';

/**
 * Stale signal — open PRs and issues with no recent activity (issue #17).
 *
 * "Stale" = an open pull request or issue that has not been *updated* in the
 * last {@link STALE_THRESHOLD_DAYS} days. One GitHub Search call per repo
 * (`is:open updated:<cutoff`) returns the count directly via `total_count`,
 * which keeps the whole fleet comfortably inside the 30 req/min Search bucket
 * and routes through {@link fetchWithETag} so an unchanged result replays from
 * the cache at zero rate-limit cost on a `304`.
 *
 * A single tunable threshold is applied to both PRs and issues so each repo
 * needs exactly one query. Each repo settles independently to `ready` (with its
 * count and score) or `error`, a generation ref guards against out-of-order
 * responses when the token changes mid-flight, and a missing token (or empty
 * fleet) yields a stable empty map.
 *
 * This replaces the stub and edits nothing shared — `useRepoSignals` composes
 * it exactly as before.
 */

/**
 * Days of inactivity after which an open PR or issue counts as stale. Issue
 * #17's single tunable: raise it for slower-moving fleets, lower it for
 * stricter hygiene. Applied to both PRs and issues so one query covers a repo.
 */
export const STALE_THRESHOLD_DAYS = 30;

/**
 * Items requested from the same per-repo Search call. The page is widened from
 * 1 to this bound (still one call per repo) and sorted newest-stale-first so the
 * Notifications Inbox can read each stale item's identity without any extra
 * request; `total_count` continues to drive the tally regardless of this cap.
 */
export const STALE_ITEMS_PER_REPO = 30;

/** Separator for the repo-set effect key (repo names can't contain it). */
const KEY_SEPARATOR = '\n';

/** Shared stable identity for every empty result (no token / no repos). */
const EMPTY: Map<string, StaleSignalSlice> = new Map();

/**
 * One stale Search item's per-repo identity. `pull_request` is GitHub's marker
 * distinguishing a PR from an issue on the shared `search/issues` endpoint; it
 * is kept as an optional passthrough only to derive the item `type`.
 */
const StaleItemSchema = z
  .object({
    number: z.number(),
    title: z.string(),
    html_url: z.string(),
    updated_at: z.string(),
    pull_request: z.unknown().optional(),
  })
  .passthrough();

/**
 * Minimal Search response schema (local to this hook). `.passthrough()` keeps
 * the many unused Search fields from breaking validation; `total_count` is the
 * per-repo stale tally and the now-widened `items` carry each stale item's
 * identity (optional so a count-only payload still validates).
 */
const StaleSearchResponseSchema = z
  .object({
    total_count: z.number(),
    items: z.array(StaleItemSchema).optional(),
  })
  .passthrough();

/**
 * The inactivity cutoff as a UTC `YYYY-MM-DD` date: open items not updated on
 * or after this day are stale. Computed in UTC so the query is deterministic
 * regardless of the viewer's local time zone.
 */
export function staleCutoffDate(now: Date, days: number = STALE_THRESHOLD_DAYS): string {
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return cutoff.toISOString().slice(0, 10);
}

/**
 * Absolute Search URL counting a repo's open PRs + issues with no update since
 * `cutoffDate` (one call per repo; `total_count` is the stale tally). The page
 * is widened to {@link STALE_ITEMS_PER_REPO} and sorted by `updated` descending
 * so the same single call also returns the newest stale items' identity.
 */
export function staleSearchUrl(owner: string, name: string, cutoffDate: string): string {
  const query = `repo:${owner}/${name} is:open updated:<${cutoffDate}`;
  return (
    `${GITHUB_API_BASE}/search/issues?q=${encodeURIComponent(query)}` +
    `&per_page=${STALE_ITEMS_PER_REPO}&sort=updated&order=desc`
  );
}

/**
 * Builds the ready slice for a repo's stale tally. The score is the raw count
 * so the column sorts most-neglected repos first and the count feeds the future
 * composite "most broken" score (#18). `staleItems` un-projects each returned
 * item's identity (from the same call) for the Notifications Inbox; it is
 * omitted when the page returned none.
 */
export function readyStaleSlice(
  staleCount: number,
  staleItems: StaleItem[] = [],
): StaleSignalSlice {
  const slice: StaleSignalSlice = { status: 'ready', staleCount, score: staleCount };
  if (staleItems.length > 0) {
    slice.staleItems = staleItems;
  }
  return slice;
}

/**
 * Resolves the count of stale (no-recent-activity) open PRs and issues for each
 * repo and exposes it as a per-repo {@link StaleSignalSlice} map keyed by
 * `nameWithOwner`.
 *
 * Each repo starts `loading`, then settles to `ready` (with its stale count and
 * score) or `error`, updating independently as its request resolves. A
 * generation ref guards against out-of-order responses when the token changes
 * mid-flight, and a missing token (or empty fleet) yields a stable empty map.
 *
 * @param repos - Repositories to resolve stale counts for.
 * @param token - Auth token; `null` short-circuits to an empty map.
 */
export function useStaleSignal(repos: Repo[], token: string | null): Map<string, StaleSignalSlice> {
  const [slices, setSlices] = useState<Map<string, StaleSignalSlice>>(EMPTY);
  const generationRef = useRef(0);
  // Mirror the latest repos into a ref so the effect can read them without
  // depending on the array's identity (a caller passing a fresh array with the
  // same repos each render must not trigger a refetch loop).
  const reposRef = useRef(repos);
  reposRef.current = repos;

  // Re-run only when the *set* of repos changes, not on every new array.
  const repoSignature = repos.map((repo) => repo.nameWithOwner).join(KEY_SEPARATOR);

  useEffect(() => {
    const generation = (generationRef.current += 1);
    const currentRepos = reposRef.current;

    if (!token || currentRepos.length === 0) {
      setSlices(EMPTY);
      return;
    }

    // One controller per run: cleanup (or a repos/token change) aborts every
    // in-flight request so superseded work stops instead of racing to set state.
    const controller = new AbortController();

    const cutoffDate = staleCutoffDate(new Date());

    setSlices(
      new Map<string, StaleSignalSlice>(
        currentRepos.map((repo): [string, StaleSignalSlice] => [
          repo.nameWithOwner,
          { status: 'loading' },
        ]),
      ),
    );

    void mapWithConcurrency(
      currentRepos,
      SIGNAL_FETCH_CONCURRENCY,
      async (repo, signal) => {
        try {
          // Route every per-repo Search call through the shared Search limiter
          // so the fleet stays inside GitHub's ~30 req/min Search budget and a
          // transient secondary-limit 403 is retried instead of erroring (#495).
          const data = await scheduleSearchRequest(
            () =>
              fetchWithETag(
                staleSearchUrl(repo.owner, repo.name, cutoffDate),
                StaleSearchResponseSchema,
                {
                  token,
                  context: 'useStaleSignal',
                  signal,
                },
              ),
            signal,
          );
          if (generation !== generationRef.current) {
            return;
          }
          const staleItems: StaleItem[] = (data.items ?? []).map((item) => ({
            number: item.number,
            title: item.title,
            html_url: item.html_url,
            updated_at: item.updated_at,
            type: item.pull_request ? 'pr' : 'issue',
          }));
          setSlices((prev) => {
            const next = new Map(prev);
            next.set(repo.nameWithOwner, readyStaleSlice(data.total_count, staleItems));
            return next;
          });
        } catch (err) {
          // A cancelled request is not a failure: stay quiet (no log, no error).
          if (signal?.aborted || isAbortError(err)) return;
          console.error(
            `useStaleSignal: failed to fetch stale count for ${repo.nameWithOwner}`,
            err,
          );
          if (generation !== generationRef.current) {
            return;
          }
          setSlices((prev) => {
            const next = new Map(prev);
            next.set(repo.nameWithOwner, { status: 'error' });
            return next;
          });
        }
      },
      controller.signal,
    );

    return () => controller.abort();
  }, [repoSignature, token]);

  return slices;
}
