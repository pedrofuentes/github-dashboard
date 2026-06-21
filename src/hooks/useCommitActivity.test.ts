import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  CommitActivityResult,
  CommitActivityWeek,
  FetchCommitActivityOptions,
} from '../api/github/commit-activity';
import { fetchCommitActivity } from '../api/github/commit-activity';
import type { AuthContextValue } from '../types/auth';
import type { Repo } from '../types/fleet';
import { useAuth } from './useAuth';
import { useCommitActivity } from './useCommitActivity';

vi.mock('../api/github/commit-activity', () => ({ fetchCommitActivity: vi.fn() }));
vi.mock('./useAuth', () => ({ useAuth: vi.fn() }));

const REPO: Repo = { nameWithOwner: 'octo/a', owner: 'octo', name: 'a', isPrivate: false };

const mockFetch = vi.mocked(fetchCommitActivity);
const mockAuth = vi.mocked(useAuth);

function week(total: number): CommitActivityWeek {
  return { total, week: 1700000000, days: [0, 0, 0, total, 0, 0, 0] };
}

function authValue(token: string | null): AuthContextValue {
  return {
    token,
    user: null,
    status: token ? 'authenticated' : 'idle',
    error: null,
    signIn: vi.fn(),
    forget: vi.fn(),
  };
}

beforeEach(() => {
  mockAuth.mockReturnValue(authValue('tok-123'));
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('useCommitActivity — result states', () => {
  it('starts in the loading state synchronously', () => {
    mockFetch.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useCommitActivity(REPO));
    expect(result.current).toEqual({ state: 'loading' });
  });

  it('maps an ok result to { state: "ok", weeks }', async () => {
    const weeks = [week(3), week(5)];
    mockFetch.mockResolvedValue({
      status: 'ok',
      weeks,
      etag: 'W/"abc"',
      rateLimit: { limit: 5000, remaining: 4999, reset: new Date(0), used: 1 },
    } satisfies CommitActivityResult);

    const { result } = renderHook(() => useCommitActivity(REPO));

    await waitFor(() => expect(result.current.state).toBe('ok'));
    expect(result.current).toEqual({ state: 'ok', weeks });
  });

  it('maps a not-modified result to { state: "ok", weeks }', async () => {
    const weeks = [week(2)];
    mockFetch.mockResolvedValue({
      status: 'not-modified',
      weeks,
    } satisfies CommitActivityResult);

    const { result } = renderHook(() => useCommitActivity(REPO));

    await waitFor(() => expect(result.current.state).toBe('ok'));
    expect(result.current).toEqual({ state: 'ok', weeks });
  });

  it('passes the computing state through', async () => {
    mockFetch.mockResolvedValue({ status: 'computing' } satisfies CommitActivityResult);

    const { result } = renderHook(() => useCommitActivity(REPO));

    await waitFor(() => expect(result.current.state).toBe('computing'));
    expect(result.current).toEqual({ state: 'computing' });
  });

  it('passes the empty state through', async () => {
    mockFetch.mockResolvedValue({ status: 'empty' } satisfies CommitActivityResult);

    const { result } = renderHook(() => useCommitActivity(REPO));

    await waitFor(() => expect(result.current.state).toBe('empty'));
    expect(result.current).toEqual({ state: 'empty' });
  });

  it('maps a thrown error to { state: "error", error }', async () => {
    const boom = new Error('boom');
    mockFetch.mockRejectedValue(boom);

    const { result } = renderHook(() => useCommitActivity(REPO));

    await waitFor(() => expect(result.current.state).toBe('error'));
    expect(result.current).toEqual({ state: 'error', error: boom });
  });
});

describe('useCommitActivity — auth + abort', () => {
  it('reads the token from auth and forwards owner/name/token/signal', async () => {
    mockFetch.mockResolvedValue({ status: 'empty' } satisfies CommitActivityResult);

    renderHook(() => useCommitActivity(REPO));

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    expect(mockFetch).toHaveBeenCalledWith(
      'octo',
      'a',
      'tok-123',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('aborts the in-flight request on unmount', () => {
    let captured: AbortSignal | undefined;
    mockFetch.mockImplementation(
      (_owner: string, _repo: string, _token?: string, opts?: FetchCommitActivityOptions) => {
        captured = opts?.signal;
        return new Promise<CommitActivityResult>(() => {});
      },
    );

    const { unmount } = renderHook(() => useCommitActivity(REPO));
    expect(captured?.aborted).toBe(false);

    unmount();
    expect(captured?.aborted).toBe(true);
  });

  it('aborts and refetches when the repo changes', async () => {
    mockFetch.mockResolvedValue({ status: 'empty' } satisfies CommitActivityResult);
    const other: Repo = { nameWithOwner: 'octo/b', owner: 'octo', name: 'b', isPrivate: false };

    const { rerender } = renderHook(({ repo }) => useCommitActivity(repo), {
      initialProps: { repo: REPO },
    });
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));

    rerender({ repo: other });
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    expect(mockFetch).toHaveBeenLastCalledWith(
      'octo',
      'b',
      'tok-123',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('forwards an undefined token when unauthenticated', async () => {
    mockAuth.mockReturnValue(authValue(null));
    mockFetch.mockResolvedValue({ status: 'empty' } satisfies CommitActivityResult);

    renderHook(() => useCommitActivity(REPO));

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    expect(mockFetch).toHaveBeenCalledWith(
      'octo',
      'a',
      undefined,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('ignores a resolution that lands after unmount', async () => {
    let resolve: (value: CommitActivityResult) => void = () => {};
    mockFetch.mockImplementation(
      () =>
        new Promise<CommitActivityResult>((res) => {
          resolve = res;
        }),
    );

    const { result, unmount } = renderHook(() => useCommitActivity(REPO));
    unmount();
    resolve({ status: 'ok', weeks: [week(4)], etag: null, rateLimit: undefined as never });

    await Promise.resolve();
    // No throw, and the last observed state stayed at the initial loading.
    expect(result.current).toEqual({ state: 'loading' });
  });

  it('swallows a rejection that lands after unmount (no unhandled error)', async () => {
    let reject: (reason: unknown) => void = () => {};
    mockFetch.mockImplementation(
      () =>
        new Promise<CommitActivityResult>((_res, rej) => {
          reject = rej;
        }),
    );

    const { result, unmount } = renderHook(() => useCommitActivity(REPO));
    unmount();
    reject(new Error('late failure'));

    await Promise.resolve();
    expect(result.current).toEqual({ state: 'loading' });
  });

  it('treats an AbortError rejection as a cancellation, not an error', async () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    mockFetch.mockRejectedValue(abort);

    const { result } = renderHook(() => useCommitActivity(REPO));

    await Promise.resolve();
    await Promise.resolve();
    expect(result.current.state).not.toBe('error');
  });
});
