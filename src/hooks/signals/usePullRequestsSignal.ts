import { useMemo } from 'react';

import type { PullRequestsSignalSlice, Repo } from '../../types/fleet';

/**
 * New PRs signal — STUB. Replaced by issue #15 (open / external-contributor
 * pull requests).
 *
 * Returns a stable empty map keyed by `repo.nameWithOwner`, so the New PRs
 * column renders its placeholder and {@link useRepoSignals} composes cleanly.
 * The real implementation will fetch open pull requests for `token` and emit
 * one {@link PullRequestsSignalSlice} per repo — replacing this file only.
 */
export function usePullRequestsSignal(
  repos: Repo[],
  token: string | null,
): Map<string, PullRequestsSignalSlice> {
  void repos;
  void token;
  return useMemo(() => new Map<string, PullRequestsSignalSlice>(), []);
}
