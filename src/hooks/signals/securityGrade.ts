/**
 * Security-alert grading — the pure scoring/rubric helper behind the Security
 * column (issue #13). Kept free of React/IO so it is trivially unit-tested and
 * reused by both the signal hook and (the spoken summary of) the cell.
 */
import type { SecuritySignalSlice } from '../../types/fleet';

/** Open-alert counts bucketed by GitHub severity (Dependabot + code scanning). */
export type SecurityCounts = NonNullable<SecuritySignalSlice['counts']>;

/** Letter grade summarising a repository's open security-alert posture. */
export type SecurityGrade = NonNullable<SecuritySignalSlice['grade']>;

/**
 * Weighted "needs attention" score (higher = more urgent): critical dominates,
 * then high, medium, low. Feeds the column's descending sort and the future
 * composite "most broken" ranking (research-api §4).
 */
export function computeSecurityScore(counts: SecurityCounts): number {
  return counts.critical * 100 + counts.high * 20 + counts.medium * 5 + counts.low;
}

/**
 * Maps open-alert counts to a letter grade (research-api §4). The grade is set
 * by the worst severity present and escalated by volume:
 *
 *  - A — no open alerts
 *  - B — a few (1–9) low-severity alerts only
 *  - C — many lows (≥10) or a light medium load (1–4)
 *  - D — a heavy medium load (≥5) or a couple of highs (1–2)
 *  - E — several high-severity alerts (≥3)
 *  - F — any critical alert
 */
export function computeGrade(counts: SecurityCounts): SecurityGrade {
  if (counts.critical > 0) return 'F';
  if (counts.high > 0) return counts.high >= 3 ? 'E' : 'D';
  if (counts.medium > 0) return counts.medium >= 5 ? 'D' : 'C';
  if (counts.low > 0) return counts.low >= 10 ? 'C' : 'B';
  return 'A';
}
