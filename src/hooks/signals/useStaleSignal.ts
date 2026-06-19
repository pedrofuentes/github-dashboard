import { useMemo } from 'react';

import type { Repo, StaleSignalSlice } from '../../types/fleet';

/**
 * Stale signal — STUB. Replaced by issue #17 (stale branches / inactivity).
 *
 * Returns a stable empty map keyed by `repo.nameWithOwner`, so the Stale
 * column renders its placeholder and {@link useRepoSignals} composes cleanly.
 * The real implementation will fetch branch activity for `token` and emit one
 * {@link StaleSignalSlice} per repo — replacing this file only.
 */
export function useStaleSignal(repos: Repo[], token: string | null): Map<string, StaleSignalSlice> {
  void repos;
  void token;
  return useMemo(() => new Map<string, StaleSignalSlice>(), []);
}
