import { describe, expect, it } from 'vitest';

import { safeCount } from './safeCount';

describe('safeCount', () => {
  it('passes a positive integer through unchanged', () => {
    expect(safeCount(5)).toBe(5);
  });

  it('truncates a positive fractional value toward zero', () => {
    expect(safeCount(3.9)).toBe(3);
  });

  it('treats zero as zero', () => {
    expect(safeCount(0)).toBe(0);
  });

  it('clamps a negative value to zero', () => {
    expect(safeCount(-3)).toBe(0);
  });

  it('coerces undefined to zero', () => {
    expect(safeCount(undefined)).toBe(0);
  });

  it('coerces NaN to zero', () => {
    expect(safeCount(Number.NaN)).toBe(0);
  });

  it('coerces a non-finite value to zero', () => {
    expect(safeCount(Number.POSITIVE_INFINITY)).toBe(0);
  });
});
