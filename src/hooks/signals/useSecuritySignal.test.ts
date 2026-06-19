import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  GitHubApiError,
  GitHubErrorCode,
  fetchDependabotAlerts,
  fetchWithETag,
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
    fetchWithETag: vi.fn(),
  };
});

const mockDependabot = vi.mocked(fetchDependabotAlerts);
const mockCodeScanning = vi.mocked(fetchWithETag);

const REPO: Repo = { nameWithOwner: 'octo/a', owner: 'octo', name: 'a', isPrivate: false };
const REPOS: Repo[] = [REPO];

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

function dependabot(partial: Partial<SecurityAlertSummary>): SecurityAlertSummary {
  return { critical: 0, high: 0, medium: 0, low: 0, total: 0, ...partial };
}

/** Resolve the code-scanning fetch with raw alert objects (schema is internal). */
function codeScanning(alerts: unknown[]): void {
  mockCodeScanning.mockResolvedValue(alerts as never);
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

  it('exposes a loading slice for each repo before the fetches resolve', () => {
    mockDependabot.mockReturnValue(new Promise<SecurityAlertSummary>(() => {}));
    mockCodeScanning.mockReturnValue(new Promise(() => {}) as never);

    const { result } = renderHook(() => useSecuritySignal(REPOS, 'ghp_token'));
    expect(result.current.get('octo/a')).toEqual({ status: 'loading' });
  });

  it('merges Dependabot and code-scanning alerts into counts, score and grade', async () => {
    mockDependabot.mockResolvedValue(dependabot({ critical: 1, medium: 2 }));
    // high (level) + medium (warning) from code scanning
    codeScanning([
      { rule: { security_severity_level: 'high' } },
      { rule: { severity: 'warning' } },
    ]);

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

  it('maps every code-scanning severity source (level + rule.severity, ignoring unknowns)', async () => {
    mockDependabot.mockResolvedValue(dependabot({}));
    codeScanning([
      { rule: { security_severity_level: 'critical' } },
      { rule: { security_severity_level: 'high' } },
      { rule: { security_severity_level: 'medium' } },
      { rule: { security_severity_level: 'low' } },
      { rule: { severity: 'error' } }, // -> high
      { rule: { severity: 'warning' } }, // -> medium
      { rule: { severity: 'note' } }, // -> low
      { rule: { severity: 'unknown' } }, // ignored
      { rule: null }, // ignored
      {}, // ignored
    ]);

    const { result } = renderHook(() => useSecuritySignal(REPOS, 'ghp_token'));

    await waitFor(() => {
      expect(result.current.get('octo/a')?.status).toBe('ready');
    });
    expect(result.current.get('octo/a')?.counts).toEqual({
      critical: 1,
      high: 2,
      medium: 2,
      low: 2,
    });
  });

  it('treats a 403 on one source as "no data from that source", using the other', async () => {
    mockDependabot.mockRejectedValue(apiError(403, GitHubErrorCode.ACCESS_DENIED));
    codeScanning([{ rule: { security_severity_level: 'medium' } }]);

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
    mockCodeScanning.mockRejectedValue(apiError(404, GitHubErrorCode.NOT_FOUND) as never);

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
    codeScanning([]);

    const { result } = renderHook(() => useSecuritySignal(REPOS, 'ghp_token'));

    await waitFor(() => {
      expect(result.current.get('octo/a')?.status).toBe('error');
    });
    expect(result.current.get('octo/a')).toEqual({ status: 'error' });
  });

  it('treats a rate-limit 403 as an error, not as missing access', async () => {
    mockDependabot.mockRejectedValue(apiError(403, GitHubErrorCode.RATE_LIMITED));
    codeScanning([]);

    const { result } = renderHook(() => useSecuritySignal(REPOS, 'ghp_token'));

    await waitFor(() => {
      expect(result.current.get('octo/a')?.status).toBe('error');
    });
  });

  it('ignores a stale resolution after the token changes (race guard)', async () => {
    // The stale generation's BOTH feeds are deferred so its `Promise.all`
    // (useSecuritySignal.ts) only settles when we release it — *after* the
    // fresh generation has already won. Releasing just one half would leave the
    // stale `Promise.all` pending and the `.then` generation guard unexercised.
    let resolveStaleDependabot: ((value: SecurityAlertSummary) => void) | undefined;
    let resolveStaleCodeScanning: ((value: unknown[]) => void) | undefined;
    const staleDependabot = new Promise<SecurityAlertSummary>((resolve) => {
      resolveStaleDependabot = resolve;
    });
    const staleCodeScanning = new Promise<unknown[]>((resolve) => {
      resolveStaleCodeScanning = resolve;
    });
    mockDependabot.mockReturnValueOnce(staleDependabot);
    mockCodeScanning.mockReturnValueOnce(staleCodeScanning as never);

    const { result, rerender } = renderHook(({ token }) => useSecuritySignal(REPOS, token), {
      initialProps: { token: 'ghp_one' },
    });
    expect(result.current.get('octo/a')?.status).toBe('loading');

    // Second token: both feeds resolve cleanly to a healthy 'B'.
    mockDependabot.mockResolvedValue(dependabot({ low: 1 }));
    codeScanning([]);
    rerender({ token: 'ghp_two' });

    await waitFor(() => {
      expect(result.current.get('octo/a')).toEqual({
        status: 'ready',
        counts: { critical: 0, high: 0, medium: 0, low: 1 },
        score: 1,
        grade: 'B',
      });
    });

    // The first token's slow feeds NOW both settle, so its `Promise.all`
    // resolves and the `.then` actually runs — with a critical count that would
    // crash the grade to 'F'. The generation guard must discard this write.
    resolveStaleDependabot?.(dependabot({ critical: 9 }));
    resolveStaleCodeScanning?.([]);
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
    mockCodeScanning.mockReturnValue(new Promise(() => {}) as never);

    const { result, rerender } = renderHook(({ token }) => useSecuritySignal(REPOS, token), {
      initialProps: { token: 'ghp_one' },
    });
    expect(result.current.get('octo/a')?.status).toBe('loading');

    mockDependabot.mockResolvedValue(dependabot({}));
    codeScanning([]);
    rerender({ token: 'ghp_two' });

    await waitFor(() => {
      expect(result.current.get('octo/a')?.status).toBe('ready');
    });

    rejectStale?.(new Error('stale failure'));
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(result.current.get('octo/a')?.status).toBe('ready');
  });

  it('never exceeds SIGNAL_FETCH_CONCURRENCY in-flight requests (bounded fan-out)', async () => {
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
    codeScanning([]);

    const { unmount } = renderHook(() => useSecuritySignal(repos, 'ghp_token'));
    await act(async () => {
      await flush();
    });

    // The limiter caps cold-start fan-out; without it every repo fetches at once.
    expect(peak).toBe(SIGNAL_FETCH_CONCURRENCY);
    expect(mockDependabot).toHaveBeenCalledTimes(SIGNAL_FETCH_CONCURRENCY);

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
    mockCodeScanning.mockReturnValue(new Promise(() => {}) as never);

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
    codeScanning([]);

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
    codeScanning([]);

    const { result } = renderHook(() => useSecuritySignal(REPOS, 'ghp_token'));
    await act(async () => {
      await flush();
    });

    expect(result.current.get('octo/a')?.status).not.toBe('error');
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
