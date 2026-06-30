import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  CiSignalSlice,
  IssuesSignalSlice,
  PullRequestsSignalSlice,
  Repo,
  ReviewsSignalSlice,
  SecuritySignalSlice,
  StaleSignalSlice,
} from '../types/fleet';
import { useCiSignal } from './signals/useCiSignal';
import { useIssuesSignal } from './signals/useIssuesSignal';
import { usePullRequestsSignal } from './signals/usePullRequestsSignal';
import { useReviewsSignal } from './signals/useReviewsSignal';
import { useSecuritySignal } from './signals/useSecuritySignal';
import { useStaleSignal } from './signals/useStaleSignal';
import { useFleetBatchLoader, type UseFleetBatchLoaderResult } from './useFleetBatchLoader';
import { useRepoSignals } from './useRepoSignals';

vi.mock('./signals/useCiSignal', () => ({ useCiSignal: vi.fn() }));
vi.mock('./signals/useSecuritySignal', () => ({ useSecuritySignal: vi.fn() }));
vi.mock('./signals/useReviewsSignal', () => ({ useReviewsSignal: vi.fn() }));
vi.mock('./signals/usePullRequestsSignal', () => ({ usePullRequestsSignal: vi.fn() }));
vi.mock('./signals/useIssuesSignal', () => ({ useIssuesSignal: vi.fn() }));
vi.mock('./signals/useStaleSignal', () => ({ useStaleSignal: vi.fn() }));
vi.mock('./useFleetBatchLoader', () => ({ useFleetBatchLoader: vi.fn() }));

const REPO: Repo = { nameWithOwner: 'octo/a', owner: 'octo', name: 'a', isPrivate: false };
const REPO_B: Repo = { nameWithOwner: 'octo/b', owner: 'octo', name: 'b', isPrivate: false };
const ABSENT: Repo = { nameWithOwner: 'octo/z', owner: 'octo', name: 'z', isPrivate: false };
const REPOS: Repo[] = [REPO];
/** Two-repo stable array for progressive-fill / identity tests. */
const REPOS_AB: Repo[] = [REPO, REPO_B];

const ci: CiSignalSlice = { status: 'ready', score: 3, conclusion: 'failure', failingCount: 2 };
const security: SecuritySignalSlice = {
  status: 'ready',
  score: 5,
  grade: 'D',
  counts: { critical: 1, high: 2, medium: 0, low: 4 },
};
const reviews: ReviewsSignalSlice = { status: 'ready', score: 1, requestedCount: 4 };
const pullRequests: PullRequestsSignalSlice = {
  status: 'ready',
  score: 2,
  openCount: 6,
  externalCount: 1,
};
const issues: IssuesSignalSlice = { status: 'ready', score: 4, openCount: 9, overThreshold: true };
const stale: StaleSignalSlice = { status: 'ready', score: 7, staleCount: 7 };

// Signal hooks that receive only (repos, token). useCiSignal, usePullRequestsSignal,
// useStaleSignal and useReviewsSignal now accept an optional override arg and are
// asserted separately.
const tokenOnlySignalHooks = [useSecuritySignal];

let hiddenValue = false;

function defineHidden(): void {
  Object.defineProperty(document, 'hidden', {
    configurable: true,
    get: () => hiddenValue,
  });
}

/** Simulate a Page Visibility transition and notify listeners. */
function setHidden(value: boolean): void {
  hiddenValue = value;
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

beforeEach(() => {
  hiddenValue = false;
  defineHidden();
  vi.mocked(useCiSignal).mockReturnValue(new Map([[REPO.nameWithOwner, ci]]));
  vi.mocked(useSecuritySignal).mockReturnValue(new Map([[REPO.nameWithOwner, security]]));
  vi.mocked(useReviewsSignal).mockReturnValue(new Map([[REPO.nameWithOwner, reviews]]));
  vi.mocked(usePullRequestsSignal).mockReturnValue(new Map([[REPO.nameWithOwner, pullRequests]]));
  vi.mocked(useIssuesSignal).mockReturnValue(new Map([[REPO.nameWithOwner, issues]]));
  vi.mocked(useStaleSignal).mockReturnValue(new Map([[REPO.nameWithOwner, stale]]));
  // Batch loader default: empty result (no CI override), not loading.
  vi.mocked(useFleetBatchLoader).mockReturnValue({
    result: new Map(),
    loading: false,
    error: false,
  });
});

afterEach(() => {
  hiddenValue = false;
  vi.clearAllMocks();
});

describe('useRepoSignals', () => {
  it('composes a row payload from every signal hook keyed by nameWithOwner', () => {
    const { result } = renderHook(() => useRepoSignals(REPOS, 'ghp_token'));

    expect(result.current.getRowData(REPO)).toEqual({
      ci,
      security,
      reviews,
      pullRequests,
      issues,
      stale,
    });
  });

  it('passes the repos and token through to each signal hook', () => {
    renderHook(() => useRepoSignals(REPOS, 'ghp_token', 'octocat'));

    for (const hook of tokenOnlySignalHooks) {
      expect(vi.mocked(hook)).toHaveBeenCalledWith(REPOS, 'ghp_token');
    }
    // useCiSignal now accepts an optional 3rd override arg; with CI flag on and
    // an empty batch result (not loading), it receives an empty Map override.
    expect(vi.mocked(useCiSignal)).toHaveBeenCalledWith(expect.anything(), 'ghp_token', new Map());
    // usePullRequestsSignal now accepts an optional 3rd override arg; with PR
    // flag on and an empty batch result (not loading), it receives an empty Map.
    expect(vi.mocked(usePullRequestsSignal)).toHaveBeenCalledWith(
      expect.anything(),
      'ghp_token',
      new Map(),
    );
    // The issues hook receives viewer login AND a 4th override arg; with issues
    // flag on and an empty batch result (not loading), it receives an empty Map.
    expect(vi.mocked(useIssuesSignal)).toHaveBeenCalledWith(
      REPOS,
      'ghp_token',
      'octocat',
      new Map(),
    );
    // useStaleSignal now accepts an optional 3rd override arg; with the stale flag
    // on and an empty batch result (not loading), it receives an empty Map.
    expect(vi.mocked(useStaleSignal)).toHaveBeenCalledWith(
      expect.anything(),
      'ghp_token',
      new Map(),
    );
    // useReviewsSignal now accepts an optional 3rd override arg; with the reviews
    // flag on and an empty batch result (not loading), it receives an empty Map.
    expect(vi.mocked(useReviewsSignal)).toHaveBeenCalledWith(
      expect.anything(),
      'ghp_token',
      new Map(),
    );
  });

  it('forwards a null viewer login to the issues hook when unauthenticated', () => {
    renderHook(() => useRepoSignals(REPOS, 'ghp_token', null));

    expect(vi.mocked(useIssuesSignal)).toHaveBeenCalledWith(REPOS, 'ghp_token', null, new Map());
  });

  it('threads the viewer login to the issues hook only — never the other signal hooks', () => {
    renderHook(() => useRepoSignals(REPOS, 'ghp_token', 'octocat'));

    for (const hook of tokenOnlySignalHooks) {
      expect(vi.mocked(hook)).not.toHaveBeenCalledWith(REPOS, 'ghp_token', 'octocat');
    }
  });

  it('yields undefined slices for a repo absent from the signal maps', () => {
    const { result } = renderHook(() => useRepoSignals(REPOS, 'ghp_token'));

    expect(result.current.getRowData(ABSENT)).toEqual({
      ci: undefined,
      security: undefined,
      reviews: undefined,
      pullRequests: undefined,
      issues: undefined,
      stale: undefined,
    });
  });

  it('keeps a stable getRowData identity across re-renders when inputs are unchanged', () => {
    const { result, rerender } = renderHook(() => useRepoSignals(REPOS, 'ghp_token'));
    const first = result.current.getRowData;

    rerender();

    expect(result.current.getRowData).toBe(first);
  });

  it('revalidates the signal hooks when the tab returns to visible', () => {
    renderHook(() => useRepoSignals(REPOS, 'ghp_token'));
    const before = vi.mocked(useCiSignal).mock.calls.length;

    // Backgrounding the tab must not revalidate…
    setHidden(true);
    expect(vi.mocked(useCiSignal).mock.calls.length).toBe(before);

    // …but foregrounding it triggers a fresh (conditional) revalidation pass
    // that re-invokes every signal hook with the same repos.
    setHidden(false);
    expect(vi.mocked(useCiSignal).mock.calls.length).toBeGreaterThan(before);
    expect(vi.mocked(useCiSignal)).toHaveBeenLastCalledWith(
      expect.anything(),
      'ghp_token',
      new Map(),
    );
  });

  it('hands the signal hooks a fresh repos array (not the caller reference) on revalidation', () => {
    renderHook(() => useRepoSignals(REPOS, 'ghp_token'));

    setHidden(true);
    setHidden(false);

    // Foreground revalidation must pass down a NEW array (repos.slice()), never
    // the caller's own `REPOS` reference: that fresh identity is exactly what
    // re-runs each signal hook's `[repos, token]` conditional-fetch effect.
    // `toHaveBeenLastCalledWith(REPOS)` only checks deep equality, so it would
    // still pass if the slice were dropped — assert reference identity too so
    // that regression is caught.
    const lastRepos = vi.mocked(useCiSignal).mock.calls.at(-1)?.[0];
    expect(lastRepos).not.toBe(REPOS);
    expect(lastRepos).toEqual(REPOS);
  });

  // ── CI batch-loader override seam ──────────────────────────────────────────

  it('passes the batch CI map as override to useCiSignal when CI flag is enabled', () => {
    const batchCiMap = new Map([[REPO.nameWithOwner, ci]]);
    vi.mocked(useFleetBatchLoader).mockReturnValue({
      result: new Map([['ci', batchCiMap]]),
      loading: false,
      error: false,
    });

    renderHook(() => useRepoSignals(REPOS, 'ghp_token'));

    expect(vi.mocked(useCiSignal)).toHaveBeenCalledWith(expect.anything(), 'ghp_token', batchCiMap);
  });

  it('passes a loading-map override (not undefined) to useCiSignal while the batch loader is loading', () => {
    const batchCiMap = new Map([[REPO.nameWithOwner, ci]]);
    vi.mocked(useFleetBatchLoader).mockReturnValue({
      result: new Map([['ci', batchCiMap]]),
      loading: true,
      error: false,
    });

    renderHook(() => useRepoSignals(REPOS, 'ghp_token'));

    const lastCiCall = vi.mocked(useCiSignal).mock.calls.at(-1);
    // Progressive behaviour: a Map override is still passed (skips REST entirely),
    // and repos with settled batch data surface their slice even while loading.
    expect(lastCiCall?.[2]).toBeInstanceOf(Map);
    expect(lastCiCall?.[2]?.get(REPO.nameWithOwner)).toEqual(ci);
  });

  it('CI slices in getRowData come from the batch loader via the useCiSignal override', () => {
    const batchCi: CiSignalSlice = {
      status: 'ready',
      score: 77,
      conclusion: 'failure',
      failingCount: 3,
    };
    const batchCiMap = new Map([[REPO.nameWithOwner, batchCi]]);
    vi.mocked(useFleetBatchLoader).mockReturnValue({
      result: new Map([['ci', batchCiMap]]),
      loading: false,
      error: false,
    });
    // Simulate real override-aware behavior: return the override when supplied.
    vi.mocked(useCiSignal).mockImplementation(
      (_repos, _token, override) => override ?? new Map([[REPO.nameWithOwner, ci]]),
    );

    const { result } = renderHook(() => useRepoSignals(REPOS, 'ghp_token'));
    expect(result.current.getRowData(REPO).ci).toEqual(batchCi);
  });

  it('passes a defined loading-map override to useCiSignal while the batch is loading (never undefined)', () => {
    vi.mocked(useFleetBatchLoader).mockReturnValue({
      result: new Map([['ci', new Map([[REPO.nameWithOwner, ci]])]]),
      loading: true,
      error: false,
    });

    renderHook(() => useRepoSignals(REPOS, 'ghp_token'));

    const lastCiCall = vi.mocked(useCiSignal).mock.calls.at(-1);
    // A defined Map override forces useCiSignal to skip its REST fan-out entirely.
    expect(lastCiCall?.[2]).toBeDefined();
    expect(lastCiCall?.[2]).toBeInstanceOf(Map);
  });

  it('the CI loading-map override carries a loading slice for every repo so REST is always suppressed', () => {
    vi.mocked(useFleetBatchLoader).mockReturnValue({
      result: new Map(),
      loading: true,
      error: false,
    });

    renderHook(() => useRepoSignals(REPOS, 'ghp_token'));

    const lastCiCall = vi.mocked(useCiSignal).mock.calls.at(-1);
    const ciOverride = lastCiCall?.[2];
    expect(ciOverride?.get(REPO.nameWithOwner)).toEqual({ status: 'loading' });
  });

  // ── Issues batch-loader override seam ─────────────────────────────────────

  it('passes the batch issues map as override to useIssuesSignal when issues flag is enabled', () => {
    const batchIssuesMap = new Map([[REPO.nameWithOwner, issues]]);
    vi.mocked(useFleetBatchLoader).mockReturnValue({
      result: new Map([['issues', batchIssuesMap]]),
      loading: false,
      error: false,
    });

    renderHook(() => useRepoSignals(REPOS, 'ghp_token'));

    expect(vi.mocked(useIssuesSignal)).toHaveBeenCalledWith(
      expect.anything(),
      'ghp_token',
      undefined,
      batchIssuesMap,
    );
  });

  it('passes a loading-map override to useIssuesSignal while the batch loader is loading', () => {
    vi.mocked(useFleetBatchLoader).mockReturnValue({
      result: new Map(),
      loading: true,
      error: false,
    });

    renderHook(() => useRepoSignals(REPOS, 'ghp_token'));

    const lastIssuesCall = vi.mocked(useIssuesSignal).mock.calls.at(-1);
    expect(lastIssuesCall?.[3]).toBeInstanceOf(Map);
    expect(lastIssuesCall?.[3]?.get(REPO.nameWithOwner)).toEqual({ status: 'loading' });
  });

  it('issues slices in getRowData come from the batch loader via the useIssuesSignal override', () => {
    const batchIssues: IssuesSignalSlice = {
      status: 'ready',
      score: 12,
      openCount: 48,
      overThreshold: true,
    };
    const batchIssuesMap = new Map([[REPO.nameWithOwner, batchIssues]]);
    vi.mocked(useFleetBatchLoader).mockReturnValue({
      result: new Map([['issues', batchIssuesMap]]),
      loading: false,
      error: false,
    });
    // Simulate real override-aware behavior: return the override when supplied.
    vi.mocked(useIssuesSignal).mockImplementation(
      (_repos, _token, _viewer, override) => override ?? new Map([[REPO.nameWithOwner, issues]]),
    );

    const { result } = renderHook(() => useRepoSignals(REPOS, 'ghp_token'));
    expect(result.current.getRowData(REPO).issues).toEqual(batchIssues);
  });

  it('the issues loading-map override carries a loading slice for every repo so REST is always suppressed', () => {
    vi.mocked(useFleetBatchLoader).mockReturnValue({
      result: new Map(),
      loading: true,
      error: false,
    });

    renderHook(() => useRepoSignals(REPOS, 'ghp_token'));

    const lastIssuesCall = vi.mocked(useIssuesSignal).mock.calls.at(-1);
    const issuesOverride = lastIssuesCall?.[3];
    expect(issuesOverride?.get(REPO.nameWithOwner)).toEqual({ status: 'loading' });
  });

  // ── PR batch-loader override seam ──────────────────────────────────────────

  it('passes the batch PR map as override to usePullRequestsSignal when PR flag is enabled', () => {
    const batchPrMap = new Map([[REPO.nameWithOwner, pullRequests]]);
    vi.mocked(useFleetBatchLoader).mockReturnValue({
      result: new Map([['pullRequests', batchPrMap]]),
      loading: false,
      error: false,
    });

    renderHook(() => useRepoSignals(REPOS, 'ghp_token'));

    expect(vi.mocked(usePullRequestsSignal)).toHaveBeenCalledWith(
      expect.anything(),
      'ghp_token',
      batchPrMap,
    );
  });

  it('passes a loading-map override to usePullRequestsSignal while the batch loader is loading', () => {
    vi.mocked(useFleetBatchLoader).mockReturnValue({
      result: new Map(),
      loading: true,
      error: false,
    });

    renderHook(() => useRepoSignals(REPOS, 'ghp_token'));

    const lastPrCall = vi.mocked(usePullRequestsSignal).mock.calls.at(-1);
    expect(lastPrCall?.[2]).toBeInstanceOf(Map);
    expect(lastPrCall?.[2]?.get(REPO.nameWithOwner)).toEqual({ status: 'loading' });
  });

  it('PR slices in getRowData come from the batch loader via the usePullRequestsSignal override', () => {
    const batchPr: PullRequestsSignalSlice = {
      status: 'ready',
      score: 21,
      openCount: 6,
      externalCount: 4,
    };
    const batchPrMap = new Map([[REPO.nameWithOwner, batchPr]]);
    vi.mocked(useFleetBatchLoader).mockReturnValue({
      result: new Map([['pullRequests', batchPrMap]]),
      loading: false,
      error: false,
    });
    // Simulate real override-aware behavior: return the override when supplied.
    vi.mocked(usePullRequestsSignal).mockImplementation(
      (_repos, _token, override) => override ?? new Map([[REPO.nameWithOwner, pullRequests]]),
    );

    const { result } = renderHook(() => useRepoSignals(REPOS, 'ghp_token'));
    expect(result.current.getRowData(REPO).pullRequests).toEqual(batchPr);
  });

  // ── Stale batch-loader override seam (first top-level deriver) ──────────────

  it('passes the batch stale map as override to useStaleSignal when the stale flag is enabled', () => {
    const batchStaleMap = new Map([[REPO.nameWithOwner, stale]]);
    vi.mocked(useFleetBatchLoader).mockReturnValue({
      result: new Map([['stale', batchStaleMap]]),
      loading: false,
      error: false,
    });

    renderHook(() => useRepoSignals(REPOS, 'ghp_token'));

    expect(vi.mocked(useStaleSignal)).toHaveBeenCalledWith(
      expect.anything(),
      'ghp_token',
      batchStaleMap,
    );
  });

  it('passes a loading-map override to useStaleSignal while the batch loader is loading', () => {
    vi.mocked(useFleetBatchLoader).mockReturnValue({
      result: new Map(),
      loading: true,
      error: false,
    });

    renderHook(() => useRepoSignals(REPOS, 'ghp_token'));

    const lastStaleCall = vi.mocked(useStaleSignal).mock.calls.at(-1);
    expect(lastStaleCall?.[2]).toBeInstanceOf(Map);
    expect(lastStaleCall?.[2]?.get(REPO.nameWithOwner)).toEqual({ status: 'loading' });
  });

  it('stale slices in getRowData come from the batch loader via the useStaleSignal override', () => {
    const batchStale: StaleSignalSlice = { status: 'ready', score: 12, staleCount: 12 };
    const batchStaleMap = new Map([[REPO.nameWithOwner, batchStale]]);
    vi.mocked(useFleetBatchLoader).mockReturnValue({
      result: new Map([['stale', batchStaleMap]]),
      loading: false,
      error: false,
    });
    // Simulate real override-aware behavior: return the override when supplied.
    vi.mocked(useStaleSignal).mockImplementation(
      (_repos, _token, override) => override ?? new Map([[REPO.nameWithOwner, stale]]),
    );

    const { result } = renderHook(() => useRepoSignals(REPOS, 'ghp_token'));
    expect(result.current.getRowData(REPO).stale).toEqual(batchStale);
  });

  // ── Reviews batch-loader override seam (top-level-global deriver) ───────────

  it('passes the batch reviews map as override to useReviewsSignal when the reviews flag is enabled', () => {
    const batchReviewsMap = new Map([[REPO.nameWithOwner, reviews]]);
    vi.mocked(useFleetBatchLoader).mockReturnValue({
      result: new Map([['reviews', batchReviewsMap]]),
      loading: false,
      error: false,
    });

    renderHook(() => useRepoSignals(REPOS, 'ghp_token'));

    expect(vi.mocked(useReviewsSignal)).toHaveBeenCalledWith(
      expect.anything(),
      'ghp_token',
      batchReviewsMap,
    );
  });

  it('passes a loading-map override to useReviewsSignal while the batch loader is loading', () => {
    vi.mocked(useFleetBatchLoader).mockReturnValue({
      result: new Map(),
      loading: true,
      error: false,
    });

    renderHook(() => useRepoSignals(REPOS, 'ghp_token'));

    const lastReviewsCall = vi.mocked(useReviewsSignal).mock.calls.at(-1);
    expect(lastReviewsCall?.[2]).toBeInstanceOf(Map);
    expect(lastReviewsCall?.[2]?.get(REPO.nameWithOwner)).toEqual({ status: 'loading' });
  });

  it('reviews slices in getRowData come from the batch loader via the useReviewsSignal override', () => {
    const batchReviews: ReviewsSignalSlice = { status: 'ready', score: 30, requestedCount: 3 };
    const batchReviewsMap = new Map([[REPO.nameWithOwner, batchReviews]]);
    vi.mocked(useFleetBatchLoader).mockReturnValue({
      result: new Map([['reviews', batchReviewsMap]]),
      loading: false,
      error: false,
    });
    // Simulate real override-aware behavior: return the override when supplied.
    vi.mocked(useReviewsSignal).mockImplementation(
      (_repos, _token, override) => override ?? new Map([[REPO.nameWithOwner, reviews]]),
    );

    const { result } = renderHook(() => useRepoSignals(REPOS, 'ghp_token'));
    expect(result.current.getRowData(REPO).reviews).toEqual(batchReviews);
  });

  // ── Override Map identity (#540) ─────────────────────────────────────────────

  it('loading override Map passed to signal hooks is the same reference across re-renders', () => {
    vi.mocked(useFleetBatchLoader).mockReturnValue({
      result: new Map(),
      loading: true,
      error: false,
    });

    const { rerender } = renderHook(() => useRepoSignals(REPOS, 'ghp_token'));
    const firstOverride = vi.mocked(useCiSignal).mock.calls.at(-1)?.[2];

    rerender();
    const secondOverride = vi.mocked(useCiSignal).mock.calls.at(-1)?.[2];

    expect(firstOverride).toBeInstanceOf(Map);
    expect(secondOverride).toBe(firstOverride);
  });

  it('settled-absent override is the shared EMPTY constant (same reference across re-renders)', () => {
    // Flag ON, not loading, result has no entry for 'ci' → settled-absent path
    vi.mocked(useFleetBatchLoader).mockReturnValue({
      result: new Map(),
      loading: false,
      error: false,
    });

    const { rerender } = renderHook(() => useRepoSignals(REPOS, 'ghp_token'));
    const firstOverride = vi.mocked(useCiSignal).mock.calls.at(-1)?.[2];

    rerender();
    const secondOverride = vi.mocked(useCiSignal).mock.calls.at(-1)?.[2];

    expect(firstOverride).toBeInstanceOf(Map);
    expect(firstOverride?.size).toBe(0);
    expect(secondOverride).toBe(firstOverride);
  });

  // ── Error short-circuit (#541) ────────────────────────────────────────────────

  it('passes {status:"error"} override to every GraphQL-enabled signal hook when batch.error is true', () => {
    vi.mocked(useFleetBatchLoader).mockReturnValue({
      result: new Map(),
      loading: false,
      error: true,
    });

    renderHook(() => useRepoSignals(REPOS, 'ghp_token'));

    expect(vi.mocked(useCiSignal).mock.calls.at(-1)?.[2]?.get(REPO.nameWithOwner)).toEqual({
      status: 'error',
    });
    expect(vi.mocked(useReviewsSignal).mock.calls.at(-1)?.[2]?.get(REPO.nameWithOwner)).toEqual({
      status: 'error',
    });
    expect(
      vi.mocked(usePullRequestsSignal).mock.calls.at(-1)?.[2]?.get(REPO.nameWithOwner),
    ).toEqual({ status: 'error' });
    expect(vi.mocked(useIssuesSignal).mock.calls.at(-1)?.[3]?.get(REPO.nameWithOwner)).toEqual({
      status: 'error',
    });
    expect(vi.mocked(useStaleSignal).mock.calls.at(-1)?.[2]?.get(REPO.nameWithOwner)).toEqual({
      status: 'error',
    });
  });

  it('error override Map passed to signal hooks is the same reference across re-renders', () => {
    vi.mocked(useFleetBatchLoader).mockReturnValue({
      result: new Map(),
      loading: false,
      error: true,
    });

    const { rerender } = renderHook(() => useRepoSignals(REPOS, 'ghp_token'));
    const firstOverride = vi.mocked(useCiSignal).mock.calls.at(-1)?.[2];

    rerender();
    const secondOverride = vi.mocked(useCiSignal).mock.calls.at(-1)?.[2];

    expect(firstOverride).toBeInstanceOf(Map);
    expect(secondOverride).toBe(firstOverride);
  });

  // ── Progressive fill during loading (#progressive) ───────────────────────

  it('shows settled slice for a loaded repo and {status:loading} for an unloaded repo while batch is loading', () => {
    const readyCi: CiSignalSlice = {
      status: 'ready',
      score: 1,
      conclusion: 'success',
      failingCount: 0,
    };
    const partialCiMap = new Map([[REPO.nameWithOwner, readyCi]]);

    vi.mocked(useFleetBatchLoader).mockReturnValue({
      result: new Map([['ci', partialCiMap]]),
      loading: true,
      error: false,
    });

    // useCiSignal passthrough: return whatever override is provided so getRowData reflects it.
    vi.mocked(useCiSignal).mockImplementation(
      (_repos, _token, override) => override ?? new Map([[REPO.nameWithOwner, ci]]),
    );

    const { result } = renderHook(() => useRepoSignals(REPOS_AB, 'ghp_token'));

    // octo/a: batch has a settled slice — must surface it progressively.
    expect(result.current.getRowData(REPO).ci).toEqual(readyCi);
    // octo/b: no batch data yet — must show loading.
    expect(result.current.getRowData(REPO_B).ci).toEqual({ status: 'loading' });
  });

  it('progressive loading override Map is the same reference across re-renders when batch.result is stable', () => {
    const readyCi: CiSignalSlice = {
      status: 'ready',
      score: 1,
      conclusion: 'success',
      failingCount: 0,
    };

    vi.mocked(useFleetBatchLoader).mockReturnValue({
      result: new Map([['ci', new Map([[REPO.nameWithOwner, readyCi]])]]),
      loading: true,
      error: false,
    });

    const { rerender } = renderHook(() => useRepoSignals(REPOS_AB, 'ghp_token'));
    const firstOverride = vi.mocked(useCiSignal).mock.calls.at(-1)?.[2];

    rerender();
    const secondOverride = vi.mocked(useCiSignal).mock.calls.at(-1)?.[2];

    // Same Map instance must be passed — no churn on unchanged inputs (#540).
    expect(firstOverride).toBeInstanceOf(Map);
    expect(secondOverride).toBe(firstOverride);
    // Discriminating assertion: the progressive map must contain the settled slice
    // for octo/a (proves it's the merged map, not a stale/empty one that would
    // also satisfy reference equality). Without this, the test would stay green
    // against a revert of the progressive logic (#564).
    expect(firstOverride?.get(REPO.nameWithOwner)).toEqual(readyCi);
  });

  it('reports fleet loading progress from settled GraphQL slices while the batch streams', () => {
    vi.mocked(useFleetBatchLoader).mockReturnValue({
      result: new Map([
        ['ci', new Map([[REPO.nameWithOwner, ci]])],
        ['reviews', new Map([[REPO_B.nameWithOwner, reviews]])],
      ]),
      loading: true,
      error: false,
    });

    const { result } = renderHook(() => useRepoSignals(REPOS_AB, 'ghp_token'));

    expect(result.current.fleet).toEqual({
      loading: true,
      ready: 2,
      total: 2,
    });
  });

  it('reports complete fleet progress when every repo has settled and loading is false', () => {
    vi.mocked(useFleetBatchLoader).mockReturnValue({
      result: new Map([['ci', new Map(REPOS_AB.map((repo) => [repo.nameWithOwner, ci]))]]),
      loading: false,
      error: false,
    });

    const { result } = renderHook(() => useRepoSignals(REPOS_AB, 'ghp_token'));

    expect(result.current.fleet).toEqual({
      loading: false,
      ready: 2,
      total: 2,
    });
  });

  it('reports ready < total when only one of two repos has a settled slice (#571)', () => {
    vi.mocked(useFleetBatchLoader).mockReturnValue({
      result: new Map([['ci', new Map([[REPO.nameWithOwner, ci]])]]),
      loading: true,
      error: false,
    });

    const { result } = renderHook(() => useRepoSignals(REPOS_AB, 'ghp_token'));

    expect(result.current.fleet).toEqual({
      loading: true,
      ready: 1,
      total: 2,
    });
  });

  it('keeps a stable fleet identity across re-renders when batch inputs are unchanged', () => {
    vi.mocked(useFleetBatchLoader).mockReturnValue({
      result: new Map([['ci', new Map([[REPO.nameWithOwner, ci]])]]),
      loading: true,
      error: false,
    });

    const { result, rerender } = renderHook(() => useRepoSignals(REPOS_AB, 'ghp_token'));
    const firstFleet = result.current.fleet;

    rerender();

    expect(result.current.fleet).toBe(firstFleet);
  });
});

// ── Scoped signal retry seam (#507) ──────────────────────────────────────────
//
// These exercise the REAL retry implementation inside useRepoSignals — the
// retry-request state, the scoped retry batch/security loaders, and the overlay
// memos that fold a retried slice onto the primary result. The prior coverage
// lived only in BoardView/App tests that MOCK useRepoSignals and merely assert
// the retrySignal callback is forwarded; a no-op retry implementation would
// have passed them. Here we drive renderHook against the real hook (mocking
// only the underlying loaders, like the suite above) so the retry data path is
// actually executed, and we guard the never-cleared-overlay regression.
describe('useRepoSignals — scoped signal retry', () => {
  const staleCi: CiSignalSlice = {
    status: 'ready',
    score: 1,
    conclusion: 'success',
    failingCount: 0,
  };
  const retriedCi: CiSignalSlice = {
    status: 'ready',
    score: 9,
    conclusion: 'failure',
    failingCount: 5,
  };
  const freshCi: CiSignalSlice = {
    status: 'ready',
    score: 4,
    conclusion: 'failure',
    failingCount: 2,
  };

  const staleSecurity: SecuritySignalSlice = {
    status: 'ready',
    score: 1,
    grade: 'A',
    counts: { critical: 0, high: 0, medium: 0, low: 1 },
  };
  const retriedSecurity: SecuritySignalSlice = {
    status: 'ready',
    score: 9,
    grade: 'F',
    counts: { critical: 3, high: 1, medium: 0, low: 0 },
  };
  const freshSecurity: SecuritySignalSlice = {
    status: 'ready',
    score: 5,
    grade: 'C',
    counts: { critical: 0, high: 2, medium: 1, low: 0 },
  };

  /**
   * Settled primary batch result carrying `repoCi` for REPO (length-2 fleet).
   * The hook calls the primary fleet loader with the full repo set, so a
   * length-2 repos arg distinguishes the primary call from the length-1 retry.
   */
  function primaryCiBatch(repoCi: CiSignalSlice): UseFleetBatchLoaderResult {
    return {
      result: new Map([
        [
          'ci',
          new Map([
            [REPO.nameWithOwner, repoCi],
            [REPO_B.nameWithOwner, ci],
          ]),
        ],
      ]),
      loading: false,
      error: false,
    };
  }

  /** Settled retry batch result for just REPO (length-1 scoped retry). */
  function retryCiBatch(repoCi: CiSignalSlice): UseFleetBatchLoaderResult {
    return {
      result: new Map([['ci', new Map([[REPO.nameWithOwner, repoCi]])]]),
      loading: false,
      error: false,
    };
  }

  beforeEach(() => {
    // Pass the batch override straight through so getRowData.ci reflects exactly
    // what the (possibly overlaid) batch result produced — the real useCiSignal
    // returns its override verbatim when one is supplied.
    vi.mocked(useCiSignal).mockImplementation(
      (_repos, _token, override) => (override as Map<string, CiSignalSlice>) ?? new Map(),
    );
  });

  it('(a) retrying a GraphQL signal refetches only that repo+signal and surfaces the refreshed slice', () => {
    const primary = primaryCiBatch(staleCi);
    const retried = retryCiBatch(retriedCi);
    vi.mocked(useFleetBatchLoader).mockImplementation((repos) =>
      repos.length === 1 ? retried : primary,
    );

    const { result } = renderHook(() => useRepoSignals(REPOS_AB, 'ghp_token'));

    // Baseline: the tile shows the primary (stale) slice before any retry.
    expect(result.current.getRowData(REPO).ci).toEqual(staleCi);

    // The primary fleet loader's repos array reference, captured pre-retry.
    const primaryReposRef = vi
      .mocked(useFleetBatchLoader)
      .mock.calls.find((call) => call[0].length === 2)?.[0];

    act(() => {
      result.current.retrySignal?.(REPO, 'ci');
    });

    // The refreshed slice is surfaced for the retried tile.
    expect(result.current.getRowData(REPO).ci).toEqual(retriedCi);

    // The retry hit the batch loader scoped to EXACTLY the retried repo.
    const retryCall = vi
      .mocked(useFleetBatchLoader)
      .mock.calls.find((call) => call[0].length === 1);
    expect(retryCall?.[0]).toEqual([REPO]);

    // Board-wide reload was NOT triggered: the primary fleet loader kept its
    // stable repos identity (a fleet reload would hand it a fresh array).
    const primaryReposAfter = vi
      .mocked(useFleetBatchLoader)
      .mock.calls.filter((call) => call[0].length === 2)
      .at(-1)?.[0];
    expect(primaryReposAfter).toBe(primaryReposRef);
  });

  it('(b) retrying the REST security signal refetches just that repo and surfaces it', () => {
    vi.mocked(useSecuritySignal).mockImplementation((repos) =>
      repos.length === 1
        ? new Map([[REPO.nameWithOwner, retriedSecurity]])
        : new Map([
            [REPO.nameWithOwner, staleSecurity],
            [REPO_B.nameWithOwner, security],
          ]),
    );

    const { result } = renderHook(() => useRepoSignals(REPOS_AB, 'ghp_token'));

    // Baseline: the tile shows the primary (stale) security slice.
    expect(result.current.getRowData(REPO).security).toEqual(staleSecurity);

    act(() => {
      result.current.retrySignal?.(REPO, 'security');
    });

    // The refreshed security slice is surfaced for the retried tile.
    expect(result.current.getRowData(REPO).security).toEqual(retriedSecurity);

    // The REST security loader refetched ONLY the retried repo.
    const retrySecurityCall = vi
      .mocked(useSecuritySignal)
      .mock.calls.find((call) => call[0].length === 1);
    expect(retrySecurityCall?.[0]).toEqual([REPO]);
  });

  it('(c) a later revalidation supersedes a GraphQL retry overlay (no stale shadow)', () => {
    let primary = primaryCiBatch(staleCi);
    const retried = retryCiBatch(retriedCi);
    vi.mocked(useFleetBatchLoader).mockImplementation((repos) =>
      repos.length === 1 ? retried : primary,
    );

    const { result } = renderHook(() => useRepoSignals(REPOS_AB, 'ghp_token'));

    act(() => {
      result.current.retrySignal?.(REPO, 'ci');
    });
    // Retry succeeded: the tile shows the retried slice.
    expect(result.current.getRowData(REPO).ci).toEqual(retriedCi);

    // A later foreground revalidation returns NEW primary data for that tile.
    primary = primaryCiBatch(freshCi);
    setHidden(true);
    setHidden(false);

    // The tile must reflect the FRESH primary data — the retry slice must not
    // keep shadowing it after the revalidation (regression: retryRequest was
    // never cleared, so the stale retry slice was overlaid onto every refresh).
    expect(result.current.getRowData(REPO).ci).toEqual(freshCi);
  });

  it('(c) a later revalidation supersedes a REST security retry overlay (no stale shadow)', () => {
    let primarySecurity = new Map([
      [REPO.nameWithOwner, staleSecurity],
      [REPO_B.nameWithOwner, security],
    ]);
    vi.mocked(useSecuritySignal).mockImplementation((repos) =>
      repos.length === 1 ? new Map([[REPO.nameWithOwner, retriedSecurity]]) : primarySecurity,
    );

    const { result } = renderHook(() => useRepoSignals(REPOS_AB, 'ghp_token'));

    act(() => {
      result.current.retrySignal?.(REPO, 'security');
    });
    expect(result.current.getRowData(REPO).security).toEqual(retriedSecurity);

    // A later foreground revalidation returns NEW security data for that tile.
    primarySecurity = new Map([
      [REPO.nameWithOwner, freshSecurity],
      [REPO_B.nameWithOwner, security],
    ]);
    setHidden(true);
    setHidden(false);

    expect(result.current.getRowData(REPO).security).toEqual(freshSecurity);
  });

  it('(d) a security retry whose slice has not arrived yet keeps the primary slice (no blank tile)', () => {
    // The scoped security refetch (length-1 retry instance) is in-flight and has
    // not produced a slice for the repo yet — the overlay memo must fall back to
    // the primary slice rather than blanking the tile while the retry resolves.
    vi.mocked(useSecuritySignal).mockImplementation((repos) =>
      repos.length === 1
        ? new Map()
        : new Map([
            [REPO.nameWithOwner, staleSecurity],
            [REPO_B.nameWithOwner, security],
          ]),
    );

    const { result } = renderHook(() => useRepoSignals(REPOS_AB, 'ghp_token'));

    act(() => {
      result.current.retrySignal?.(REPO, 'security');
    });

    expect(result.current.getRowData(REPO).security).toEqual(staleSecurity);
  });
});

// ── REST-rolled-back scoped retry + fleet.loading gate (#608/#602) ────────────
//
// These run the REAL hook with graphql-flags mocked OFF for every signal, so
// each non-security signal is served via its REST hook. The default suite never
// mocks graphql-flags (ci/reviews/pullRequests/issues/stale ship ON), so the
// flag-OFF rollback paths are exercised only here, in module isolation.
describe('useRepoSignals — REST-rolled-back signals (no GraphQL)', () => {
  afterEach(() => {
    vi.doUnmock('../lib/graphql-flags');
    vi.resetModules();
  });

  async function loadWithNoGraphql(loader: UseFleetBatchLoaderResult): Promise<{
    useRepoSignals: typeof import('./useRepoSignals').useRepoSignals;
    useCiSignal: ReturnType<typeof vi.mocked<typeof import('./signals/useCiSignal').useCiSignal>>;
  }> {
    vi.resetModules();
    vi.doMock('../lib/graphql-flags', () => ({
      GRAPHQL_SIGNAL_FLAGS: {},
      GRAPHQL_ENABLED_SIGNALS: [],
      graphqlSignalEnabled: () => false,
    }));
    const ci = vi.mocked((await import('./signals/useCiSignal')).useCiSignal);
    ci.mockReturnValue(new Map());
    vi.mocked((await import('./signals/useSecuritySignal')).useSecuritySignal).mockReturnValue(
      new Map(),
    );
    vi.mocked((await import('./signals/useReviewsSignal')).useReviewsSignal).mockReturnValue(
      new Map(),
    );
    vi.mocked(
      (await import('./signals/usePullRequestsSignal')).usePullRequestsSignal,
    ).mockReturnValue(new Map());
    vi.mocked((await import('./signals/useIssuesSignal')).useIssuesSignal).mockReturnValue(
      new Map(),
    );
    vi.mocked((await import('./signals/useStaleSignal')).useStaleSignal).mockReturnValue(new Map());
    vi.mocked((await import('./useFleetBatchLoader')).useFleetBatchLoader).mockReturnValue(loader);
    const { useRepoSignals } = await import('./useRepoSignals');
    return { useRepoSignals, useCiSignal: ci };
  }

  it('retrying a REST-rolled-back signal reloads the fleet so its REST hook refetches (#608)', async () => {
    const { useRepoSignals, useCiSignal } = await loadWithNoGraphql({
      result: new Map(),
      loading: false,
      error: false,
    });
    const { result } = renderHook(() => useRepoSignals(REPOS_AB, 'ghp_token'));

    const reposBefore = useCiSignal.mock.calls.at(-1)?.[0];

    act(() => {
      result.current.retrySignal?.(REPO, 'ci');
    });

    const reposAfter = useCiSignal.mock.calls.at(-1)?.[0];
    // A fresh repos identity means the REST CI hook's fetch effect re-runs —
    // the retry is no longer a silent no-op for a flag-OFF signal.
    expect(reposAfter).not.toBe(reposBefore);
  });

  it('fleet.loading stays false (ready 0) when no GraphQL signal is enabled, even mid-load (#602)', async () => {
    const { useRepoSignals } = await loadWithNoGraphql({
      result: new Map(),
      loading: true,
      error: false,
    });
    const { result } = renderHook(() => useRepoSignals(REPOS_AB, 'ghp_token'));

    expect(result.current.fleet).toEqual({ loading: false, ready: 0, total: 2 });
  });

  it('buildSignalOverride returns undefined when the signal flag is OFF, allowing REST fallthrough (#542)', async () => {
    // Mock the flag as OFF so buildSignalOverride takes the early-return branch.
    const { useRepoSignals, useCiSignal } = await loadWithNoGraphql({
      result: new Map([['ci', new Map([[REPO.nameWithOwner, ci]])]]),
      loading: false,
      error: false,
    });

    renderHook(() => useRepoSignals(REPOS, 'ghp_token'));

    // When the flag is OFF, buildSignalOverride returns undefined and useCiSignal
    // receives no override (3rd arg undefined), letting REST fan-out execute (#542).
    const lastCiCall = useCiSignal.mock.calls.at(-1);
    expect(lastCiCall?.[2]).toBeUndefined();
  });
});
