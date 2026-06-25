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
const ABSENT: Repo = { nameWithOwner: 'octo/z', owner: 'octo', name: 'z', isPrivate: false };
const REPOS: Repo[] = [REPO];

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

// Signal hooks that receive only (repos, token). useCiSignal now accepts an
// optional 3rd override arg and is asserted separately where needed.
const tokenOnlySignalHooks = [
  useSecuritySignal,
  useReviewsSignal,
  usePullRequestsSignal,
  useStaleSignal,
];

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
    // The issues hook also receives the viewer login so it can split "mine" vs
    // "community" open issues.
    expect(vi.mocked(useIssuesSignal)).toHaveBeenCalledWith(REPOS, 'ghp_token', 'octocat');
  });

  it('forwards a null viewer login to the issues hook when unauthenticated', () => {
    renderHook(() => useRepoSignals(REPOS, 'ghp_token', null));

    expect(vi.mocked(useIssuesSignal)).toHaveBeenCalledWith(REPOS, 'ghp_token', null);
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
    });

    renderHook(() => useRepoSignals(REPOS, 'ghp_token'));

    expect(vi.mocked(useCiSignal)).toHaveBeenCalledWith(expect.anything(), 'ghp_token', batchCiMap);
  });

  it('passes a loading-map override (not undefined) to useCiSignal while the batch loader is loading', () => {
    const batchCiMap = new Map([[REPO.nameWithOwner, ci]]);
    vi.mocked(useFleetBatchLoader).mockReturnValue({
      result: new Map([['ci', batchCiMap]]),
      loading: true,
    });

    renderHook(() => useRepoSignals(REPOS, 'ghp_token'));

    const lastCiCall = vi.mocked(useCiSignal).mock.calls.at(-1);
    // New behaviour: a loading Map is passed so useCiSignal skips REST entirely.
    expect(lastCiCall?.[2]).toBeInstanceOf(Map);
    expect(lastCiCall?.[2]?.get(REPO.nameWithOwner)).toEqual({ status: 'loading' });
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
    });

    renderHook(() => useRepoSignals(REPOS, 'ghp_token'));

    const lastCiCall = vi.mocked(useCiSignal).mock.calls.at(-1);
    const ciOverride = lastCiCall?.[2];
    expect(ciOverride?.get(REPO.nameWithOwner)).toEqual({ status: 'loading' });
  });
});
