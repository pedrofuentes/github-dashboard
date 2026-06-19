import { useMemo } from 'react';

import type { IssuesSignalSlice, Repo } from '../../types/fleet';

/**
 * Issues signal — STUB. Replaced by issue #16 (open issue counts / triage).
 *
 * Returns a stable empty map keyed by `repo.nameWithOwner`, so the Issues
 * column renders its placeholder and {@link useRepoSignals} composes cleanly.
 * The real implementation will fetch open issue counts for `token` and emit
 * one {@link IssuesSignalSlice} per repo — replacing this file only.
 */
export function useIssuesSignal(
  repos: Repo[],
  token: string | null,
): Map<string, IssuesSignalSlice> {
  void repos;
  void token;
  return useMemo(() => new Map<string, IssuesSignalSlice>(), []);
}
