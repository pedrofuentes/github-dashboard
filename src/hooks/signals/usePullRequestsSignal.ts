import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';

import { SIGNAL_FETCH_CONCURRENCY, mapWithConcurrency } from '../../api/concurrency';
import { fetchWithETag, GITHUB_API_BASE } from '../../api/github';
import { isAbortError } from '../../lib/abort';
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
    title: z.string(),
    created_at: z.string(),
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
 *
 * `externalPullRequests` un-projects each counted external, non-draft PR's
 * identity (already in the same `/pulls?state=open` payload — no extra request),
 * in payload order, for the Notifications Inbox; it is omitted when none match.
 */
function summarize(pulls: OpenPullRequest[]): PullRequestsSignalSlice {
  const open = pulls.filter((pull) => pull.draft !== true);
  const external = open.filter((pull) =>
    OUTSIDE_CONTRIBUTOR_ASSOCIATIONS.has(pull.author_association),
  );
  const externalCount = external.length;
  const openCount = open.length;
  const slice: PullRequestsSignalSlice = {
    status: 'ready',
    openCount,
    externalCount,
    score: externalCount * 5 + openCount,
  };
  if (externalCount > 0) {
    slice.externalPullRequests = external.map((pull) => ({
      number: pull.number,
      title: pull.title,
      html_url: pull.html_url,
      created_at: pull.created_at,
      user_login: pull.user?.login ?? '',
      author_association: pull.author_association,
    }));
  }
  return slice;
}

/**
 * Open / new-contributor pull-requests signal.
 *
 * Fetches each repo's open pull requests (one ETag-cached request per repo) and
 * emits a {@link PullRequestsSignalSlice} keyed by `nameWithOwner`, transitioning
 * `loading` → `ready` | `error` per repo. A generation ref discards responses
 * from a superseded token or repo set (mirrors {@link useRepos}); `token === null`
 * yields an empty map without any network calls.
 *
 * @param repos     - Repositories to resolve pull-request status for.
 * @param token     - Auth token; `null` yields a stable empty map (no requests).
 * @param override  - When provided, the hook returns it immediately and makes
 *   zero network calls (used by {@link useRepoSignals} to inject slices from the
 *   batched GraphQL loader when the `pullRequests` flag is enabled). `undefined`
 *   restores normal REST behaviour.
 */
export function usePullRequestsSignal(
  repos: Repo[],
  token: string | null,
  override?: Map<string, PullRequestsSignalSlice>,
): Map<string, PullRequestsSignalSlice> {
  const [slices, setSlices] = useState<Map<string, PullRequestsSignalSlice>>(() => new Map());
  const generationRef = useRef(0);

  useEffect(() => {
    // When an override is supplied the caller owns the data; skip all REST work.
    if (override) return;

    const generation = (generationRef.current += 1);

    if (!token) {
      setSlices(new Map());
      return;
    }

    // One controller per run: cleanup (or a repos/token change) aborts every
    // in-flight request so superseded work stops instead of racing to set state.
    const controller = new AbortController();

    setSlices(
      new Map(
        repos.map((repo): [string, PullRequestsSignalSlice] => [
          repo.nameWithOwner,
          { status: 'loading' },
        ]),
      ),
    );

    void mapWithConcurrency(
      repos,
      SIGNAL_FETCH_CONCURRENCY,
      async (repo, signal) => {
        const url = `${GITHUB_API_BASE}/repos/${repo.owner}/${repo.name}/pulls?state=open&per_page=100`;
        try {
          const pulls = await fetchWithETag(url, OpenPullRequestsSchema, { token, signal });
          if (generation !== generationRef.current) return;
          setSlices((prev) => new Map(prev).set(repo.nameWithOwner, summarize(pulls)));
        } catch (err) {
          // A cancelled request is not a failure: stay quiet (no log, no error).
          if (signal?.aborted || isAbortError(err)) return;
          console.error(
            `usePullRequestsSignal: failed to fetch pull requests for ${repo.nameWithOwner}`,
            err,
          );
          if (generation !== generationRef.current) return;
          setSlices((prev) => new Map(prev).set(repo.nameWithOwner, { status: 'error' }));
        }
      },
      controller.signal,
    );

    return () => controller.abort();
  }, [repos, token, override]);

  return override ?? slices;
}
