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
import { useRepoSignals } from './useRepoSignals';

vi.mock('./signals/useCiSignal', () => ({ useCiSignal: vi.fn() }));
vi.mock('./signals/useSecuritySignal', () => ({ useSecuritySignal: vi.fn() }));
vi.mock('./signals/useReviewsSignal', () => ({ useReviewsSignal: vi.fn() }));
vi.mock('./signals/usePullRequestsSignal', () => ({ usePullRequestsSignal: vi.fn() }));
vi.mock('./signals/useIssuesSignal', () => ({ useIssuesSignal: vi.fn() }));
vi.mock('./signals/useStaleSignal', () => ({ useStaleSignal: vi.fn() }));

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

const signalHooks = [
  useCiSignal,
  useSecuritySignal,
  useReviewsSignal,
  usePullRequestsSignal,
  useIssuesSignal,
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
    renderHook(() => useRepoSignals(REPOS, 'ghp_token'));

    for (const hook of signalHooks) {
      expect(vi.mocked(hook)).toHaveBeenCalledWith(REPOS, 'ghp_token');
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
    expect(vi.mocked(useCiSignal)).toHaveBeenLastCalledWith(REPOS, 'ghp_token');
  });
});
