import { useMemo } from 'react';

import type { CiSignalSlice, Repo } from '../../types/fleet';

/**
 * CI signal — STUB. Replaced by issue #12 (failing GitHub Actions).
 *
 * Returns a stable empty map keyed by `repo.nameWithOwner`, so the CI column
 * renders its placeholder and {@link useRepoSignals} composes cleanly. The
 * real implementation will fetch workflow runs for `token` and emit one
 * {@link CiSignalSlice} per repo — replacing this file only.
 */
export function useCiSignal(repos: Repo[], token: string | null): Map<string, CiSignalSlice> {
  void repos;
  void token;
  return useMemo(() => new Map<string, CiSignalSlice>(), []);
}
