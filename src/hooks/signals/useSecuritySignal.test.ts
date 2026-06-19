import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  GitHubApiError,
  GitHubErrorCode,
  fetchDependabotAlerts,
  fetchWithETag,
  type SecurityAlertSummary,
} from '../../api/github';
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
});
