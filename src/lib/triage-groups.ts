/**
 * Pure band-classification logic for the Triage "what needs me now" surface
 * (T-g1). Framework-free helpers that bucket each repo into a single attention
 * band, worst-first, so the {@link TriageView} component stays a thin renderer
 * and the grouping is unit-testable on its own.
 *
 * The signal semantics are NOT reinvented here — they mirror the per-signal
 * predicates in `fleet-summary.ts` (only `ready` slices count, so a
 * loading/error/unknown signal never prematurely bands a repo). The "Needs
 * attention" band is exactly the existing `broken` health band, reused via
 * {@link classifyRepoHealth}.
 */
import type { RepoSignalData, Repo, GetRowData } from '../types/fleet';
import { classifyRepoHealth } from './fleet-summary';

/**
 * A repo's attention band, worst-first:
 * - `needs-attention` — the `broken` health band (failing CI / D–F security /
 *   issues over threshold).
 * - `waiting-on-me` — open PRs awaiting the viewer's review.
 * - `community` — a new outside-contributor PR.
 * - `watch` — stale open items or a C-grade security warning.
 * - `healthy` — no attention signals.
 */
export type TriageBand = 'needs-attention' | 'waiting-on-me' | 'community' | 'watch' | 'healthy';

/** The attention bands in worst-first precedence order. */
export const TRIAGE_BAND_ORDER: readonly TriageBand[] = [
  'needs-attention',
  'waiting-on-me',
  'community',
  'watch',
  'healthy',
] as const;

/** Human-readable section labels for each band. */
export const TRIAGE_BAND_LABELS: Record<TriageBand, string> = {
  'needs-attention': 'Needs attention',
  'waiting-on-me': 'Waiting on me',
  community: 'Community',
  watch: 'Watch',
  healthy: 'Healthy',
};

/** D–F grades are the "security risk" band (mirrors `fleet-summary` semantics). */
const RISK_GRADES: ReadonlySet<NonNullable<NonNullable<RepoSignalData['security']>['grade']>> =
  new Set(['D', 'E', 'F']);

/** True when the repo's latest CI run resolved to a failure. */
export function hasFailingCi(data: RepoSignalData): boolean {
  return data.ci?.status === 'ready' && data.ci.conclusion === 'failure';
}

/** True when the repo's security grade resolved to a D–F risk grade. */
export function hasSecurityRisk(data: RepoSignalData): boolean {
  if (data.security?.status !== 'ready') {
    return false;
  }
  const { grade } = data.security;
  return grade !== undefined && RISK_GRADES.has(grade);
}

/** True when the repo's open-issue backlog resolved as over the triage threshold. */
export function hasIssuesOverThreshold(data: RepoSignalData): boolean {
  return data.issues?.status === 'ready' && data.issues.overThreshold === true;
}

/** True when the repo has one or more PRs awaiting the viewer's review. */
export function hasReviewRequest(data: RepoSignalData): boolean {
  return data.reviews?.status === 'ready' && (data.reviews.requestedCount ?? 0) > 0;
}

/** True when the repo has a new outside-contributor PR. */
export function hasExternalPr(data: RepoSignalData): boolean {
  return data.pullRequests?.status === 'ready' && (data.pullRequests.externalCount ?? 0) > 0;
}

/** True when the repo has one or more stale open items. */
export function hasStaleItems(data: RepoSignalData): boolean {
  return data.stale?.status === 'ready' && (data.stale.staleCount ?? 0) > 0;
}

/** True when the repo's security grade resolved to the amber C warning. */
export function hasSecurityWarning(data: RepoSignalData): boolean {
  return data.security?.status === 'ready' && data.security.grade === 'C';
}

/**
 * Buckets a single repo's signals into its highest applicable attention band.
 * Precedence follows {@link TRIAGE_BAND_ORDER}, so a repo that qualifies for
 * several bands is reported once, in the worst one.
 */
export function classifyTriageBand(data: RepoSignalData): TriageBand {
  if (classifyRepoHealth(data) === 'broken') {
    return 'needs-attention';
  }
  if (hasReviewRequest(data)) {
    return 'waiting-on-me';
  }
  if (hasExternalPr(data)) {
    return 'community';
  }
  if (hasStaleItems(data) || hasSecurityWarning(data)) {
    return 'watch';
  }
  return 'healthy';
}

/** A band section: the band plus the repos that fall into it, in input order. */
export interface TriageGroup {
  band: TriageBand;
  repos: Repo[];
}

/** The complete triage model: worst-first non-empty groups, counts, all-clear. */
export interface TriageModel {
  /** Non-empty band groups in worst-first order. */
  groups: TriageGroup[];
  /** Per-band repo counts (always includes every band, even at zero). */
  counts: Record<TriageBand, number>;
  /** Total repositories classified. */
  total: number;
  /** True when there is at least one repo and every one is healthy. */
  allClear: boolean;
}

/**
 * Builds the triage model from a fleet list: classifies each repo into its
 * highest band, groups worst-first (omitting empty bands), and reports counts.
 * Pure — never mutates the input array.
 */
export function buildTriageModel(repos: Repo[], getRowData: GetRowData): TriageModel {
  const buckets: Record<TriageBand, Repo[]> = {
    'needs-attention': [],
    'waiting-on-me': [],
    community: [],
    watch: [],
    healthy: [],
  };

  for (const repo of repos) {
    buckets[classifyTriageBand(getRowData(repo))].push(repo);
  }

  const counts = {} as Record<TriageBand, number>;
  for (const band of TRIAGE_BAND_ORDER) {
    counts[band] = buckets[band].length;
  }

  const groups: TriageGroup[] = TRIAGE_BAND_ORDER.filter((band) => buckets[band].length > 0).map(
    (band) => ({ band, repos: buckets[band] }),
  );

  const total = repos.length;
  const allClear = total > 0 && counts.healthy === total;

  return { groups, counts, total, allClear };
}
