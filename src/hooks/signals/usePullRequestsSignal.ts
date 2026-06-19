import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';

import { fetchWithETag, GITHUB_API_BASE } from '../../api/github';
import type { PullRequestsSignalSlice, Repo } from '../../types/fleet';

/**
 * `author_association` values GitHub assigns to a PR author who is NOT a member,
 * owner, or collaborator — i.e. a *new* outside contributor. `CONTRIBUTOR`
 * (a returning external contributor) is deliberately excluded: this signal
 * highlights brand-new arrivals that most warrant a maintainer's attention.
 */
const OUTSIDE_CONTRIBUTOR_ASSOCIATIONS = new Set([
  'FIRST_TIME_CONTRIBUTOR',
  'FIRST_TIMER',
  'NONE',
  'MANNEQUIN',
]);

/**
 * Minimal shape of a `GET /repos/{owner}/{repo}/pulls` item. Validated locally
 * (this hook owns the endpoint) and `.passthrough()`-tolerant of GitHub's many
 * other fields. `draft` is optional because only pull requests carry it and a
 * defensive parse should not reject a payload that happens to omit it.
 */
const OpenPullRequestSchema = z
  .object({
    number: z.number(),
    user: z.object({ login: z.string() }).passthrough().nullable(),
    author_association: z.string(),
    draft: z.boolean().optional(),
    html_url: z.string(),
  })
  .passthrough();

const OpenPullRequestsSchema = z.array(OpenPullRequestSchema);

type OpenPullRequest = z.infer<typeof OpenPullRequestSchema>;

/**
 * Reduces a repo's open pull requests to its signal slice. Draft PRs are
 * excluded from both counts — they are work-in-progress, not awaiting review —
 * so `externalCount` is always a subset of `openCount`. The score weights each
 * new-contributor PR five times heavier than a routine open PR, floating repos
 * with fresh outside contributions to the top of a descending sort.
 */
function summarize(pulls: OpenPullRequest[]): PullRequestsSignalSlice {
  const open = pulls.filter((pull) => pull.draft !== true);
  const externalCount = open.filter((pull) =>
    OUTSIDE_CONTRIBUTOR_ASSOCIATIONS.has(pull.author_association),
  ).length;
  const openCount = open.length;
  return {
    status: 'ready',
    openCount,
    externalCount,
    score: externalCount * 5 + openCount,
  };
}

/**
 * Open / new-contributor pull-requests signal.
 *
 * Fetches each repo's open pull requests (one ETag-cached request per repo) and
 * emits a {@link PullRequestsSignalSlice} keyed by `nameWithOwner`, transitioning
 * `loading` → `ready` | `error` per repo. A generation ref discards responses
 * from a superseded token or repo set (mirrors {@link useRepos}); `token === null`
 * yields an empty map without any network calls.
 */
export function usePullRequestsSignal(
  repos: Repo[],
  token: string | null,
): Map<string, PullRequestsSignalSlice> {
  const [slices, setSlices] = useState<Map<string, PullRequestsSignalSlice>>(() => new Map());
  const generationRef = useRef(0);

  useEffect(() => {
    const generation = (generationRef.current += 1);

    if (!token) {
      setSlices(new Map());
      return;
    }

    setSlices(
      new Map(
        repos.map((repo): [string, PullRequestsSignalSlice] => [
          repo.nameWithOwner,
          { status: 'loading' },
        ]),
      ),
    );

    for (const repo of repos) {
      const url = `${GITHUB_API_BASE}/repos/${repo.owner}/${repo.name}/pulls?state=open&per_page=100`;

      fetchWithETag(url, OpenPullRequestsSchema, { token })
        .then((pulls) => {
          if (generation !== generationRef.current) return;
          setSlices((prev) => new Map(prev).set(repo.nameWithOwner, summarize(pulls)));
        })
        .catch(() => {
          if (generation !== generationRef.current) return;
          setSlices((prev) => new Map(prev).set(repo.nameWithOwner, { status: 'error' }));
        });
    }
  }, [repos, token]);

  return slices;
}
