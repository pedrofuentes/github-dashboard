import { useMemo } from 'react';

import type { Repo, ReviewsSignalSlice } from '../../types/fleet';

/**
 * Reviews signal — STUB. Replaced by issue #14 (review requests assigned to the
 * viewer).
 *
 * Returns a stable empty map keyed by `repo.nameWithOwner`, so the Reviews
 * column renders its placeholder and {@link useRepoSignals} composes cleanly.
 * The real implementation will fetch the viewer's review queue for `token` and
 * emit one {@link ReviewsSignalSlice} per repo — replacing this file only.
 */
export function useReviewsSignal(
  repos: Repo[],
  token: string | null,
): Map<string, ReviewsSignalSlice> {
  void repos;
  void token;
  return useMemo(() => new Map<string, ReviewsSignalSlice>(), []);
}
