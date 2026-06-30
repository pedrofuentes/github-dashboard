/**
 * Data model for the scalable repo filter (filter v2). This is the React-free
 * foundation the faceted filter popover and global scope will consume — there is
 * intentionally NO UI here.
 *
 * It owns three things:
 *  - {@link RepoFilterQueryV2}: the typed + Zod-validated query shape, with
 *    defensively bounded arrays (mirroring the caps in `dashboard-layout.ts`).
 *  - Persistence via {@link createVersionedStore} under {@link STORAGE_KEY_V2},
 *    plus a one-time {@link migrateLegacyRepoFilter} that upgrades the legacy
 *    `string[]` selection (under the OLD key) into a v2 query without deleting it.
 *  - Pure {@link evaluateRepoFilterQuery}: AND across facet GROUPS, OR within a
 *    group; an empty group imposes no constraint. Health reuses
 *    {@link classifyRepoHealth} so signal semantics are never reinvented.
 */
import { z } from 'zod';

import type { GetRowData, Repo, RepoSignalData } from '../types/fleet';
import { MAX_STRING_LENGTH } from './dashboard-layout';
import { classifyRepoHealth } from './fleet-summary';
import { createVersionedStore, type VersionedStore } from './versioned-storage';

/** Versioned key holding the persisted v2 query. */
export const STORAGE_KEY_V2 = 'fleet:repo-filter:v2';

/** The pre-v2 key: a bare `string[]` of `nameWithOwner`, kept for rollback. */
export const LEGACY_REPO_FILTER_KEY = 'fleet:repo-filter';

/**
 * Defensive caps on the persisted query's unbounded arrays, mirroring
 * `dashboard-layout.ts`. They bound a corrupt/hostile payload — a malformed
 * value fails the schema and degrades to {@link EMPTY_QUERY} — not legitimate use.
 */
/** Cap on the include/exclude name list (one entry per repo, generous headroom). */
export const MAX_SELECTION_NAMES = 1000;
/** Cap on the owners facet (at most one entry per distinct owner). */
export const MAX_OWNERS = 1000;

const GradeSchema = z.enum(['A', 'B', 'C', 'D', 'E', 'F']);
const SeveritySchema = z.enum(['critical', 'high', 'medium', 'low']);
const RepoNameSchema = z.string().min(1).max(MAX_STRING_LENGTH);

/** Grade badness order (A best … F worst), used for the `maxGrade` comparison. */
const GRADE_ORDER: Record<z.infer<typeof GradeSchema>, number> = {
  A: 0,
  B: 1,
  C: 2,
  D: 3,
  E: 4,
  F: 5,
};

const SecurityFacetSchema = z.object({
  grades: z.array(GradeSchema).max(6),
  maxGrade: GradeSchema.optional(),
  severities: z.array(SeveritySchema).max(4),
  truncated: z.boolean().optional(),
});

const FacetsSchema = z.object({
  owners: z.array(RepoNameSchema).max(MAX_OWNERS),
  health: z.array(z.enum(['broken', 'warning', 'healthy'])).max(3),
  ci: z.array(z.enum(['failure', 'in_progress', 'queued', 'success', 'none'])).max(5),
  security: SecurityFacetSchema,
  pullRequests: z.array(z.enum(['open', 'external'])).max(2),
  reviews: z.array(z.enum(['awaiting-me'])).max(1),
  issues: z.array(z.enum(['open', 'over-threshold'])).max(2),
  stale: z.array(z.enum(['any', 'pr', 'issue'])).max(3),
  visibility: z.array(z.enum(['private', 'public'])).max(2),
});

const RepoSelectionSchema = z.object({
  mode: z.enum(['all', 'include', 'exclude']),
  names: z.array(RepoNameSchema).max(MAX_SELECTION_NAMES),
});

/** Zod schema for {@link RepoFilterQueryV2}; the persisted value must satisfy it. */
export const RepoFilterQueryV2Schema = z.object({
  version: z.literal(2),
  text: z.string().max(MAX_STRING_LENGTH),
  repoSelection: RepoSelectionSchema,
  facets: FacetsSchema,
});

/** The scalable repo-filter query: text + repo pin + faceted constraints. */
export type RepoFilterQueryV2 = z.infer<typeof RepoFilterQueryV2Schema>;

function emptyFacets(): RepoFilterQueryV2['facets'] {
  return {
    owners: [],
    health: [],
    ci: [],
    security: { grades: [], severities: [] },
    pullRequests: [],
    reviews: [],
    issues: [],
    stale: [],
    visibility: [],
  };
}

/** Builds a fresh "all repos shown" query (no shared mutable state). */
function emptyQuery(): RepoFilterQueryV2 {
  return {
    version: 2,
    text: '',
    repoSelection: { mode: 'all', names: [] },
    facets: emptyFacets(),
  };
}

/**
 * The canonical empty query: text '', mode 'all', empty facets ⇒ "all repos shown".
 * Deeply frozen to prevent accidental mutation by consumers.
 */
export const EMPTY_QUERY: RepoFilterQueryV2 = (function deepFreeze() {
  const query = emptyQuery();
  Object.freeze(query);
  Object.freeze(query.repoSelection);
  Object.freeze(query.repoSelection.names);
  Object.freeze(query.facets);
  Object.freeze(query.facets.owners);
  Object.freeze(query.facets.health);
  Object.freeze(query.facets.ci);
  Object.freeze(query.facets.security);
  Object.freeze(query.facets.security.grades);
  Object.freeze(query.facets.security.severities);
  Object.freeze(query.facets.pullRequests);
  Object.freeze(query.facets.reviews);
  Object.freeze(query.facets.issues);
  Object.freeze(query.facets.stale);
  Object.freeze(query.facets.visibility);
  return query;
})();

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Legacy persisted shape: a bounded `string[]` of `nameWithOwner`. */
const LegacyRepoFilterSchema = z.array(RepoNameSchema).max(MAX_SELECTION_NAMES);

/**
 * Maps a legacy selection into a v2 query. A non-empty list becomes an `include`
 * pin (the legacy semantics); an empty list maps to {@link EMPTY_QUERY}, since
 * an empty legacy selection meant "all repos shown", not "no repos".
 */
function legacyArrayToQuery(names: readonly string[]): RepoFilterQueryV2 {
  const unique = [...new Set(names)];
  if (unique.length === 0) return emptyQuery();
  return {
    version: 2,
    text: '',
    repoSelection: { mode: 'include', names: unique },
    facets: emptyFacets(),
  };
}

/**
 * `createVersionedStore` migrate hook: upgrades a bare `string[]` found under
 * the v2 key (a legacy payload written there) into a v2 query before validation.
 * Anything else is passed through unchanged (an already-v2 object validates; a
 * corrupt value fails the schema and degrades to {@link EMPTY_QUERY}).
 */
function migrate(raw: unknown): unknown {
  if (Array.isArray(raw)) {
    const result = LegacyRepoFilterSchema.safeParse(raw);
    return result.success ? legacyArrayToQuery(result.data) : raw;
  }
  return raw;
}

/** Builds the defensive, versioned store for the v2 query. */
export function createRepoFilterQueryStore(): VersionedStore<RepoFilterQueryV2> {
  return createVersionedStore<RepoFilterQueryV2>({
    key: STORAGE_KEY_V2,
    schema: RepoFilterQueryV2Schema,
    fallback: emptyQuery,
    migrate,
  });
}

/**
 * One-time cross-key migration: if no v2 payload exists yet, read the legacy
 * `string[]` (under the OLD key), and seed the v2 store with an equivalent
 * `include` query. The legacy key is preserved for rollback. Prefers an existing
 * v2 payload and never throws. Returns `true` only when it successfully wrote
 * and persisted a v2 value; returns `false` if the write failed (e.g., quota).
 */
export function migrateLegacyRepoFilter(
  store: VersionedStore<RepoFilterQueryV2> = createRepoFilterQueryStore(),
): boolean {
  if (safeGet(STORAGE_KEY_V2) !== null) return false;

  const raw = safeGet(LEGACY_REPO_FILTER_KEY);
  if (raw === null) return false;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return false;
  }

  const result = LegacyRepoFilterSchema.safeParse(parsed);
  if (!result.success) return false;

  return store.save(legacyArrayToQuery(result.data));
}

function matchesText(text: string, repo: Repo): boolean {
  const needle = text.trim().toLowerCase();
  if (needle === '') return true;
  return (
    repo.nameWithOwner.toLowerCase().includes(needle) ||
    repo.owner.toLowerCase().includes(needle) ||
    repo.name.toLowerCase().includes(needle)
  );
}

function matchesCi(selected: RepoFilterQueryV2['facets']['ci'], data: RepoSignalData): boolean {
  if (data.ci?.status !== 'ready') return false;
  const { conclusion } = data.ci;
  return conclusion !== undefined && selected.includes(conclusion);
}

function matchesSecurity(
  facet: RepoFilterQueryV2['facets']['security'],
  data: RepoSignalData,
): boolean {
  const constrained =
    facet.grades.length > 0 ||
    facet.maxGrade !== undefined ||
    facet.severities.length > 0 ||
    facet.truncated !== undefined;
  if (!constrained) return true;

  const security = data.security;
  if (security?.status !== 'ready') return false;

  if (facet.grades.length > 0 || facet.maxGrade !== undefined) {
    const { grade } = security;
    if (grade === undefined) return false;
    const byList = facet.grades.includes(grade);
    const byMax = facet.maxGrade !== undefined && GRADE_ORDER[grade] >= GRADE_ORDER[facet.maxGrade];
    if (!byList && !byMax) return false;
  }

  if (facet.severities.length > 0) {
    const counts = security.counts;
    if (!counts) return false;
    if (!facet.severities.some((severity) => counts[severity] > 0)) return false;
  }

  if (facet.truncated !== undefined && (security.truncated ?? false) !== facet.truncated) {
    return false;
  }

  return true;
}

function matchesPullRequests(
  selected: RepoFilterQueryV2['facets']['pullRequests'],
  data: RepoSignalData,
): boolean {
  if (data.pullRequests?.status !== 'ready') return false;
  const slice = data.pullRequests;
  return selected.some((value) =>
    value === 'open' ? (slice.openCount ?? 0) > 0 : (slice.externalCount ?? 0) > 0,
  );
}

function matchesReviews(data: RepoSignalData): boolean {
  return data.reviews?.status === 'ready' && (data.reviews.requestedCount ?? 0) > 0;
}

function matchesIssues(
  selected: RepoFilterQueryV2['facets']['issues'],
  data: RepoSignalData,
): boolean {
  if (data.issues?.status !== 'ready') return false;
  const slice = data.issues;
  return selected.some((value) =>
    value === 'open' ? (slice.openCount ?? 0) > 0 : slice.overThreshold === true,
  );
}

function matchesStale(
  selected: RepoFilterQueryV2['facets']['stale'],
  data: RepoSignalData,
): boolean {
  if (data.stale?.status !== 'ready') return false;
  const slice = data.stale;
  return selected.some((value) => {
    if (value === 'any') return (slice.staleCount ?? 0) > 0;
    return (slice.staleItems ?? []).some((item) => item.type === value);
  });
}

function matchesVisibility(
  selected: RepoFilterQueryV2['facets']['visibility'],
  repo: Repo,
): boolean {
  return selected.some((value) => (value === 'private' ? repo.isPrivate : !repo.isPrivate));
}

function matchesFacets(
  facets: RepoFilterQueryV2['facets'],
  repo: Repo,
  data: RepoSignalData,
): boolean {
  if (facets.owners.length > 0 && !facets.owners.includes(repo.owner)) return false;
  if (facets.health.length > 0 && !facets.health.includes(classifyRepoHealth(data))) return false;
  if (facets.ci.length > 0 && !matchesCi(facets.ci, data)) return false;
  if (!matchesSecurity(facets.security, data)) return false;
  if (facets.pullRequests.length > 0 && !matchesPullRequests(facets.pullRequests, data)) {
    return false;
  }
  if (facets.reviews.length > 0 && !matchesReviews(data)) return false;
  if (facets.issues.length > 0 && !matchesIssues(facets.issues, data)) return false;
  if (facets.stale.length > 0 && !matchesStale(facets.stale, data)) return false;
  if (facets.visibility.length > 0 && !matchesVisibility(facets.visibility, repo)) return false;
  return true;
}

/**
 * Evaluates the query against the fleet, returning the set of matching
 * `nameWithOwner`. Semantics: `text` and every non-empty facet group are ANDed
 * (OR within a group); an empty group imposes no constraint; only `ready` slices
 * satisfy a positive facet. `repoSelection` applies LAST — `all` pins nothing,
 * `include` intersects with its names, `exclude` removes them. Pure; never throws.
 */
export function evaluateRepoFilterQuery(
  query: RepoFilterQueryV2,
  repos: readonly Repo[],
  getRowData: GetRowData,
): Set<string> {
  const matched = new Set<string>();
  for (const repo of repos) {
    if (!matchesText(query.text, repo)) continue;
    if (!matchesFacets(query.facets, repo, getRowData(repo))) continue;
    matched.add(repo.nameWithOwner);
  }

  const { mode, names } = query.repoSelection;
  if (mode === 'all') return matched;

  const pinned = new Set(names);
  if (mode === 'include') {
    return new Set([...matched].filter((name) => pinned.has(name)));
  }
  return new Set([...matched].filter((name) => !pinned.has(name)));
}

/**
 * The projection consumers use to know which repos are selected. Aliases
 * {@link evaluateRepoFilterQuery}; kept as a named export so call sites express
 * intent and the underlying evaluation can evolve behind it.
 */
export function derivedSelectedSet(
  query: RepoFilterQueryV2,
  repos: readonly Repo[],
  getRowData: GetRowData,
): Set<string> {
  return evaluateRepoFilterQuery(query, repos, getRowData);
}

/**
 * Whether the query narrows the fleet at all: any text, any facet, or a
 * narrowing selection (`include`, or `exclude` with names). An empty/`all`
 * query with no facets returns `false` ("all repos shown").
 */
export function isQueryActive(query: RepoFilterQueryV2): boolean {
  const { facets, repoSelection } = query;
  const securityActive =
    facets.security.grades.length > 0 ||
    facets.security.maxGrade !== undefined ||
    facets.security.severities.length > 0 ||
    facets.security.truncated !== undefined;
  const facetsActive =
    facets.owners.length > 0 ||
    facets.health.length > 0 ||
    facets.ci.length > 0 ||
    securityActive ||
    facets.pullRequests.length > 0 ||
    facets.reviews.length > 0 ||
    facets.issues.length > 0 ||
    facets.stale.length > 0 ||
    facets.visibility.length > 0;
  const selectionActive =
    repoSelection.mode === 'include' ||
    (repoSelection.mode === 'exclude' && repoSelection.names.length > 0);
  return query.text.trim() !== '' || facetsActive || selectionActive;
}
