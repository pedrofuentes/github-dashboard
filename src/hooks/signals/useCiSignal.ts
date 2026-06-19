/**
 * CI signal — owned by issue #12 (failing GitHub Actions).
 *
 * Fetches the latest workflow run for each repo's default branch and folds it
 * into one {@link CiSignalSlice} per repo, keyed by `nameWithOwner`. Each entry
 * transitions `loading` → `ready`/`error` as its request settles, and the
 * `score` is shaped so failing repos sort above everything else under the
 * column's default descending sort (failure = 100, running/queued = 10,
 * passing / no-runs = 0).
 *
 * Requests go through {@link fetchWithETag}, so they are conditional
 * (`If-None-Match`) — a `304` is free against the primary rate limit — and are
 * Zod-validated and origin-checked (GitHub API only) before use. A generation
 * ref guards against out-of-order responses when `repos`/`token` change, mirror-
 * ing {@link useRepos}. With no token (or no repos) the hook returns a stable
 * empty map so the column renders its placeholder and composes cleanly.
 */
import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';

import { SIGNAL_FETCH_CONCURRENCY, mapWithConcurrency } from '../../api/concurrency';
import { GITHUB_API_BASE, fetchWithETag } from '../../api/github';
import { isAbortError } from '../../lib/abort';
import type { CiSignalSlice, Repo } from '../../types/fleet';

/** The subset of a workflow run we read from `GET /actions/runs`. */
const CiRunSchema = z.object({
  status: z.string().nullable().optional(),
  conclusion: z.string().nullable().optional(),
  html_url: z.string().optional(),
  name: z.string().nullable().optional(),
});

/** Local schema for the latest-run probe (`?per_page=1`). */
const CiRunsResponseSchema = z.object({
  total_count: z.number().optional(),
  workflow_runs: z.array(CiRunSchema),
});

type CiRunsResponse = z.infer<typeof CiRunsResponseSchema>;

/** Failing repos must outrank everything else under the default desc sort. */
const SCORE_FAILING = 100;
const SCORE_RUNNING = 10;
const SCORE_NEUTRAL = 0;

/** Conclusions that mean "the latest run is broken". */
const FAILING_CONCLUSIONS = new Set(['failure', 'timed_out', 'startup_failure']);

/** Stable identity returned whenever the signal is idle (no token / no repos). */
const EMPTY_CI_SIGNALS: Map<string, CiSignalSlice> = new Map();

/** Translates the latest-run response into a single CI slice. */
function summarize(data: CiRunsResponse): CiSignalSlice {
  const run = data.workflow_runs[0];
  if (!run) {
    return { status: 'ready', conclusion: 'none', score: SCORE_NEUTRAL, failingCount: 0 };
  }

  const latestRunUrl = run.html_url;
  const rawStatus = run.status ?? '';
  const rawConclusion = run.conclusion ?? '';

  // A run that has not `completed` is still in flight (queued / in_progress).
  if (rawStatus && rawStatus !== 'completed') {
    const conclusion = rawStatus === 'in_progress' ? 'in_progress' : 'queued';
    return { status: 'ready', conclusion, score: SCORE_RUNNING, failingCount: 0, latestRunUrl };
  }

  if (FAILING_CONCLUSIONS.has(rawConclusion)) {
    return {
      status: 'ready',
      conclusion: 'failure',
      score: SCORE_FAILING,
      failingCount: 1,
      latestRunUrl,
    };
  }

  if (rawConclusion === 'success') {
    return {
      status: 'ready',
      conclusion: 'success',
      score: SCORE_NEUTRAL,
      failingCount: 0,
      latestRunUrl,
    };
  }

  // cancelled / skipped / neutral / null → no actionable CI signal.
  return {
    status: 'ready',
    conclusion: 'none',
    score: SCORE_NEUTRAL,
    failingCount: 0,
    latestRunUrl,
  };
}

/** Builds the latest-run probe URL for a repo. */
function runsUrl(repo: Repo): string {
  const owner = encodeURIComponent(repo.owner);
  const name = encodeURIComponent(repo.name);
  return `${GITHUB_API_BASE}/repos/${owner}/${name}/actions/runs?per_page=1`;
}

/**
 * Resolves the latest CI status for each repo.
 *
 * @param repos - Repositories to resolve CI status for.
 * @param token - Auth token; `null` yields a stable empty map (no requests).
 * @returns A map of `nameWithOwner` → {@link CiSignalSlice}.
 */
export function useCiSignal(repos: Repo[], token: string | null): Map<string, CiSignalSlice> {
  const [signals, setSignals] = useState<Map<string, CiSignalSlice>>(EMPTY_CI_SIGNALS);
  const generationRef = useRef(0);

  useEffect(() => {
    const generation = (generationRef.current += 1);

    if (!token || repos.length === 0) {
      setSignals(EMPTY_CI_SIGNALS);
      return;
    }

    // One controller per run: cleanup (or a repos/token change) aborts every
    // in-flight request so superseded work stops instead of racing to set state.
    const controller = new AbortController();

    // Seed every row as loading so the column shows progress immediately.
    setSignals(
      new Map<string, CiSignalSlice>(
        repos.map((repo): [string, CiSignalSlice] => [repo.nameWithOwner, { status: 'loading' }]),
      ),
    );

    const update = (key: string, slice: CiSignalSlice) => {
      if (generation !== generationRef.current) {
        return;
      }
      setSignals((prev) => {
        const next = new Map(prev);
        next.set(key, slice);
        return next;
      });
    };

    void mapWithConcurrency(
      repos,
      SIGNAL_FETCH_CONCURRENCY,
      async (repo, signal) => {
        try {
          const data = await fetchWithETag(runsUrl(repo), CiRunsResponseSchema, {
            token,
            context: `useCiSignal ${repo.nameWithOwner}`,
            signal,
          });
          update(repo.nameWithOwner, summarize(data));
        } catch (err) {
          // A cancelled request is not a failure: stay quiet (no log, no error).
          if (signal?.aborted || isAbortError(err)) return;
          console.error(`useCiSignal: failed to fetch CI status for ${repo.nameWithOwner}`, err);
          update(repo.nameWithOwner, { status: 'error' });
        }
      },
      controller.signal,
    );

    return () => controller.abort();
  }, [repos, token]);

  return signals;
}
