import { describe, expect, it } from 'vitest';

import type { SecuritySignalSlice } from '../types/fleet';
import { hasNoSecurityAccess } from './security-access';

describe('hasNoSecurityAccess', () => {
  it('returns true when every settled security slice lacks grade and counts', () => {
    const slices: SecuritySignalSlice[] = [{ status: 'ready' }, { status: 'ready', score: 0 }];

    expect(hasNoSecurityAccess(slices)).toBe(true);
  });

  it('returns false when any settled security slice has a grade or counts', () => {
    expect(
      hasNoSecurityAccess([
        { status: 'ready' },
        { status: 'ready', grade: 'A' },
        { status: 'ready', counts: { critical: 0, high: 0, medium: 0, low: 0 } },
      ]),
    ).toBe(false);
  });

  it('returns false when any slice is loading, errored, or undefined', () => {
    expect(hasNoSecurityAccess([{ status: 'ready' }, { status: 'loading' }])).toBe(false);
    expect(hasNoSecurityAccess([{ status: 'ready' }, { status: 'error' }])).toBe(false);
    expect(hasNoSecurityAccess([{ status: 'ready' }, undefined])).toBe(false);
  });

  it('returns false for an empty iterable', () => {
    expect(hasNoSecurityAccess([])).toBe(false);
  });
});
