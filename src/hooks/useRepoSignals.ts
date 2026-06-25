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

import type { FleetBatchResult } from '../api/github/fleet-query';
import type { TileSignalType } from '../types/dashboard';
import type {
  CiSignalSlice,
  GetRowData,
  IssuesSignalSlice,
  PullRequestsSignalSlice,
  Repo,
  ReviewsSignalSlice,
  SignalSlice,
  StaleSignalSlice,
} from '../types/fleet';
import { graphqlSignalEnabled } from '../lib/graphql-flags';
import { useCiSignal } from './signals/useCiSignal';
import { useIssuesSignal } from './signals/useIssuesSignal';
import { usePullRequestsSignal } from './signals/usePullRequestsSignal';
import { useReviewsSignal } from './signals/useReviewsSignal';
import { useSecuritySignal } from './signals/useSecuritySignal';
import { useStaleSignal } from './signals/useStaleSignal';
import { useFleetBatchLoader } from './useFleetBatchLoader';
import { useVisibilityRevalidate } from './useVisibilityRevalidate';

/** Public shape returned by {@link useRepoSignals}. */
export interface UseRepoSignalsResult {
  /** Resolves the composed signal payload for a single repo row. */
  getRowData: GetRowData;
}

/**
 * Builds a signal override map for a GraphQL-migrated signal.
 *
 * - Flag OFF → `undefined`: the signal hook uses its normal REST fan-out.
 * - Flag ON, batch loading → per-repo `{ status: 'loading' }` map: the hook
 *   short-circuits its REST fan-out and surfaces loading cells immediately.
 * - Flag ON, batch settled → the resolved slice map (empty map when the signal
 *   is absent from the result): REST is permanently suppressed.
 */
function buildSignalOverride<T extends SignalSlice>(
  signal: TileSignalType,
  loading: boolean,
  result: FleetBatchResult,
  repos: Repo[],
): Map<string, T> | undefined {
  if (!graphqlSignalEnabled(signal)) return undefined;
  if (loading) {
    return new Map(repos.map((repo) => [repo.nameWithOwner, { status: 'loading' } as T]));
  }
  return (result.get(signal) as Map<string, T> | undefined) ?? new Map<string, T>();
}

/**
 * Aggregates every per-repo signal into a grid-ready {@link GetRowData}.
 *
 * @param repos - Repositories to resolve signals for (passed to each hook).
 * @param token - Auth token forwarded to each signal hook (may be `null`).
 * @param viewerLogin - Authenticated viewer's login, forwarded only to the
 *   issues signal so it can split open issues into "mine" vs "community"
 *   (`null` when unauthenticated).
 */
export function useRepoSignals(
  repos: Repo[],
  token: string | null,
  viewerLogin?: string | null,
): UseRepoSignalsResult {
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

  // One batched GraphQL query covers every GraphQL-enabled signal. For each
  // migrated signal, build an override with:
  //   const xOverride = buildSignalOverride<XSlice>('x', batch.loading, batch.result, revalidatedRepos)
  // then pass it to useXSignal. When the flag is ON, the override is always
  // defined: a per-repo loading-slice map while the batch is in-flight, the
  // settled batch result afterward — so the signal hook NEVER falls through to
  // REST. When the flag is OFF, undefined is returned and REST is used.
  const batch = useFleetBatchLoader(revalidatedRepos, token, viewerLogin);

  const ciOverride = buildSignalOverride<CiSignalSlice>(
    'ci',
    batch.loading,
    batch.result,
    revalidatedRepos,
  );

  const issuesOverride = buildSignalOverride<IssuesSignalSlice>(
    'issues',
    batch.loading,
    batch.result,
    revalidatedRepos,
  );

  const pullRequestsOverride = buildSignalOverride<PullRequestsSignalSlice>(
    'pullRequests',
    batch.loading,
    batch.result,
    revalidatedRepos,
  );

  const staleOverride = buildSignalOverride<StaleSignalSlice>(
    'stale',
    batch.loading,
    batch.result,
    revalidatedRepos,
  );

  const reviewsOverride = buildSignalOverride<ReviewsSignalSlice>(
    'reviews',
    batch.loading,
    batch.result,
    revalidatedRepos,
  );

  const ci = useCiSignal(revalidatedRepos, token, ciOverride);
  const security = useSecuritySignal(revalidatedRepos, token);
  const reviews = useReviewsSignal(revalidatedRepos, token, reviewsOverride);
  const pullRequests = usePullRequestsSignal(revalidatedRepos, token, pullRequestsOverride);
  const issues = useIssuesSignal(revalidatedRepos, token, viewerLogin, issuesOverride);
  const stale = useStaleSignal(revalidatedRepos, token, staleOverride);

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
