import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { executeFleetBatch, type FleetBatchResult } from '../api/github/fleet-query';
import type { Repo } from '../types/fleet';
import { useFleetBatchLoader } from './useFleetBatchLoader';

vi.mock('../api/github/fleet-query', () => ({
  executeFleetBatch: vi.fn(),
}));

const executeMock = vi.mocked(executeFleetBatch);

const REPOS: Repo[] = [{ nameWithOwner: 'octo/a', owner: 'octo', name: 'a', isPrivate: false }];

/** A promise whose settlement we drive by hand. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  executeMock.mockReset();
});

describe('useFleetBatchLoader', () => {
  it('returns stable empty result and loading:false without a token, never calls executeFleetBatch', () => {
    const { result, rerender } = renderHook(({ token }) => useFleetBatchLoader(REPOS, token), {
      initialProps: { token: null as string | null },
    });

    const first = result.current;
    expect(first.loading).toBe(false);
    expect(first.result).toBeInstanceOf(Map);

    rerender({ token: null });
    expect(result.current.result).toBe(first.result); // stable identity
    expect(executeMock).not.toHaveBeenCalled();
  });

  it('returns loading:false and never fetches when repos is empty', () => {
    const { result } = renderHook(() => useFleetBatchLoader([], 'ghp_token'));
    expect(result.current.loading).toBe(false);
    expect(executeMock).not.toHaveBeenCalled();
  });

  it('sets loading:true while in-flight and loading:false + resolved result after completion', async () => {
    const { promise, resolve: resolveFetch } = deferred<FleetBatchResult>();
    const batchResult: FleetBatchResult = new Map([['ci', new Map()]]) as FleetBatchResult;
    executeMock.mockReturnValueOnce(promise);

    const { result } = renderHook(() => useFleetBatchLoader(REPOS, 'ghp_token'));
    // Effect has run; loading must be true before the promise settles.
    expect(result.current.loading).toBe(true);

    await act(async () => {
      resolveFetch(batchResult);
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.result).toBe(batchResult);
    expect(executeMock).toHaveBeenCalledWith(REPOS, null, 'ghp_token', expect.any(AbortSignal));
  });

  it('forwards viewerLogin (non-null) through to executeFleetBatch', () => {
    executeMock.mockReturnValue(new Promise(() => {}));
    renderHook(() => useFleetBatchLoader(REPOS, 'ghp_token', 'octocat'));
    expect(executeMock).toHaveBeenCalledWith(
      REPOS,
      'octocat',
      'ghp_token',
      expect.any(AbortSignal),
    );
  });

  it('ignores a stale resolve when repos/token change bumps the generation (race-safe)', async () => {
    const stale = deferred<FleetBatchResult>();
    const fresh = deferred<FleetBatchResult>();
    executeMock.mockReturnValueOnce(stale.promise).mockReturnValueOnce(fresh.promise);

    const REPOS2: Repo[] = [
      { nameWithOwner: 'octo/b', owner: 'octo', name: 'b', isPrivate: false },
    ];
    const { result, rerender } = renderHook(
      ({ repos, token }) => useFleetBatchLoader(repos, token),
      { initialProps: { repos: REPOS, token: 'old' } },
    );

    rerender({ repos: REPOS2, token: 'new' });

    const freshResult: FleetBatchResult = new Map([['ci', new Map()]]) as FleetBatchResult;
    await act(async () => {
      fresh.resolve(freshResult);
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.result).toBe(freshResult);

    // Settle the superseded ("old") request: generation guard must ignore it.
    await act(async () => {
      stale.resolve(new Map() as FleetBatchResult);
    });
    expect(result.current.result).toBe(freshResult);
  });

  it('aborts the in-flight request on unmount', () => {
    let capturedSignal: AbortSignal | undefined;
    executeMock.mockImplementation((_repos, _login, _token, signal) => {
      capturedSignal = signal;
      return new Promise(() => {});
    });

    const { unmount } = renderHook(() => useFleetBatchLoader(REPOS, 'ghp_token'));
    expect(capturedSignal?.aborted).toBe(false);

    unmount();
    expect(capturedSignal?.aborted).toBe(true);
  });

  it('sets loading:false + empty result + logs on a non-abort thrown error', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    executeMock.mockRejectedValue(new Error('network fail'));

    const { result } = renderHook(() => useFleetBatchLoader(REPOS, 'ghp_token'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.result).toBeInstanceOf(Map);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  // ── error flag (#541) ──────────────────────────────────────────────────────

  it('error is false in the idle state (no token)', () => {
    const { result } = renderHook(() => useFleetBatchLoader(REPOS, null));
    expect(result.current.error).toBe(false);
  });

  it('error is true after a hard non-abort rejection', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    executeMock.mockRejectedValue(new Error('hard fail'));

    const { result } = renderHook(() => useFleetBatchLoader(REPOS, 'ghp_token'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe(true);
    errorSpy.mockRestore();
  });

  it('error is false after a successful fetch', async () => {
    const batchResult: FleetBatchResult = new Map() as FleetBatchResult;
    executeMock.mockResolvedValueOnce(batchResult);

    const { result } = renderHook(() => useFleetBatchLoader(REPOS, 'ghp_token'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe(false);
  });

  // ── Progressive loading (onProgress) ─────────────────────────────────────

  it('updates result incrementally via onProgress while loading stays true, then settles', async () => {
    const partialResult: FleetBatchResult = new Map([
      ['ci', new Map([['octo/a', { status: 'ready', conclusion: 'success', failingCount: 0 }]])],
    ]) as FleetBatchResult;
    const finalResult: FleetBatchResult = new Map([
      ['ci', new Map([['octo/a', { status: 'ready', conclusion: 'failure', failingCount: 1 }]])],
    ]) as FleetBatchResult;

    let capturedOnProgress: ((p: FleetBatchResult) => void) | undefined;
    const { promise, resolve: resolveFetch } = deferred<FleetBatchResult>();

    executeMock.mockImplementation(
      (_repos, _login, _token, _signal, onProgress: ((p: FleetBatchResult) => void) | undefined) => {
        capturedOnProgress = onProgress;
        return promise;
      },
    );

    const { result } = renderHook(() => useFleetBatchLoader(REPOS, 'ghp_token'));
    expect(result.current.loading).toBe(true);

    // Fire onProgress with a partial chunk result — result should update while loading stays true.
    await act(async () => {
      capturedOnProgress?.(partialResult);
    });

    expect(result.current.result).toBe(partialResult); // progressive fill
    expect(result.current.loading).toBe(true); // still loading

    // Resolve with the final result.
    await act(async () => {
      resolveFetch(finalResult);
    });

    expect(result.current.result).toBe(finalResult);
    expect(result.current.loading).toBe(false);
  });
});
