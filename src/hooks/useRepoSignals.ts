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
import { useFleetBatchLoader, type UseFleetBatchLoaderResult } from './useFleetBatchLoader';
import { useVisibilityRevalidate } from './useVisibilityRevalidate';

/**
 * Stable empty Map returned for a GraphQL-enabled signal whose batch result has
 * no entry for that signal (flag ON, batch settled, signal absent). Using a
 * module-level constant keeps the Map identity stable across renders so the
 * `getRowData` memo dep doesn't churn the grid sort/filter (#540).
 */
const EMPTY_OVERRIDE: Map<string, never> = new Map<string, never>();

/**
 * Stable per-repo `{ status: 'loading' }` slice reference used in the
 * progressive loading map — prevents object allocation on every render (#540).
 */
const LOADING_SLICE: SignalSlice = { status: 'loading' };

/**
 * Signals served via the batched GraphQL layer (mirrors {@link graphql-flags.ts}).
 * Listed here so the progressive-loading memo iterates exactly this set.
 */
const GRAPHQL_SIGNAL_KEYS: TileSignalType[] = ['ci', 'reviews', 'pullRequests', 'issues', 'stale'];

/** Public shape returned by {@link useRepoSignals}. */
export interface UseRepoSignalsResult {
  /** Resolves the composed signal payload for a single repo row. */
  getRowData: GetRowData;
}

/**
 * Builds a signal override map for a GraphQL-migrated signal.
 *
 * - Flag OFF → `undefined`: the signal hook uses its normal REST fan-out.
 * - Flag ON, batch loading → the per-repo merged map from `partialLoadingMaps`:
 *   repos with a settled slice show that slice progressively; the rest show
 *   `{ status: 'loading' }` (stable reference, #540).
 * - Flag ON, batch error → the memoized per-repo `{ status: 'error' }` map
 *   (stable identity): hook surfaces error cells instead of falling through to
 *   REST (#541).
 * - Flag ON, batch settled → the resolved slice map from the batch result, or
 *   the shared {@link EMPTY_OVERRIDE} constant when the signal is absent.
 */
function buildSignalOverride<T extends SignalSlice>(
  signal: TileSignalType,
  batch: UseFleetBatchLoaderResult,
  partialLoadingMaps: Map<TileSignalType, Map<string, SignalSlice>>,
  errorMap: Map<string, SignalSlice>,
): Map<string, T> | undefined {
  if (!graphqlSignalEnabled(signal)) return undefined;
  if (batch.loading)
    return (
      (partialLoadingMaps.get(signal) as Map<string, T> | undefined) ??
      (EMPTY_OVERRIDE as Map<string, T>)
    );
  if (batch.error) return errorMap as Map<string, T>;
  return (
    (batch.result.get(signal) as Map<string, T> | undefined) ?? (EMPTY_OVERRIDE as Map<string, T>)
  );
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
  //   const xOverride = buildSignalOverride<XSlice>('x', batch, partialLoadingMaps, errorOverride)
  // then pass it to useXSignal. When the flag is ON, the override is always
  // defined: a per-repo progressive map while the batch is in-flight (settled
  // slices surfaced as they arrive, loading for the rest), the settled batch
  // result afterward — so the signal hook NEVER falls through to REST. When the
  // flag is OFF, undefined is returned and REST is used.
  const batch = useFleetBatchLoader(revalidatedRepos, token, viewerLogin);

  // Per-signal merged loading maps for the progressive fill: repos that have a
  // settled batch slice show it immediately; the rest show LOADING_SLICE.
  // Memoized on [batch.result, batch.loading, revalidatedRepos] so the same Map
  // reference is returned on every render while inputs are unchanged — preventing
  // getRowData from seeing a new dep and re-running the grid sort (#540).
  // batch.loading is an intentional invalidation trigger (not read in body).
  const partialLoadingMaps = useMemo<Map<TileSignalType, Map<string, SignalSlice>>>(() => {
    const out = new Map<TileSignalType, Map<string, SignalSlice>>();
    for (const sig of GRAPHQL_SIGNAL_KEYS) {
      const settled = batch.result.get(sig);
      const perRepo = new Map<string, SignalSlice>();
      for (const repo of revalidatedRepos) {
        perRepo.set(repo.nameWithOwner, settled?.get(repo.nameWithOwner) ?? LOADING_SLICE);
      }
      out.set(sig, perRepo);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- batch.loading is an intentional invalidation trigger
  }, [batch.result, batch.loading, revalidatedRepos]);

  const errorOverride = useMemo<Map<string, SignalSlice>>(
    () => new Map(revalidatedRepos.map((r) => [r.nameWithOwner, { status: 'error' as const }])),
    [revalidatedRepos],
  );

  const ciOverride = buildSignalOverride<CiSignalSlice>(
    'ci',
    batch,
    partialLoadingMaps,
    errorOverride,
  );

  const issuesOverride = buildSignalOverride<IssuesSignalSlice>(
    'issues',
    batch,
    partialLoadingMaps,
    errorOverride,
  );

  const pullRequestsOverride = buildSignalOverride<PullRequestsSignalSlice>(
    'pullRequests',
    batch,
    partialLoadingMaps,
    errorOverride,
  );

  const staleOverride = buildSignalOverride<StaleSignalSlice>(
    'stale',
    batch,
    partialLoadingMaps,
    errorOverride,
  );

  const reviewsOverride = buildSignalOverride<ReviewsSignalSlice>(
    'reviews',
    batch,
    partialLoadingMaps,
    errorOverride,
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
