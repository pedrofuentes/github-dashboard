import { useEffect, useRef, useState } from 'react';

import { SIGNAL_FETCH_CONCURRENCY, mapWithConcurrency } from '../../api/concurrency';
import { fetchIssueCount, fetchViewerIssueCount } from '../../api/github';
import { isAbortError } from '../../lib/abort';
import type { IssuesSignalSlice, Repo } from '../../types/fleet';

/**
 * Open-issue count at or above which a repo is flagged for triage. Issue #16's
 * single tunable: raise it for noisier fleets, lower it for stricter hygiene.
 */
export const ISSUE_TRIAGE_THRESHOLD = 20;

/** Shared stable identity for every empty result (no token / no repos). */
const EMPTY: Map<string, IssuesSignalSlice> = new Map();

/**
 * Builds the ready slice for a repo's open-issue count.
 *
 * Issues are lower urgency than CI or security, so a healthy backlog only
 * contributes a quarter of its size to the composite "most broken" sort; a repo
 * at or over the triage threshold escalates to its full open count.
 *
 * When `mineCount` is supplied (a viewer login was present), the open count is
 * split into viewer-authored (`mineCount`) and community (`communityCount`)
 * issues. Triage banding (`overThreshold`/`score`) stays keyed to the TOTAL
 * `openCount`, never the community remainder.
 */
function readySlice(openCount: number, mineCount?: number): IssuesSignalSlice {
  const overThreshold = openCount >= ISSUE_TRIAGE_THRESHOLD;
  const slice: IssuesSignalSlice = {
    status: 'ready',
    openCount,
    overThreshold,
    score: overThreshold ? openCount : Math.floor(openCount / 4),
  };
  if (mineCount !== undefined) {
    slice.mineCount = mineCount;
    slice.communityCount = Math.max(openCount - mineCount, 0);
  }
  return slice;
}

/**
 * Resolves the open-issue count (pull requests excluded) for each repo and
 * exposes it as a per-repo {@link IssuesSignalSlice} map keyed by
 * `nameWithOwner`.
 *
 * Each repo starts `loading`, then settles to `ready` (with its count, triage
 * flag, and score) or `error`, updating independently as its request resolves.
 * A generation ref guards against out-of-order responses when the token
 * changes mid-flight, and a missing token (or empty fleet) yields a stable
 * empty map.
 *
 * When `token` and a non-empty `viewerLogin` are both present, each repo also
 * fetches the viewer's own open-issue count in parallel (sharing the repo's
 * AbortController and generation guard), splitting the ready slice into
 * `mineCount` / `communityCount`. With no viewer login those fields stay
 * undefined and the slice is otherwise unchanged.
 *
 * @param repos - Repositories to resolve issue counts for.
 * @param token - Auth token; `null` short-circuits to an empty map.
 * @param viewerLogin - Authenticated viewer's login; when absent (null/empty)
 *   the mine/community split is skipped.
 */
export function useIssuesSignal(
  repos: Repo[],
  token: string | null,
  viewerLogin?: string | null,
): Map<string, IssuesSignalSlice> {
  const [slices, setSlices] = useState<Map<string, IssuesSignalSlice>>(EMPTY);
  const generationRef = useRef(0);
  // Mirror the latest repos into a ref so the effect can read them without
  // depending on the array's identity (a caller passing a fresh array with the
  // same repos each render must not trigger a refetch loop).
  const reposRef = useRef(repos);
  reposRef.current = repos;

  // Re-run only when the *set* of repos changes, not on every new array.
  const repoSignature = repos.map((repo) => repo.nameWithOwner).join('\n');

  useEffect(() => {
    const generation = (generationRef.current += 1);
    const currentRepos = reposRef.current;

    if (!token || currentRepos.length === 0) {
      setSlices(EMPTY);
      return;
    }

    // An empty (or absent) login means "no split": fetch only the total count.
    const login = viewerLogin ? viewerLogin : null;

    // One controller per run: cleanup (or a repos/token change) aborts every
    // in-flight request so superseded work stops instead of racing to set state.
    const controller = new AbortController();

    setSlices(
      new Map<string, IssuesSignalSlice>(
        currentRepos.map((repo): [string, IssuesSignalSlice] => [
          repo.nameWithOwner,
          { status: 'loading' },
        ]),
      ),
    );

    void mapWithConcurrency(
      currentRepos,
      SIGNAL_FETCH_CONCURRENCY,
      async (repo, signal) => {
        // `fetchIssueCount(..., 'open')` returns open_issues_count minus open PRs,
        // so the value we surface excludes pull requests by construction. When a
        // viewer login is present, the viewer's own count is fetched alongside it
        // (same signal) so the two requests share this repo's concurrency slot.
        try {
          const [openCount, mineCount] = await Promise.all([
            fetchIssueCount(repo.owner, repo.name, token, 'open', signal),
            login ? fetchViewerIssueCount(repo.owner, repo.name, login, token, signal) : undefined,
          ]);
          if (generation !== generationRef.current) {
            return;
          }
          setSlices((prev) => {
            const next = new Map(prev);
            next.set(repo.nameWithOwner, readySlice(openCount, mineCount));
            return next;
          });
        } catch (err) {
          // A cancelled request is not a failure: stay quiet (no log, no error).
          if (signal?.aborted || isAbortError(err)) return;
          console.error(
            `useIssuesSignal: failed to fetch issue count for ${repo.nameWithOwner}`,
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
  }, [repoSignature, token, viewerLogin]);

  return slices;
}
