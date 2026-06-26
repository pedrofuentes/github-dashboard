import { describe, expect, it } from 'vitest';

import { buildInfo, formatBuiltAt } from './build-info';

describe('buildInfo', () => {
  it('falls back to development values when Vite globals are unavailable', () => {
    expect(buildInfo).toEqual({
      version: 'dev',
      sha: 'dev',
      builtAt: '',
    });
  });
});

describe('formatBuiltAt', () => {
  it('formats a valid ISO timestamp as a calendar date', () => {
    expect(formatBuiltAt('2026-06-26T03:13:24.873Z')).toBe('2026-06-26');
  });

  it('returns an empty string for an empty timestamp', () => {
    expect(formatBuiltAt('')).toBe('');
    expect(formatBuiltAt()).toBe('');
  });

  it('returns unparseable timestamps unchanged', () => {
    expect(formatBuiltAt('not-a-date')).toBe('not-a-date');
  });
});
