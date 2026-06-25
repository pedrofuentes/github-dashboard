import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SIGNAL_FETCH_CONCURRENCY } from '../../api/concurrency';
import { fetchWithETag } from '../../api/github';
import type { Repo } from '../../types/fleet';
import { useCiSignal } from './useCiSignal';

vi.mock('../../api/github', () => ({
  GITHUB_API_BASE: 'https://api.github.com',
  fetchWithETag: vi.fn(),
}));

const fetchMock = vi.mocked(fetchWithETag);

const REPOS: Repo[] = [{ nameWithOwner: 'octo/a', owner: 'octo', name: 'a', isPrivate: false }];

/** Builds N distinct repos to exercise the per-repo concurrency limiter. */
function manyRepos(count: number): Repo[] {
  return Array.from({ length: count }, (_, i) => ({
    nameWithOwner: `octo/r${i}`,
    owner: 'octo',
    name: `r${i}`,
    isPrivate: false,
  }));
}

/** Flush all pending microtasks via a macrotask boundary. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

interface RawRun {
  id?: number;
  status?: string | null;
  conclusion?: string | null;
  html_url?: string;
  name?: string;
  updated_at?: string;
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

  it('exposes the failing run id and updated_at as per-item identity (AC-4)', async () => {
    fetchMock.mockResolvedValue(
      runs({
        id: 42,
        status: 'completed',
        conclusion: 'failure',
        html_url: 'https://github.com/octo/a/actions/runs/42',
        updated_at: '2024-05-01T10:00:00Z',
      }),
    );
    const { result } = renderHook(() => useCiSignal(REPOS, 'ghp_token'));

    await waitFor(() => expect(result.current.get('octo/a')?.status).toBe('ready'));
    // The Inbox keys a `ci:<repo>:<run-id>` item off the run id and orders it by
    // the run's `updated_at`; both already ride the same `?per_page=1` response
    // and must survive validation rather than being stripped by the schema.
    expect(result.current.get('octo/a')).toMatchObject({
      conclusion: 'failure',
      runId: 42,
      updatedAt: '2024-05-01T10:00:00Z',
    });
  });

  it('enriches identity without adding any request (same single per_page=1 call) (AC-5)', async () => {
    fetchMock.mockResolvedValue(
      runs({
        id: 7,
        status: 'completed',
        conclusion: 'failure',
        updated_at: '2024-05-01T10:00:00Z',
      }),
    );
    const { result } = renderHook(() => useCiSignal(REPOS, 'ghp_token'));

    await waitFor(() => expect(result.current.get('octo/a')?.status).toBe('ready'));
    // Identity is un-projected from data already in flight: the call count and
    // the `?per_page=1` probe URL are unchanged — no new endpoint or page.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain('/repos/octo/a/actions/runs?per_page=1');
    expect(url).not.toContain('per_page=100');
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

    // Settle the current-generation ("new") request FIRST and prove it lands.
    await act(async () => {
      fresh.resolve(runs({ status: 'completed', conclusion: 'success' }));
    });
    await waitFor(() => expect(result.current.get('octo/a')?.status).toBe('ready'));
    expect(result.current.get('octo/a')?.conclusion).toBe('success');

    // THEN resolve the superseded ("old") request last: the generation guard
    // must drop it so the fresh result is never clobbered. Without the guard,
    // this stale resolve wins under last-write-wins and the assertion fails.
    await act(async () => {
      stale.resolve(runs({ status: 'completed', conclusion: 'failure' }));
    });
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

    // Settle the current-generation ("new") request FIRST and prove it lands.
    await act(async () => {
      fresh.resolve(runs({ status: 'completed', conclusion: 'success' }));
    });
    await waitFor(() => expect(result.current.get('octo/a')?.status).toBe('ready'));
    expect(result.current.get('octo/a')?.conclusion).toBe('success');

    // THEN reject the superseded ("old") request last: the generation guard
    // must drop the error so the fresh result survives. Without the guard, this
    // stale rejection overwrites the slice with an error and the assertion fails.
    await act(async () => {
      stale.reject(new Error('stale failure'));
    });
    expect(result.current.get('octo/a')).toMatchObject({ status: 'ready', conclusion: 'success' });
  });

  it('never exceeds SIGNAL_FETCH_CONCURRENCY in-flight requests (bounded fan-out)', async () => {
    const repos = manyRepos(SIGNAL_FETCH_CONCURRENCY + 5);
    let inFlight = 0;
    let peak = 0;
    const release: Array<() => void> = [];
    fetchMock.mockImplementation(() => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      return new Promise((resolve) => {
        release.push(() => {
          inFlight -= 1;
          resolve(runs({ status: 'completed', conclusion: 'success' }));
        });
      });
    });

    const { unmount } = renderHook(() => useCiSignal(repos, 'ghp_token'));
    await act(async () => {
      await flush();
    });

    // The limiter starts only `cap` requests; the rest queue. Without the cap
    // every repo fetches at once and `peak` jumps to repos.length.
    expect(peak).toBe(SIGNAL_FETCH_CONCURRENCY);
    expect(fetchMock).toHaveBeenCalledTimes(SIGNAL_FETCH_CONCURRENCY);

    await act(async () => {
      while (release.length > 0) {
        release.shift()?.();
        await flush();
        expect(inFlight).toBeLessThanOrEqual(SIGNAL_FETCH_CONCURRENCY);
      }
    });
    expect(peak).toBe(SIGNAL_FETCH_CONCURRENCY);
    unmount();
  });

  it('aborts in-flight requests on unmount without logging or error slices', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    let captured: AbortSignal | undefined;
    let rejectFetch!: (reason: unknown) => void;
    fetchMock.mockImplementation((_url, _schema, options) => {
      captured = (options as { signal?: AbortSignal } | undefined)?.signal;
      return new Promise((_resolve, reject) => {
        rejectFetch = reject;
      });
    });

    const { unmount, result } = renderHook(() => useCiSignal(REPOS, 'ghp_token'));
    expect(captured).toBeInstanceOf(AbortSignal);
    expect(captured?.aborted).toBe(false);

    unmount();
    // Cleanup must abort the controller threaded into the fetch.
    expect(captured?.aborted).toBe(true);

    await act(async () => {
      rejectFetch(new DOMException('The operation was aborted', 'AbortError'));
      await flush();
    });

    expect(result.current.get('octo/a')?.status).not.toBe('error');
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('logs non-abort failures with repo context and sets an error slice', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failure = new Error('boom');
    fetchMock.mockRejectedValue(failure);

    const { result } = renderHook(() => useCiSignal(REPOS, 'ghp_token'));
    await waitFor(() => expect(result.current.get('octo/a')?.status).toBe('error'));

    expect(errorSpy).toHaveBeenCalled();
    const args = errorSpy.mock.calls.at(-1) ?? [];
    expect(args.some((arg) => typeof arg === 'string' && arg.includes('octo/a'))).toBe(true);
    expect(args).toContain(failure);
    errorSpy.mockRestore();
  });

  it('stays quiet (no log, no error slice) when a request rejects with AbortError', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchMock.mockRejectedValue(new DOMException('The operation was aborted', 'AbortError'));

    const { result } = renderHook(() => useCiSignal(REPOS, 'ghp_token'));
    await act(async () => {
      await flush();
    });

    expect(result.current.get('octo/a')?.status).not.toBe('error');
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

describe('useCiSignal — override param', () => {
  it('returns the override map directly and never calls fetchWithETag', () => {
    const overrideSlice = {
      status: 'ready' as const,
      conclusion: 'success' as const,
      score: 0,
      failingCount: 0,
    };
    const override = new Map([['octo/a', overrideSlice]]);
    const { result } = renderHook(() => useCiSignal(REPOS, 'ghp_token', override));

    expect(result.current).toBe(override);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falls back to REST behavior when override is undefined', async () => {
    fetchMock.mockResolvedValue(runs({ status: 'completed', conclusion: 'success' }));
    const { result } = renderHook(() => useCiSignal(REPOS, 'ghp_token', undefined));

    await waitFor(() => expect(result.current.get('octo/a')?.status).toBe('ready'));
    expect(result.current.get('octo/a')?.conclusion).toBe('success');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('skips REST and stays on override when override changes to a new map', async () => {
    const overrideA = new Map([
      [
        'octo/a',
        { status: 'ready' as const, conclusion: 'failure' as const, score: 100, failingCount: 1 },
      ],
    ]);
    const overrideB = new Map([
      [
        'octo/a',
        { status: 'ready' as const, conclusion: 'success' as const, score: 0, failingCount: 0 },
      ],
    ]);

    const { result, rerender } = renderHook(
      ({ override }) => useCiSignal(REPOS, 'ghp_token', override),
      { initialProps: { override: overrideA } },
    );
    expect(result.current).toBe(overrideA);

    rerender({ override: overrideB });
    expect(result.current).toBe(overrideB);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
