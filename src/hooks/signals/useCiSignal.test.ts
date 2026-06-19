import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchWithETag } from '../../api/github';
import type { Repo } from '../../types/fleet';
import { useCiSignal } from './useCiSignal';

vi.mock('../../api/github', () => ({
  GITHUB_API_BASE: 'https://api.github.com',
  fetchWithETag: vi.fn(),
}));

const fetchMock = vi.mocked(fetchWithETag);

const REPOS: Repo[] = [{ nameWithOwner: 'octo/a', owner: 'octo', name: 'a', isPrivate: false }];

interface RawRun {
  status?: string | null;
  conclusion?: string | null;
  html_url?: string;
  name?: string;
}

/** Builds a `GET /actions/runs` response body with zero or one run. */
function runs(run?: RawRun) {
  return { total_count: run ? 1 : 0, workflow_runs: run ? [run] : [] };
}

/** A promise whose settlement we drive by hand, to exercise race ordering. */
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
  fetchMock.mockReset();
});

describe('useCiSignal', () => {
  it('returns a stable empty map (and never fetches) without a token', () => {
    const { result, rerender } = renderHook(({ token }) => useCiSignal(REPOS, token), {
      initialProps: { token: null as string | null },
    });
    const first = result.current;
    expect(first).toBeInstanceOf(Map);
    expect(first.size).toBe(0);

    rerender({ token: null });
    expect(result.current).toBe(first);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns an empty map and never fetches when there are no repos', () => {
    const { result } = renderHook(() => useCiSignal([], 'ghp_token'));
    expect(result.current.size).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('seeds every repo as loading before responses resolve', () => {
    fetchMock.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useCiSignal(REPOS, 'ghp_token'));
    expect(result.current.get('octo/a')?.status).toBe('loading');
  });

  it('requests the latest run per repo, authenticated with the token', () => {
    fetchMock.mockReturnValue(new Promise(() => {}));
    renderHook(() => useCiSignal(REPOS, 'ghp_token'));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, , options] = fetchMock.mock.calls[0];
    expect(url).toContain('/repos/octo/a/actions/runs?per_page=1');
    expect(options).toMatchObject({ token: 'ghp_token' });
  });

  it('maps a failing latest run to a top-scoring failure slice', async () => {
    fetchMock.mockResolvedValue(
      runs({
        status: 'completed',
        conclusion: 'failure',
        html_url: 'https://github.com/octo/a/actions/runs/1',
      }),
    );
    const { result } = renderHook(() => useCiSignal(REPOS, 'ghp_token'));

    await waitFor(() => expect(result.current.get('octo/a')?.status).toBe('ready'));
    expect(result.current.get('octo/a')).toMatchObject({
      status: 'ready',
      conclusion: 'failure',
      score: 100,
      failingCount: 1,
      latestRunUrl: 'https://github.com/octo/a/actions/runs/1',
    });
  });

  it('treats timed-out runs as failures', async () => {
    fetchMock.mockResolvedValue(runs({ status: 'completed', conclusion: 'timed_out' }));
    const { result } = renderHook(() => useCiSignal(REPOS, 'ghp_token'));

    await waitFor(() => expect(result.current.get('octo/a')?.status).toBe('ready'));
    expect(result.current.get('octo/a')).toMatchObject({ conclusion: 'failure', score: 100 });
  });

  it('maps a successful run to a zero-score passing slice', async () => {
    fetchMock.mockResolvedValue(runs({ status: 'completed', conclusion: 'success' }));
    const { result } = renderHook(() => useCiSignal(REPOS, 'ghp_token'));

    await waitFor(() => expect(result.current.get('octo/a')?.conclusion).toBe('success'));
    expect(result.current.get('octo/a')).toMatchObject({ status: 'ready', score: 0 });
  });

  it('maps an in-progress run to a running slice', async () => {
    fetchMock.mockResolvedValue(runs({ status: 'in_progress', conclusion: null }));
    const { result } = renderHook(() => useCiSignal(REPOS, 'ghp_token'));

    await waitFor(() => expect(result.current.get('octo/a')?.status).toBe('ready'));
    expect(result.current.get('octo/a')).toMatchObject({ conclusion: 'in_progress', score: 10 });
  });

  it('maps a queued run to a queued slice', async () => {
    fetchMock.mockResolvedValue(runs({ status: 'queued', conclusion: null }));
    const { result } = renderHook(() => useCiSignal(REPOS, 'ghp_token'));

    await waitFor(() => expect(result.current.get('octo/a')?.status).toBe('ready'));
    expect(result.current.get('octo/a')).toMatchObject({ conclusion: 'queued', score: 10 });
  });

  it('maps an empty run list to a no-runs slice', async () => {
    fetchMock.mockResolvedValue(runs());
    const { result } = renderHook(() => useCiSignal(REPOS, 'ghp_token'));

    await waitFor(() => expect(result.current.get('octo/a')?.status).toBe('ready'));
    expect(result.current.get('octo/a')).toMatchObject({ conclusion: 'none', score: 0 });
  });

  it('maps an inconclusive run (e.g. cancelled) to a no-runs slice', async () => {
    fetchMock.mockResolvedValue(runs({ status: 'completed', conclusion: 'cancelled' }));
    const { result } = renderHook(() => useCiSignal(REPOS, 'ghp_token'));

    await waitFor(() => expect(result.current.get('octo/a')?.status).toBe('ready'));
    expect(result.current.get('octo/a')).toMatchObject({ conclusion: 'none', score: 0 });
  });

  it('records an error slice when a request rejects', async () => {
    fetchMock.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useCiSignal(REPOS, 'ghp_token'));

    await waitFor(() => expect(result.current.get('octo/a')?.status).toBe('error'));
  });

  it('keys slices by nameWithOwner across multiple repos', async () => {
    const repos: Repo[] = [
      { nameWithOwner: 'octo/a', owner: 'octo', name: 'a', isPrivate: false },
      { nameWithOwner: 'octo/b', owner: 'octo', name: 'b', isPrivate: false },
    ];
    fetchMock
      .mockResolvedValueOnce(runs({ status: 'completed', conclusion: 'failure' }))
      .mockResolvedValueOnce(runs({ status: 'completed', conclusion: 'success' }));

    const { result } = renderHook(() => useCiSignal(repos, 'ghp_token'));

    await waitFor(() => {
      expect(result.current.get('octo/a')?.conclusion).toBe('failure');
      expect(result.current.get('octo/b')?.conclusion).toBe('success');
    });
  });

  it('ignores a resolved response from a superseded token (race-safe)', async () => {
    const stale = deferred<ReturnType<typeof runs>>();
    const fresh = deferred<ReturnType<typeof runs>>();
    fetchMock.mockReturnValueOnce(stale.promise).mockReturnValueOnce(fresh.promise);

    const { result, rerender } = renderHook(({ token }) => useCiSignal(REPOS, token), {
      initialProps: { token: 'old' as string | null },
    });
    rerender({ token: 'new' });

    await act(async () => {
      stale.resolve(runs({ status: 'completed', conclusion: 'failure' }));
    });
    await act(async () => {
      fresh.resolve(runs({ status: 'completed', conclusion: 'success' }));
    });

    await waitFor(() => expect(result.current.get('octo/a')?.status).toBe('ready'));
    expect(result.current.get('octo/a')?.conclusion).toBe('success');
  });

  it('ignores a rejected response from a superseded token (race-safe)', async () => {
    const stale = deferred<ReturnType<typeof runs>>();
    const fresh = deferred<ReturnType<typeof runs>>();
    fetchMock.mockReturnValueOnce(stale.promise).mockReturnValueOnce(fresh.promise);

    const { result, rerender } = renderHook(({ token }) => useCiSignal(REPOS, token), {
      initialProps: { token: 'old' as string | null },
    });
    rerender({ token: 'new' });

    await act(async () => {
      stale.reject(new Error('stale failure'));
    });
    await act(async () => {
      fresh.resolve(runs({ status: 'completed', conclusion: 'success' }));
    });

    await waitFor(() => expect(result.current.get('octo/a')?.status).toBe('ready'));
    expect(result.current.get('octo/a')?.conclusion).toBe('success');
  });
});
