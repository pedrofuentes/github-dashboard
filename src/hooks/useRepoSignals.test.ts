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
import { useFleetBatchLoader } from './useFleetBatchLoader';
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
  });
});
