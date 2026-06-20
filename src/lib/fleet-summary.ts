/**
 * Fleet-wide health aggregation for the at-a-glance Dashboard view (M10 T5).
 *
 * Pure, React-free helpers that roll the per-repo {@link RepoSignalData} slices
 * up into a single glanceable summary. The "health" classification reuses the
 * existing slice semantics (it never invents new signal meanings):
 *
 * - **broken** — any failing CI run, a D–F security grade, or an over-threshold
 *   issue backlog. These are the "needs attention now" repos.
 * - **warning** — not broken, but carrying an amber signal: a C security grade,
 *   a pending review request, or stale open items.
 * - **healthy** — everything else (including not-yet-resolved fleets).
 *
 * Only `ready` slices contribute, so a loading/error/unknown signal never
 * prematurely marks a repo broken or warning.
 */
import type { RepoSignalData } from '../types/fleet';

/** A repo's fleet-health bucket, worst-first. */
export type RepoHealth = 'broken' | 'warning' | 'healthy';

/** Aggregated fleet health plus the per-signal rollups the summary tile shows. */
export interface FleetHealthSummary {
  /** Total repositories in the fleet. */
  total: number;
  /** Repos needing attention now (failing CI / D–F security / over-threshold). */
  broken: number;
  /** Repos with an amber signal (C security / review-requested / stale). */
  warning: number;
  /** Repos with no attention signals. */
  healthy: number;
  /** Repos with at least one failing CI run. */
  failingCi: number;
  /** Repos whose security grade is D–F. */
  securityRisk: number;
  /** Repos whose open-issue backlog is over the triage threshold. */
  issuesOverThreshold: number;
  /** Repos with one or more stale open items. */
  staleRepos: number;
  /** Total pull requests awaiting the viewer's review across the fleet. */
  reviewRequested: number;
}

/** D–F grades are the "security risk" band (matches the SecurityCell styling). */
const RISK_GRADES: ReadonlySet<NonNullable<NonNullable<RepoSignalData['security']>['grade']>> =
  new Set(['D', 'E', 'F']);

function hasFailingCi(data: RepoSignalData): boolean {
  return data.ci?.status === 'ready' && data.ci.conclusion === 'failure';
}

function hasSecurityRisk(data: RepoSignalData): boolean {
  if (data.security?.status !== 'ready') {
    return false;
  }
  const { grade } = data.security;
  return grade !== undefined && RISK_GRADES.has(grade);
}

function hasIssuesOverThreshold(data: RepoSignalData): boolean {
  return data.issues?.status === 'ready' && data.issues.overThreshold === true;
}

function hasSecurityWarning(data: RepoSignalData): boolean {
  return data.security?.status === 'ready' && data.security.grade === 'C';
}

function reviewRequestedCount(data: RepoSignalData): number {
  if (data.reviews?.status !== 'ready') {
    return 0;
  }
  const count = data.reviews.requestedCount;
  return Number.isFinite(count) ? (count as number) : 0;
}

function staleCount(data: RepoSignalData): number {
  if (data.stale?.status !== 'ready') {
    return 0;
  }
  const count = data.stale.staleCount;
  return Number.isFinite(count) ? (count as number) : 0;
}

/** Buckets a single repo's signals into its worst-first health band. */
export function classifyRepoHealth(data: RepoSignalData): RepoHealth {
  if (hasFailingCi(data) || hasSecurityRisk(data) || hasIssuesOverThreshold(data)) {
    return 'broken';
  }
  if (hasSecurityWarning(data) || reviewRequestedCount(data) > 0 || staleCount(data) > 0) {
    return 'warning';
  }
  return 'healthy';
}

/**
 * Rolls a fleet's resolved signal data up into a {@link FleetHealthSummary}.
 * Accepts any iterable of {@link RepoSignalData} (e.g. a `Map.values()`) so the
 * caller can reuse the per-repo data it already resolved — without re-invoking
 * `getRowData`.
 */
export function summarizeFleetHealth(rows: Iterable<RepoSignalData>): FleetHealthSummary {
  const summary: FleetHealthSummary = {
    total: 0,
    broken: 0,
    warning: 0,
    healthy: 0,
    failingCi: 0,
    securityRisk: 0,
    issuesOverThreshold: 0,
    staleRepos: 0,
    reviewRequested: 0,
  };

  for (const data of rows) {
    summary.total += 1;
    summary[classifyRepoHealth(data)] += 1;
    if (hasFailingCi(data)) {
      summary.failingCi += 1;
    }
    if (hasSecurityRisk(data)) {
      summary.securityRisk += 1;
    }
    if (hasIssuesOverThreshold(data)) {
      summary.issuesOverThreshold += 1;
    }
    if (staleCount(data) > 0) {
      summary.staleRepos += 1;
    }
    summary.reviewRequested += reviewRequestedCount(data);
  }

  return summary;
}
