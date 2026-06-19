/**
 * Per-repo signal aggregation — the single seam between the fleet grid and the
 * six parallel signal features (#12-17).
 *
 * This hook calls each signal hook once (so every feature owns exactly one
 * `useXSignal` + one column file and edits nothing shared), then folds the six
 * `Map<nameWithOwner, slice>` results into a memoized `getRowData(repo)` that
 * the grid consumes. `getRowData` keeps a stable identity while its inputs are
 * unchanged, so the grid doesn't re-sort or re-render on every parent render.
 */
import { useMemo } from 'react';

import type { GetRowData, Repo } from '../types/fleet';
import { useCiSignal } from './signals/useCiSignal';
import { useIssuesSignal } from './signals/useIssuesSignal';
import { usePullRequestsSignal } from './signals/usePullRequestsSignal';
import { useReviewsSignal } from './signals/useReviewsSignal';
import { useSecuritySignal } from './signals/useSecuritySignal';
import { useStaleSignal } from './signals/useStaleSignal';

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
  const ci = useCiSignal(repos, token);
  const security = useSecuritySignal(repos, token);
  const reviews = useReviewsSignal(repos, token);
  const pullRequests = usePullRequestsSignal(repos, token);
  const issues = useIssuesSignal(repos, token);
  const stale = useStaleSignal(repos, token);

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
