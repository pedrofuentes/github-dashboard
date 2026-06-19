import { useMemo } from 'react';

import type { Repo, SecuritySignalSlice } from '../../types/fleet';

/**
 * Security signal — STUB. Replaced by issue #13 (Dependabot / code-scanning
 * alerts).
 *
 * Returns a stable empty map keyed by `repo.nameWithOwner`, so the Security
 * column renders its placeholder and {@link useRepoSignals} composes cleanly.
 * The real implementation will fetch alert counts for `token` and emit one
 * {@link SecuritySignalSlice} per repo — replacing this file only.
 */
export function useSecuritySignal(
  repos: Repo[],
  token: string | null,
): Map<string, SecuritySignalSlice> {
  void repos;
  void token;
  return useMemo(() => new Map<string, SecuritySignalSlice>(), []);
}
