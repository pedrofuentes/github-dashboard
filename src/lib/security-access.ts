import type { SecuritySignalSlice } from '../types/fleet';

export function hasNoSecurityAccess(slices: Iterable<SecuritySignalSlice | undefined>): boolean {
  let any = false;

  for (const slice of slices) {
    any = true;
    if (!slice || slice.status !== 'ready') return false;
    if (slice.grade || slice.counts) return false;
  }

  return any;
}
