import { describe, expect, it } from 'vitest';

import type { SecurityCounts } from './securityGrade';
import { computeGrade, computeSecurityScore } from './securityGrade';

function counts(partial: Partial<SecurityCounts>): SecurityCounts {
  return { critical: 0, high: 0, medium: 0, low: 0, ...partial };
}

describe('computeSecurityScore', () => {
  it('is zero when there are no open alerts', () => {
    expect(computeSecurityScore(counts({}))).toBe(0);
  });

  it('weights critical > high > medium > low (research-api §4)', () => {
    expect(computeSecurityScore(counts({ critical: 1 }))).toBe(100);
    expect(computeSecurityScore(counts({ high: 1 }))).toBe(20);
    expect(computeSecurityScore(counts({ medium: 1 }))).toBe(5);
    expect(computeSecurityScore(counts({ low: 1 }))).toBe(1);
  });

  it('sums the weighted contributions of every severity', () => {
    expect(computeSecurityScore(counts({ critical: 2, high: 3, medium: 4, low: 5 }))).toBe(
      2 * 100 + 3 * 20 + 4 * 5 + 5,
    );
  });
});

describe('computeGrade (research-api §4)', () => {
  it('grades a clean repo (no open alerts) as A', () => {
    expect(computeGrade(counts({}))).toBe('A');
  });

  it('grades any critical alert as F regardless of the other counts', () => {
    expect(computeGrade(counts({ critical: 1 }))).toBe('F');
    expect(computeGrade(counts({ critical: 3, high: 9, medium: 9, low: 9 }))).toBe('F');
  });

  it('grades several high-severity alerts (>=3) as E', () => {
    expect(computeGrade(counts({ high: 3 }))).toBe('E');
    expect(computeGrade(counts({ high: 5, medium: 2, low: 9 }))).toBe('E');
  });

  it('grades a couple of high-severity alerts (1-2) as D', () => {
    expect(computeGrade(counts({ high: 1 }))).toBe('D');
    expect(computeGrade(counts({ high: 2, medium: 9, low: 9 }))).toBe('D');
  });

  it('grades a heavy medium load (>=5) as D', () => {
    expect(computeGrade(counts({ medium: 5 }))).toBe('D');
    expect(computeGrade(counts({ medium: 9, low: 9 }))).toBe('D');
  });

  it('grades a light medium load (1-4) as C', () => {
    expect(computeGrade(counts({ medium: 1 }))).toBe('C');
    expect(computeGrade(counts({ medium: 4, low: 100 }))).toBe('C');
  });

  it('grades a heavy low-only load (>=10) as C', () => {
    expect(computeGrade(counts({ low: 10 }))).toBe('C');
    expect(computeGrade(counts({ low: 50 }))).toBe('C');
  });

  it('grades a light low-only load (1-9) as B', () => {
    expect(computeGrade(counts({ low: 1 }))).toBe('B');
    expect(computeGrade(counts({ low: 9 }))).toBe('B');
  });
});
