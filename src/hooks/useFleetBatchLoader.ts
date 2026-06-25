/**
 * Batched GraphQL fleet-query loader hook.
 *
 * Wraps {@link executeFleetBatch} with the same generation-ref + AbortController
 * guard pattern used by `useCiSignal`, so stale resolves from superseded
 * `repos`/`token`/`viewerLogin` combinations never clobber a fresh result.
 *
 * Consumed by {@link useRepoSignals}, which picks per-signal slices from the
 * result and passes them as overrides to the relevant `useXSignal` hooks when
 * the corresponding {@link graphqlSignalEnabled} flag is on.
 */
import { useEffect, useRef, useState } from 'react';

import { executeFleetBatch, type FleetBatchResult } from '../api/github/fleet-query';
import { isAbortError } from '../lib/abort';
import type { Repo } from '../types/fleet';

/** Stable empty result returned whenever the hook is idle (no token / no repos). */
const EMPTY_RESULT: FleetBatchResult = new Map();

/** Return shape of {@link useFleetBatchLoader}. */
export interface UseFleetBatchLoaderResult {
  /** The latest settled batch result, keyed by signal then by `nameWithOwner`. */
  result: FleetBatchResult;
  /** `true` while a batch request is in-flight. */
  loading: boolean;
}

const IDLE: UseFleetBatchLoaderResult = { result: EMPTY_RESULT, loading: false };

/**
 * Executes a registry-driven batched GraphQL fleet query and exposes the
 * result + loading state. Mirrors `useCiSignal`'s generation-ref guard so
 * stale resolves from superseded inputs are silently dropped.
 *
 * @param repos      - Repositories to query.
 * @param token      - GitHub auth token; `null` yields idle state (no requests).
 * @param viewerLogin - Viewer login forwarded to top-level derivers (`null` ok).
 */
export function useFleetBatchLoader(
  repos: Repo[],
  token: string | null,
  viewerLogin?: string | null,
): UseFleetBatchLoaderResult {
  const [state, setState] = useState<UseFleetBatchLoaderResult>(IDLE);
  const generationRef = useRef(0);

  useEffect(() => {
    if (!token || repos.length === 0) {
      setState(IDLE);
      return;
    }

    const generation = (generationRef.current += 1);
    const controller = new AbortController();

    setState((prev) => ({ result: prev.result, loading: true }));

    void executeFleetBatch(repos, viewerLogin ?? null, token, controller.signal)
      .then((result) => {
        if (generation !== generationRef.current || controller.signal.aborted) return;
        setState({ result, loading: false });
      })
      .catch((err: unknown) => {
        if (isAbortError(err) || controller.signal.aborted) return;
        if (generation !== generationRef.current) return;
        console.error('useFleetBatchLoader: batch fetch failed', err);
        setState(IDLE);
      });

    return () => controller.abort();
  }, [repos, token, viewerLogin]);

  return state;
}
