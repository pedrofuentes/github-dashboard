/**
 * `useCommitActivity` — a lazy, single-shot React hook over
 * {@link fetchCommitActivity} for the Activity tile (DESIGN-TILES §4.7).
 *
 * On mount (and whenever the `repo` or auth `token` changes) it reads the PAT
 * from the auth context and fetches the repo's weekly commit activity, exposing
 * the outcome as a discriminated {@link CommitActivityState}. The fetcher's
 * four-way result is normalised for the view: `ok`/`not-modified` both collapse
 * to `ok` (the cached weeks are equivalent to a fresh `200`), while `computing`
 * and `empty` pass through and a thrown {@link GitHubApiError} (or any rejection)
 * becomes `error`.
 *
 * Cancellation: one {@link AbortController} per effect run aborts the in-flight
 * request on unmount or on a `repo`/`token` change, so a superseded fetch never
 * lands stale state. A late resolution after abort is ignored.
 *
 * Laziness: this hook is standalone — it is NOT wired into the fleet poll, so it
 * only fetches for the single repo it is mounted with, and only the once per
 * input change (no aggressive polling). Bounded `202` retry is delegated to
 * {@link fetchCommitActivity} via {@link UseCommitActivityOptions}.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */
import { useEffect, useState } from 'react';

import { fetchCommitActivity, type CommitActivityWeek } from '../api/github/commit-activity';
import type { ETagCache } from '../api/github/etag-cache';
import { isAbortError } from '../lib/abort';
import type { Repo } from '../types/fleet';
import { useAuth } from './useAuth';

/**
 * The view-facing state of {@link useCommitActivity}, modelled as a
 * discriminated union so the Activity tile exhaustively handles every outcome:
 *
 * - `loading` — the initial fetch is in flight (or restarting on input change).
 * - `ok` — validated weekly history (from a fresh `200` or a conditional `304`).
 * - `computing` — GitHub is still building the stats (`202`); render a hint.
 * - `empty` — the repo has no commits in the window.
 * - `error` — the fetch threw; `error` carries the original cause.
 */
export type CommitActivityState =
  | { state: 'loading' }
  | { state: 'ok'; weeks: CommitActivityWeek[] }
  | { state: 'computing' }
  | { state: 'empty' }
  | { state: 'error'; error: unknown };

/** Optional knobs forwarded to {@link fetchCommitActivity}. */
export interface UseCommitActivityOptions {
  /**
   * Conditional-request cache. Injectable so callers can share a single cache
   * (and tests get isolated cache state); defaults to the fetcher's own cache.
   */
  cache?: ETagCache;
  /** Max bounded retries when GitHub replies `202` (computing). Defaults to 0. */
  maxComputingRetries?: number;
  /** Base backoff between `202` retries, in ms. Defaults to the fetcher's. */
  computingRetryDelayMs?: number;
}

/**
 * Lazily fetch a repository's weekly commit activity for the Activity tile.
 *
 * @param repo - The repository whose commit activity to fetch.
 * @param options - Optional cache injection and bounded `202` retry config.
 * @returns The current {@link CommitActivityState}.
 */
export function useCommitActivity(
  repo: Repo,
  options: UseCommitActivityOptions = {},
): CommitActivityState {
  const { token } = useAuth();
  const [state, setState] = useState<CommitActivityState>({ state: 'loading' });

  const { cache, maxComputingRetries, computingRetryDelayMs } = options;
  const { owner, name } = repo;

  useEffect(() => {
    const controller = new AbortController();
    setState({ state: 'loading' });

    fetchCommitActivity(owner, name, token ?? undefined, {
      signal: controller.signal,
      cache,
      maxComputingRetries,
      computingRetryDelayMs,
    })
      .then((result) => {
        if (controller.signal.aborted) return;
        switch (result.status) {
          case 'ok':
          case 'not-modified':
            setState({ state: 'ok', weeks: result.weeks });
            break;
          case 'computing':
            setState({ state: 'computing' });
            break;
          case 'empty':
            setState({ state: 'empty' });
            break;
        }
      })
      .catch((error: unknown) => {
        // A cancelled request is not a failure: leave the superseded run silent.
        if (controller.signal.aborted || isAbortError(error)) return;
        setState({ state: 'error', error });
      });

    return () => controller.abort();
  }, [owner, name, token, cache, maxComputingRetries, computingRetryDelayMs]);

  return state;
}
