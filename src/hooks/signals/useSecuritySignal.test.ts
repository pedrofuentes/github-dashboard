import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  GitHubApiError,
  GitHubErrorCode,
  fetchCodeScanningAlerts,
  fetchDependabotAlerts,
  type SecurityAlertSummary,
} from '../../api/github';
import { SIGNAL_FETCH_CONCURRENCY } from '../../api/concurrency';
import type { Repo } from '../../types/fleet';
import { useSecuritySignal } from './useSecuritySignal';

vi.mock('../../api/github', async (importActual) => {
  const actual = await importActual<typeof import('../../api/github')>();
  return {
    ...actual,
    fetchDependabotAlerts: vi.fn(),
    fetchCodeScanningAlerts: vi.fn(),
  };
});

const mockDependabot = vi.mocked(fetchDependabotAlerts);
const mockCodeScanning = vi.mocked(fetchCodeScanningAlerts);

const REPO: Repo = { nameWithOwner: 'octo/a', owner: 'octo', name: 'a', isPrivate: false };
const REPOS: Repo[] = [REPO];

/** A fresh, equal-by-value repo (distinct array/object identity each call). */
function repoLike(nameWithOwner: string): Repo {
  const [owner, name] = nameWithOwner.split('/');
  return { nameWithOwner, owner, name, isPrivate: false };
}

/** Builds N distinct repos to exercise the per-(repo,feed) concurrency limiter. */
function manyRepos(count: number): Repo[] {
  return Array.from({ length: count }, (_, i) => repoLike(`octo/r${i}`));
}

/** Flush all pending microtasks via a macrotask boundary. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** Builds a severity summary (the shape both alert fetchers now return). */
function summaryOf(partial: Partial<SecurityAlertSummary>): SecurityAlertSummary {
  return { critical: 0, high: 0, medium: 0, low: 0, total: 0, ...partial };
}

const dependabot = summaryOf;

/** Resolve the code-scanning fetch with a severity summary. */
function codeScanning(partial: Partial<SecurityAlertSummary>): void {
  mockCodeScanning.mockResolvedValue(summaryOf(partial));
}

function apiError(status: number, code: GitHubErrorCode): GitHubApiError {
  return new GitHubApiError(`status ${status}`, status, undefined, undefined, code);
}

beforeEach(() => {
  mockDependabot.mockReset();
  mockCodeScanning.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useSecuritySignal', () => {
  it('returns an empty map and skips fetching without a token', () => {
    const { result } = renderHook(() => useSecuritySignal(REPOS, null));
    expect(result.current.size).toBe(0);
    expect(mockDependabot).not.toHaveBeenCalled();
    expect(mockCodeScanning).not.toHaveBeenCalled();
  });

  it('returns an empty map when there are no repos', () => {
    const { result } = renderHook(() => useSecuritySignal([], 'ghp_token'));
    expect(result.current.size).toBe(0);
    expect(mockDependabot).not.toHaveBeenCalled();
  });

  it('returns a stable empty map across re-renders with no repos (no rebuild, no loop)', () => {
    const { result, rerender } = renderHook(({ repos }) => useSecuritySignal(repos, 'ghp_token'), {
      initialProps: { repos: [] as Repo[] },
    });
    const first = result.current;
    expect(first.size).toBe(0);

    // A fresh (but still empty) array must not churn the result's identity.
    rerender({ repos: [] });
    expect(result.current).toBe(first);
    expect(mockDependabot).not.toHaveBeenCalled();
  });

  it('exposes a loading slice for each repo before the fetches resolve', () => {
    mockDependabot.mockReturnValue(new Promise<SecurityAlertSummary>(() => {}));
    mockCodeScanning.mockReturnValue(new Promise<SecurityAlertSummary>(() => {}));

    const { result } = renderHook(() => useSecuritySignal(REPOS, 'ghp_token'));
    expect(result.current.get('octo/a')).toEqual({ status: 'loading' });
  });

  it('merges Dependabot and code-scanning alerts into counts, score and grade', async () => {
    mockDependabot.mockResolvedValue(dependabot({ critical: 1, medium: 2 }));
    codeScanning({ high: 1, medium: 1 });

    const { result } = renderHook(() => useSecuritySignal(REPOS, 'ghp_token'));

    await waitFor(() => {
      expect(result.current.get('octo/a')?.status).toBe('ready');
    });
    expect(result.current.get('octo/a')).toEqual({
      status: 'ready',
      counts: { critical: 1, high: 1, medium: 3, low: 0 },
      score: 1 * 100 + 1 * 20 + 3 * 5 + 0,
      grade: 'F',
    });
  });

  it('treats a 403 on one source as "no data from that source", using the other', async () => {
    mockDependabot.mockRejectedValue(apiError(403, GitHubErrorCode.ACCESS_DENIED));
    codeScanning({ medium: 1 });

    const { result } = renderHook(() => useSecuritySignal(REPOS, 'ghp_token'));

    await waitFor(() => {
      expect(result.current.get('octo/a')?.status).toBe('ready');
    });
    expect(result.current.get('octo/a')).toEqual({
      status: 'ready',
      counts: { critical: 0, high: 0, medium: 1, low: 0 },
      score: 5,
      grade: 'C',
    });
  });

  it('reports "no data available" (ready, no counts) when both feeds 403/404', async () => {
    mockDependabot.mockRejectedValue(apiError(403, GitHubErrorCode.ACCESS_DENIED));
    mockCodeScanning.mockRejectedValue(apiError(404, GitHubErrorCode.NOT_FOUND));

    const { result } = renderHook(() => useSecuritySignal(REPOS, 'ghp_token'));

    await waitFor(() => {
      expect(result.current.get('octo/a')?.status).toBe('ready');
    });
    const slice = result.current.get('octo/a');
    expect(slice).toEqual({ status: 'ready' });
    expect(slice?.counts).toBeUndefined();
    expect(slice?.grade).toBeUndefined();
    expect(slice?.score).toBeUndefined();
  });

  it('surfaces an error slice when a feed fails for a non-access reason', async () => {
    mockDependabot.mockRejectedValue(new Error('network down'));
    codeScanning({});

    const { result } = renderHook(() => useSecuritySignal(REPOS, 'ghp_token'));

    await waitFor(() => {
      expect(result.current.get('octo/a')?.status).toBe('error');
    });
    expect(result.current.get('octo/a')).toEqual({ status: 'error' });
  });

  it('treats a rate-limit 403 as an error, not as missing access', async () => {
    mockDependabot.mockRejectedValue(apiError(403, GitHubErrorCode.RATE_LIMITED));
    codeScanning({});

    const { result } = renderHook(() => useSecuritySignal(REPOS, 'ghp_token'));

    await waitFor(() => {
      expect(result.current.get('octo/a')?.status).toBe('error');
    });
  });

  it('ignores a stale resolution after the token changes (race guard)', async () => {
    // The stale generation's BOTH feeds are deferred so neither per-feed task
    // settles until we release them — *after* the fresh generation has already
    // won. Each task's generation guard must discard the late write.
    let resolveStaleDependabot: ((value: SecurityAlertSummary) => void) | undefined;
    let resolveStaleCodeScanning: ((value: SecurityAlertSummary) => void) | undefined;
    const staleDependabot = new Promise<SecurityAlertSummary>((resolve) => {
      resolveStaleDependabot = resolve;
    });
    const staleCodeScanning = new Promise<SecurityAlertSummary>((resolve) => {
      resolveStaleCodeScanning = resolve;
    });
    mockDependabot.mockReturnValueOnce(staleDependabot);
    mockCodeScanning.mockReturnValueOnce(staleCodeScanning);

    const { result, rerender } = renderHook(({ token }) => useSecuritySignal(REPOS, token), {
      initialProps: { token: 'ghp_one' },
    });
    expect(result.current.get('octo/a')?.status).toBe('loading');

    // Second token: both feeds resolve cleanly to a healthy 'B'.
    mockDependabot.mockResolvedValue(dependabot({ low: 1 }));
    codeScanning({});
    rerender({ token: 'ghp_two' });

    await waitFor(() => {
      expect(result.current.get('octo/a')).toEqual({
        status: 'ready',
        counts: { critical: 0, high: 0, medium: 0, low: 1 },
        score: 1,
        grade: 'B',
      });
    });

    // The first token's slow feeds NOW settle, with a critical count that would
    // crash the grade to 'F'. The generation guard must discard this write.
    resolveStaleDependabot?.(dependabot({ critical: 9 }));
    resolveStaleCodeScanning?.(summaryOf({}));
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(result.current.get('octo/a')).toEqual({
      status: 'ready',
      counts: { critical: 0, high: 0, medium: 0, low: 1 },
      score: 1,
      grade: 'B',
    });
  });

  it('ignores a stale rejection after the token changes (race guard)', async () => {
    let rejectStale: ((reason: unknown) => void) | undefined;
    const staleDependabot = new Promise<SecurityAlertSummary>((_, reject) => {
      rejectStale = reject;
    });
    mockDependabot.mockReturnValueOnce(staleDependabot);
    mockCodeScanning.mockReturnValue(new Promise<SecurityAlertSummary>(() => {}));

    const { result, rerender } = renderHook(({ token }) => useSecuritySignal(REPOS, token), {
      initialProps: { token: 'ghp_one' },
    });
    expect(result.current.get('octo/a')?.status).toBe('loading');

    mockDependabot.mockResolvedValue(dependabot({}));
    codeScanning({});
    rerender({ token: 'ghp_two' });

    await waitFor(() => {
      expect(result.current.get('octo/a')?.status).toBe('ready');
    });

    rejectStale?.(new Error('stale failure'));
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(result.current.get('octo/a')?.status).toBe('ready');
  });

  it('does not rebuild slices when re-rendered with an equal repo set (stable identity)', async () => {
    mockDependabot.mockResolvedValue(dependabot({}));
    codeScanning({});

    const { result, rerender } = renderHook(({ repos }) => useSecuritySignal(repos, 'ghp_token'), {
      initialProps: { repos: [repoLike('octo/a'), repoLike('octo/b')] },
    });

    await waitFor(() => {
      expect(result.current.get('octo/a')?.status).toBe('ready');
      expect(result.current.get('octo/b')?.status).toBe('ready');
    });

    const settled = result.current;
    const callsBefore = mockDependabot.mock.calls.length;

    // A brand-new array describing the *same* repo set must not rebuild the map
    // (a fresh loading Map here would re-render and, if the caller passes a new
    // array each render, loop forever) and must not refetch.
    rerender({ repos: [repoLike('octo/a'), repoLike('octo/b')] });
    await act(async () => {
      await flush();
    });

    expect(result.current).toBe(settled);
    expect(mockDependabot.mock.calls.length).toBe(callsBefore);
  });

  it('rebuilds slices when the repo set actually changes', async () => {
    mockDependabot.mockResolvedValue(dependabot({}));
    codeScanning({});

    const { result, rerender } = renderHook(({ repos }) => useSecuritySignal(repos, 'ghp_token'), {
      initialProps: { repos: [repoLike('octo/a')] },
    });

    await waitFor(() => {
      expect(result.current.get('octo/a')?.status).toBe('ready');
    });
    const settled = result.current;

    // A genuinely different repo set rebuilds: the new repo appears as loading.
    rerender({ repos: [repoLike('octo/c')] });
    expect(result.current).not.toBe(settled);
    expect(result.current.get('octo/c')).toEqual({ status: 'loading' });

    await waitFor(() => {
      expect(result.current.get('octo/c')?.status).toBe('ready');
    });
  });

  it('never exceeds SIGNAL_FETCH_CONCURRENCY for a single feed (bounded fan-out)', async () => {
    const repos = manyRepos(SIGNAL_FETCH_CONCURRENCY + 5);
    let inFlight = 0;
    let peak = 0;
    const release: Array<() => void> = [];
    mockDependabot.mockImplementation(() => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      return new Promise<SecurityAlertSummary>((resolve) => {
        release.push(() => {
          inFlight -= 1;
          resolve(dependabot({}));
        });
      });
    });
    codeScanning({});

    const { unmount } = renderHook(() => useSecuritySignal(repos, 'ghp_token'));
    await act(async () => {
      await flush();
    });

    expect(peak).toBe(SIGNAL_FETCH_CONCURRENCY);

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

  it('caps TOTAL in-flight requests across BOTH feeds at the concurrency limit', async () => {
    // Each repo issues two feed requests. If the limiter mapped per-repo while
    // each repo fired both feeds via Promise.all, the real ceiling would be
    // 2×cap. Counting every (repo,feed) request through the limiter keeps the
    // true in-flight peak at exactly the documented cap.
    const repos = manyRepos(SIGNAL_FETCH_CONCURRENCY + 5);
    let inFlight = 0;
    let peak = 0;
    const release: Array<() => void> = [];
    const track = (): Promise<SecurityAlertSummary> => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      return new Promise<SecurityAlertSummary>((resolve) => {
        release.push(() => {
          inFlight -= 1;
          resolve(summaryOf({}));
        });
      });
    };
    mockDependabot.mockImplementation(track);
    mockCodeScanning.mockImplementation(track);

    const { unmount } = renderHook(() => useSecuritySignal(repos, 'ghp_token'));
    await act(async () => {
      await flush();
    });

    // Without honest per-feed accounting this peaks at 2×SIGNAL_FETCH_CONCURRENCY.
    expect(peak).toBe(SIGNAL_FETCH_CONCURRENCY);

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
    let rejectFetch!: (reason: unknown) => void;
    mockDependabot.mockImplementation(
      () =>
        new Promise<SecurityAlertSummary>((_resolve, reject) => {
          rejectFetch = reject;
        }),
    );
    mockCodeScanning.mockReturnValue(new Promise<SecurityAlertSummary>(() => {}));

    const { unmount, result } = renderHook(() => useSecuritySignal(REPOS, 'ghp_token'));
    const captured = mockDependabot.mock.calls[0]?.[3] as AbortSignal | undefined;
    expect(captured).toBeInstanceOf(AbortSignal);
    expect(captured?.aborted).toBe(false);

    unmount();
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
    mockDependabot.mockRejectedValue(failure);
    codeScanning({});

    const { result } = renderHook(() => useSecuritySignal(REPOS, 'ghp_token'));
    await waitFor(() => expect(result.current.get('octo/a')?.status).toBe('error'));

    expect(errorSpy).toHaveBeenCalled();
    const args = errorSpy.mock.calls.at(-1) ?? [];
    expect(args.some((arg) => typeof arg === 'string' && arg.includes('octo/a'))).toBe(true);
    expect(args).toContain(failure);
    errorSpy.mockRestore();
  });

  it('stays quiet (no log, no error slice) when a request rejects with AbortError', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockDependabot.mockRejectedValue(new DOMException('The operation was aborted', 'AbortError'));
    codeScanning({});

    const { result } = renderHook(() => useSecuritySignal(REPOS, 'ghp_token'));
    await act(async () => {
      await flush();
    });

    expect(result.current.get('octo/a')?.status).not.toBe('error');
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
