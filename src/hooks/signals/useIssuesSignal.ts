import { useEffect, useRef, useState } from 'react';

import { fetchIssueCount } from '../../api/github';
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
 */
function readySlice(openCount: number): IssuesSignalSlice {
  const overThreshold = openCount >= ISSUE_TRIAGE_THRESHOLD;
  return {
    status: 'ready',
    openCount,
    overThreshold,
    score: overThreshold ? openCount : Math.floor(openCount / 4),
  };
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
 * @param repos - Repositories to resolve issue counts for.
 * @param token - Auth token; `null` short-circuits to an empty map.
 */
export function useIssuesSignal(
  repos: Repo[],
  token: string | null,
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

    setSlices(
      new Map<string, IssuesSignalSlice>(
        currentRepos.map((repo): [string, IssuesSignalSlice] => [
          repo.nameWithOwner,
          { status: 'loading' },
        ]),
      ),
    );

    for (const repo of currentRepos) {
      // `fetchIssueCount(..., 'open')` returns open_issues_count minus open PRs,
      // so the value we surface excludes pull requests by construction.
      fetchIssueCount(repo.owner, repo.name, token, 'open')
        .then((openCount) => {
          if (generation !== generationRef.current) {
            return;
          }
          setSlices((prev) => {
            const next = new Map(prev);
            next.set(repo.nameWithOwner, readySlice(openCount));
            return next;
          });
        })
        .catch(() => {
          if (generation !== generationRef.current) {
            return;
          }
          setSlices((prev) => {
            const next = new Map(prev);
            next.set(repo.nameWithOwner, { status: 'error' });
            return next;
          });
        });
    }
  }, [repoSignature, token]);

  return slices;
}
