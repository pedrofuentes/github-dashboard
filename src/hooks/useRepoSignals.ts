/**
 * Per-repo signal aggregation — the single seam between the fleet grid and the
 * six parallel signal features (#12-17).
 *
 * This hook calls each signal hook once (so every feature owns exactly one
 * `useXSignal` + one column file and edits nothing shared), then folds the six
 * `Map<nameWithOwner, slice>` results into a memoized `getRowData(repo)` that
 * the grid consumes. `getRowData` keeps a stable identity while its inputs are
 * unchanged, so the grid doesn't re-sort or re-render on every parent render.
 *
 * When the tab returns to `visible`, a throttled revalidation (via
 * {@link useVisibilityRevalidate}) hands each signal hook a fresh `repos`
 * reference so their conditional (`If-None-Match`) effects re-run — refreshing
 * data that went stale in the background with mostly-free `304`s — without
 * changing this hook's public return shape or any signal hook's logic.
 */
import { useMemo, useState } from 'react';

import type { GetRowData, Repo } from '../types/fleet';
import { useCiSignal } from './signals/useCiSignal';
import { useIssuesSignal } from './signals/useIssuesSignal';
import { usePullRequestsSignal } from './signals/usePullRequestsSignal';
import { useReviewsSignal } from './signals/useReviewsSignal';
import { useSecuritySignal } from './signals/useSecuritySignal';
import { useStaleSignal } from './signals/useStaleSignal';
import { useVisibilityRevalidate } from './useVisibilityRevalidate';

/** Public shape returned by {@link useRepoSignals}. */
export interface UseRepoSignalsResult {
  /** Resolves the composed signal payload for a single repo row. */
  getRowData: GetRowData;
}

/**
 * Aggregates every per-repo signal into a grid-ready {@link GetRowData}.
 *
 * @param repos - Repositories to resolve signals for (passed to each hook).
 * @param token - Auth token forwarded to each signal hook (may be `null`).
 */
export function useRepoSignals(repos: Repo[], token: string | null): UseRepoSignalsResult {
  // Bumping this nonce on foreground hands the signal hooks a new `repos`
  // identity, re-running their conditional fetches without touching their logic.
  const [revalidateNonce, setRevalidateNonce] = useState(0);
  useVisibilityRevalidate(() => setRevalidateNonce((n) => n + 1));

  // A fresh array reference per revalidation (but stable across unrelated
  // re-renders) so each signal hook's `[repos, token]` effect re-runs only when
  // `repos` actually changes or the tab returns to visible. `revalidateNonce` is
  // an intentional trigger (bumped on foreground), not read inside the factory.
  const revalidatedRepos = useMemo(
    () => repos.slice(),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- revalidateNonce is an intentional trigger
    [repos, revalidateNonce],
  );

  const ci = useCiSignal(revalidatedRepos, token);
  const security = useSecuritySignal(revalidatedRepos, token);
  const reviews = useReviewsSignal(revalidatedRepos, token);
  const pullRequests = usePullRequestsSignal(revalidatedRepos, token);
  const issues = useIssuesSignal(revalidatedRepos, token);
  const stale = useStaleSignal(revalidatedRepos, token);

  const getRowData = useMemo<GetRowData>(
    () => (repo: Repo) => ({
      ci: ci.get(repo.nameWithOwner),
      security: security.get(repo.nameWithOwner),
      reviews: reviews.get(repo.nameWithOwner),
      pullRequests: pullRequests.get(repo.nameWithOwner),
      issues: issues.get(repo.nameWithOwner),
      stale: stale.get(repo.nameWithOwner),
    }),
    [ci, security, reviews, pullRequests, issues, stale],
  );

  return { getRowData };
}
