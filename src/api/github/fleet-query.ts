/**
 * Registry-driven batched GraphQL fleet-query infrastructure.
 *
 * This is the API-layer machinery for the REST→GraphQL fleet-health migration.
 * It turns a list of {@link Repo}s into a single GraphQL document that fetches
 * every repo's signals in one round-trip, then folds the response back into one
 * slice per (signal, repo) pair. Nothing consumes it yet — a later increment
 * wires it into a hook behind a flag — so this module is pure infrastructure
 * with zero runtime behavior change.
 *
 * Design goals:
 *  - **Cost**: each repo is emitted as a TOP-LEVEL singular `repository(...)`
 *    alias (`r0`, `r1`, …), never nested under a `repositories(...)` connection,
 *    so there is no ancestor multiplier on the GraphQL point cost.
 *  - **Extensibility**: signals are registered in {@link SIGNAL_DERIVERS}. A new
 *    signal is ONE registry entry — a per-repo deriver contributes a selection
 *    fragment inside each repo alias; a top-level deriver contributes an aliased
 *    top-level `search(...)`/field. Neither {@link buildFleetQuery} nor
 *    {@link executeFleetBatch} need editing to add one.
 *  - **Isolation**: a path-scoped error index ({@link buildErrorIndex}) lets each
 *    deriver decide whether *its own* field on *one* repo failed, so one null
 *    field never errors a sibling signal and one bad repo never errors another.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */

import { z, type ZodType } from 'zod';

import { isAbortError } from '../../lib/abort';
import {
  MAX_REVIEW_PAGES,
  REVIEW_REQUESTED_QUERY,
  REVIEW_SCORE_WEIGHT,
} from '../../lib/reviews-constants';
import { STALE_ITEMS_PER_REPO, staleCutoffDate } from '../../lib/stale-cutoff';
import type { TileSignalType } from '../../types/dashboard';
import type {
  CiSignalSlice,
  IssuesSignalSlice,
  PullRequestsSignalSlice,
  Repo,
  ReviewRequestedPullRequest,
  ReviewsSignalSlice,
  SignalSlice,
  StaleItem,
  StaleSignalSlice,
} from '../../types/fleet';
import {
  GraphQLRateLimitPartSchema,
  fetchGraphQL,
  recordGraphQLCost,
  scheduleGraphQLRequest,
  type GraphQLError,
  type GraphQLRateLimitPart,
} from './graphql';

// ── Repo node schema (the per-repo shape every per-repo deriver queries) ─────

/** Zod schema for the `statusCheckRollup` on a default-branch HEAD commit. */
const StatusCheckRollupSchema = z.object({ state: z.string() }).passthrough();

/** Zod schema for the `... on Commit` target of a `defaultBranchRef`. */
const CommitTargetSchema = z
  .object({ statusCheckRollup: StatusCheckRollupSchema.nullable().optional() })
  .passthrough();

/** Zod schema for a repo's `defaultBranchRef` (null when there is no branch). */
const DefaultBranchRefSchema = z
  .object({ target: CommitTargetSchema.nullable().optional() })
  .passthrough();

/** Zod schema for a `{ totalCount }` issue-count field (issues + myIssues). */
const IssueCountSchema = z.object({ totalCount: z.number() }).passthrough();

/** Zod schema for one node in a `pullRequests` connection. */
const PullRequestNodeSchema = z
  .object({
    number: z.number(),
    title: z.string(),
    url: z.string(),
    createdAt: z.string(),
    isDraft: z.boolean(),
    authorAssociation: z.string(),
    author: z.object({ login: z.string() }).passthrough().nullable().optional(),
  })
  .passthrough();

/** Zod schema for the `pullRequests { nodes [...] }` connection. */
const PullRequestsConnectionSchema = z
  .object({ nodes: z.array(PullRequestNodeSchema) })
  .passthrough();

/**
 * Zod schema for one repository node as selected by the fleet query. Only
 * `nameWithOwner` is required (it keys every slice); all signal-specific fields
 * are optional/nullable so a documented null (no default branch, null rollup,
 * archived repo) parses cleanly instead of throwing.
 */
export const FleetRepoNodeSchema = z
  .object({
    nameWithOwner: z.string(),
    isArchived: z.boolean().optional(),
    defaultBranchRef: DefaultBranchRefSchema.nullable().optional(),
    openIssues: IssueCountSchema.nullable().optional(),
    myIssues: IssueCountSchema.nullable().optional(),
    pullRequests: PullRequestsConnectionSchema.nullable().optional(),
  })
  .passthrough();

/** A validated repository node from the fleet query. */
export type FleetRepoNode = z.infer<typeof FleetRepoNodeSchema>;

/** Zod schema for the `viewer { login }` top-level selection. */
const ViewerSchema = z.object({ login: z.string() }).passthrough();

/**
 * The validated `data` payload of a fleet query. Repo aliases (`r0`, `r1`, …)
 * are dynamic, so they are reached through the index signature; `viewer` and
 * `rateLimit` are always present in the selection set.
 */
export interface FleetQueryData {
  viewer: { login: string } | null;
  rateLimit?: GraphQLRateLimitPart;
  [alias: string]: FleetRepoNode | { login: string } | GraphQLRateLimitPart | null | undefined;
}

/**
 * Builds the Zod schema for a chunk of `repoCount` repos. The repo aliases are
 * generated dynamically (`r0`..`r{repoCount-1}`) to mirror {@link buildFleetQuery}.
 */
function buildChunkDataSchema(repoCount: number): ZodType<FleetQueryData> {
  const shape: Record<string, ZodType> = {
    viewer: ViewerSchema.nullable(),
    rateLimit: GraphQLRateLimitPartSchema.optional(),
  };
  for (let i = 0; i < repoCount; i += 1) {
    shape[`r${i}`] = FleetRepoNodeSchema.nullable();
  }
  return z.object(shape).passthrough() as unknown as ZodType<FleetQueryData>;
}

// ── Path-scoped error index ──────────────────────────────────────────────────

/**
 * A lookup over a chunk's `GraphQLError[]`, keyed by each error's dot-joined
 * `path` (e.g. `"r2"`, `"r2.defaultBranchRef"`). It lets a deriver scope error
 * detection to its own field on one repo so failures never bleed across signals
 * or repos. Pathless (global) errors are intentionally excluded — they map to
 * no alias and must not taint any specific signal.
 */
export interface FleetErrorIndex {
  /** Whether a dot-joined `path` is present exactly. */
  has(path: string): boolean;
  /**
   * Whether `path` itself OR any descendant in its subtree errored. Use this to
   * ask "did my field (or anything under it) fail?" — e.g. `coversField("r2")`
   * is true when the whole repo errored or any field under it did, while
   * `coversField("r2.defaultBranchRef")` stays false for an unrelated
   * `r2.pullRequests` error (sibling-signal isolation).
   */
  coversField(path: string): boolean;
  /** All dot-joined error paths (diagnostics / tests). */
  readonly paths: ReadonlySet<string>;
}

/**
 * Builds a {@link FleetErrorIndex} from a chunk's GraphQL errors.
 *
 * @param errors - The `errors[]` array from a {@link fetchGraphQL} result.
 */
export function buildErrorIndex(errors: GraphQLError[]): FleetErrorIndex {
  const paths = new Set<string>();
  for (const err of errors) {
    if (!err.path || err.path.length === 0) continue;
    paths.add(err.path.join('.'));
  }
  return {
    paths,
    has: (path: string): boolean => paths.has(path),
    coversField: (path: string): boolean => {
      if (paths.has(path)) return true;
      const prefix = `${path}.`;
      for (const key of paths) {
        if (key.startsWith(prefix)) return true;
      }
      return false;
    },
  };
}

// ── SignalDeriver registry ───────────────────────────────────────────────────

/**
 * Everything a deriver needs to fold one chunk's response into slices. Per-repo
 * derivers iterate {@link repos} and read {@link nodeFor}/{@link aliasFor} +
 * {@link errors}; top-level derivers read {@link data} (their aliased top-level
 * field) + {@link errors}. `repos[i]` corresponds to alias `r{i}`.
 */
export interface FleetChunkContext {
  /** Repos in this chunk, in alias order (`repos[i]` ⇄ alias `r{i}`). */
  readonly repos: readonly Repo[];
  /** Viewer login carried into the query (`null` when unauthenticated). */
  readonly viewerLogin: string | null;
  /** The validated `data` payload (top-level aliases for top-level derivers). */
  readonly data: FleetQueryData;
  /** Path-scoped error index for this chunk's response. */
  readonly errors: FleetErrorIndex;
  /** This repo's alias within the chunk (`r0`, `r1`, …). */
  aliasFor(repo: Repo): string;
  /** This repo's validated node, or `null` when absent/errored. */
  nodeFor(repo: Repo): FleetRepoNode | null;
}

/**
 * A signal's contribution to the batched query and its derivation. A deriver is
 * either:
 *  - **per-repo** (`kind: 'per-repo'`): provides {@link repoFragment} — a
 *    selection-set fragment composed INSIDE each `repository(...)` alias — and
 *    derives one slice per repo from that repo's node + the error index.
 *  - **top-level** (`kind: 'top-level'`): provides {@link topLevelFragment} — an
 *    aliased TOP-LEVEL `search(...)`/field — and derives from the top-level data.
 *    Composed once PER CHUNK alongside the per-repo aliases.
 *  - **top-level-global** (`kind: 'top-level-global'`): provides
 *    {@link topLevelFragment} + {@link topLevelVariables} for a SINGLE fleet-wide
 *    query run EXACTLY ONCE over the full repo list (never per chunk) — e.g. one
 *    cross-repo `search(review-requested:@me)`. {@link executeFleetBatch} runs it
 *    in a dedicated query, paginates up to {@link globalMaxPages} via the shared
 *    `$after` cursor, and merges the result into the per-signal maps.
 *
 * `derive` always returns a `Map<nameWithOwner, SignalSlice>`. The concrete
 * slice subtype is known from {@link signal} (e.g. `'ci'` ⇒ {@link CiSignalSlice});
 * callers narrow when reading.
 */
export interface SignalDeriver {
  /** The signal this deriver populates. */
  readonly signal: TileSignalType;
  /** Whether the deriver contributes inside each repo, at the top level, or once globally. */
  readonly kind: 'per-repo' | 'top-level' | 'top-level-global';
  /** Selection-set fragment composed inside each `repository(...)` alias. */
  repoFragment?(viewerLogin: string | null): string;
  /** Aliased top-level selection (e.g. a `search(...)` field). */
  topLevelFragment?(repos: readonly Repo[], viewerLogin: string | null): string;
  /**
   * Top-level query variables this deriver needs declared and bound. Each entry
   * contributes a `$<name>: <type>` declaration to {@link buildFleetQuery}'s
   * header and a `<name>: <value>` binding to {@link buildFleetVariables}. Used
   * to pass per-repo `search(...)` queries as BOUND variables (never inline
   * literals) so the document stays injection-safe.
   */
  topLevelVariables?(
    repos: readonly Repo[],
    viewerLogin: string | null,
  ): Array<{ name: string; type: string; value: string }>;
  /**
   * For `top-level-global` derivers: the alias of the paginated search
   * connection (e.g. `'reviews'`). The global runner reads this alias's
   * `pageInfo`/`nodes` to drive pagination and accumulation.
   */
  readonly globalSearchAlias?: string;
  /** For `top-level-global` derivers: the maximum number of pages to accumulate. */
  readonly globalMaxPages?: number;
  /** Folds the chunk (or global) context into one slice per `nameWithOwner`. */
  derive(ctx: FleetChunkContext): Map<string, SignalSlice>;
}

// ── CI deriver (reference per-repo deriver) ──────────────────────────────────

/** Failing repos must outrank everything else under the default desc sort. */
const SCORE_FAILING = 100;
const SCORE_RUNNING = 10;
const SCORE_NEUTRAL = 0;

/** Stable "no actionable CI signal" slice (no checks on the default branch). */
function ciNoneSlice(): CiSignalSlice {
  return { status: 'ready', conclusion: 'none', score: SCORE_NEUTRAL, failingCount: 0 };
}

/**
 * Per-repo CI selection fragment.
 *
 * ⚠️ SEMANTIC NOTE: `statusCheckRollup` reflects the aggregate check state on
 * the **default-branch HEAD commit**, NOT "the latest workflow run on any
 * branch" like the REST `/actions/runs?per_page=1` probe the legacy
 * `useCiSignal` hook uses. This is a deliberate, more-correct fleet-health
 * semantic: it answers "is the default branch currently green?" rather than
 * "did the most recent run anywhere pass?".
 */
function ciRepoFragment(): string {
  return [
    'isArchived',
    'defaultBranchRef {',
    '  target {',
    '    ... on Commit {',
    '      statusCheckRollup { state }',
    '    }',
    '  }',
    '}',
  ].join('\n');
}

/**
 * Folds one repo's node + the error index into a {@link CiSignalSlice} that is
 * value-identical in shape to what `useCiSignal` emits today.
 *
 * Mapping (GraphQL `StatusState` → slice):
 *  - `FAILURE` / `ERROR`  → failing (`conclusion: 'failure'`, score 100)
 *  - `PENDING`            → running (`conclusion: 'in_progress'`, score 10)
 *  - `EXPECTED`           → running (`conclusion: 'queued'`, score 10)
 *  - `SUCCESS`            → ok (`conclusion: 'success'`, score 0)
 *  - null rollup / no default branch / archived → `'none'` (ready, no checks)
 *  - the repo node or its `defaultBranchRef` subtree errored → `{ status: 'error' }`
 *
 * Isolation: a CI error is raised ONLY when the whole repo alias errored
 * (`has(alias)`) or the CI-owned `defaultBranchRef` subtree errored
 * (`coversField(alias.defaultBranchRef)`). An unrelated field error on the same
 * repo (a future sibling signal) never errors CI.
 */
function deriveCiSlice(
  node: FleetRepoNode | null,
  alias: string,
  errors: FleetErrorIndex,
): CiSignalSlice {
  if (errors.has(alias) || errors.coversField(`${alias}.defaultBranchRef`)) {
    return { status: 'error' };
  }
  // A null node WITHOUT a matching error is "no data", not a failure.
  if (!node || node.isArchived) return ciNoneSlice();

  const state = node.defaultBranchRef?.target?.statusCheckRollup?.state;
  switch (state) {
    case 'FAILURE':
    case 'ERROR':
      return { status: 'ready', conclusion: 'failure', score: SCORE_FAILING, failingCount: 1 };
    case 'PENDING':
      return { status: 'ready', conclusion: 'in_progress', score: SCORE_RUNNING, failingCount: 0 };
    case 'EXPECTED':
      return { status: 'ready', conclusion: 'queued', score: SCORE_RUNNING, failingCount: 0 };
    case 'SUCCESS':
      return { status: 'ready', conclusion: 'success', score: SCORE_NEUTRAL, failingCount: 0 };
    default:
      // null rollup, no default branch, or a non-Commit target → no checks.
      return ciNoneSlice();
  }
}

/** The reference CI deriver (default-branch `statusCheckRollup`). */
export const ciDeriver: SignalDeriver = {
  signal: 'ci',
  kind: 'per-repo',
  repoFragment: ciRepoFragment,
  derive(ctx: FleetChunkContext): Map<string, SignalSlice> {
    const out = new Map<string, SignalSlice>();
    for (const repo of ctx.repos) {
      out.set(repo.nameWithOwner, deriveCiSlice(ctx.nodeFor(repo), ctx.aliasFor(repo), ctx.errors));
    }
    return out;
  },
};

// ── Issues deriver (open-issue count; viewer mine/community split) ────────────

/**
 * Threshold above which a repo is considered in need of issue triage. Mirrors
 * {@link ISSUE_TRIAGE_THRESHOLD} in `useIssuesSignal` so the two paths produce
 * identical scores and bands without a cross-layer import.
 */
const ISSUE_TRIAGE_THRESHOLD = 20;

/**
 * Builds a ready slice from an open-issue count, mirroring `readySlice` in
 * `useIssuesSignal` so the GraphQL and REST paths are value-identical.
 */
function issuesReadySlice(openCount: number, mineCount?: number): IssuesSignalSlice {
  const overThreshold = openCount >= ISSUE_TRIAGE_THRESHOLD;
  const slice: IssuesSignalSlice = {
    status: 'ready',
    openCount,
    overThreshold,
    score: overThreshold ? openCount : Math.floor(openCount / 4),
  };
  if (mineCount !== undefined) {
    slice.mineCount = mineCount;
    slice.communityCount = Math.max(openCount - mineCount, 0);
  }
  return slice;
}

/**
 * Per-repo issues selection fragment.
 *
 * `issues(states: OPEN).totalCount` returns open issues only — pull requests
 * are excluded by the GraphQL Issues object (unlike the REST `open_issues_count`
 * field which includes PRs). This makes the REST subtract-PRs dance unnecessary.
 *
 * When `viewerLogin` is non-null/non-empty, a `myIssues` alias is added using
 * `filterBy: { createdBy: $viewer }` so the viewer's own open issues can be
 * split out. The `$viewer` query variable is declared by {@link buildFleetQuery}
 * whenever a non-null viewerLogin is present.
 */
function issuesRepoFragment(viewerLogin: string | null): string {
  const lines = ['openIssues: issues(states: OPEN) { totalCount }'];
  if (viewerLogin) {
    lines.push('myIssues: issues(states: OPEN, filterBy: { createdBy: $viewer }) { totalCount }');
  }
  return lines.join('\n');
}

/**
 * Folds one repo's node + the error index into an {@link IssuesSignalSlice}.
 *
 * Error guard: if the whole repo alias, its `openIssues` subtree, OR its
 * `myIssues` subtree errored → `{ status: 'error' }`. A `myIssues` error is
 * included because `myIssues` is a non-null `issues` connection in GitHub's
 * schema: if it errors at runtime, GraphQL's null-propagation nulls the entire
 * repository node (nearest nullable ancestor), so `openIssues` data is lost
 * too — returning a false `openCount: 0` would silently hide an unhealthy repo.
 * Absent node (no covering error) → zero ready slice. Otherwise derives from
 * `openIssues.totalCount`; if `myIssues` is present, includes the viewer's
 * mine/community split.
 */
function deriveIssuesSlice(
  node: FleetRepoNode | null,
  alias: string,
  errors: FleetErrorIndex,
): IssuesSignalSlice {
  if (
    errors.has(alias) ||
    errors.coversField(`${alias}.openIssues`) ||
    errors.coversField(`${alias}.myIssues`)
  ) {
    return { status: 'error' };
  }
  if (!node || !node.openIssues) return issuesReadySlice(0);
  const mineCount = node.myIssues?.totalCount ?? undefined;
  return issuesReadySlice(node.openIssues.totalCount, mineCount);
}

/** The issues deriver: open-issue count with optional viewer mine/community split. */
export const issuesDeriver: SignalDeriver = {
  signal: 'issues',
  kind: 'per-repo',
  repoFragment: issuesRepoFragment,
  derive(ctx: FleetChunkContext): Map<string, SignalSlice> {
    const out = new Map<string, SignalSlice>();
    for (const repo of ctx.repos) {
      out.set(
        repo.nameWithOwner,
        deriveIssuesSlice(ctx.nodeFor(repo), ctx.aliasFor(repo), ctx.errors),
      );
    }
    return out;
  },
};

// ── PR deriver (open / new-contributor pull requests) ────────────────────────

/**
 * `author_association` values that identify a new outside contributor (not a
 * member, owner, collaborator, or returning `CONTRIBUTOR`). Value-identical to
 * the same constant in `usePullRequestsSignal` so both REST and GraphQL paths
 * produce identical externalCount values.
 */
const OUTSIDE_CONTRIBUTOR_ASSOCIATIONS = new Set([
  'FIRST_TIME_CONTRIBUTOR',
  'FIRST_TIMER',
  'NONE',
  'MANNEQUIN',
]);

/**
 * Per-repo PR selection fragment.
 *
 * Fetches the first 100 OPEN pull requests — matching the REST hook's
 * `per_page=100` cap — so `openCount` is the non-draft subset of ≤100, never
 * an uncapped server total. `totalCount` is intentionally omitted: it would
 * include drafts and exceed the 100-item cap, diverging from REST semantics.
 */
function prRepoFragment(): string {
  return [
    'pullRequests(states: OPEN, first: 100) {',
    '  nodes { number title url createdAt isDraft authorAssociation author { login } }',
    '}',
  ].join('\n');
}

/**
 * Folds one repo's node + the error index into a {@link PullRequestsSignalSlice}
 * that is value-identical in shape to what `usePullRequestsSignal` emits today.
 *
 * openCount = non-draft PRs (drafts are WIP, not awaiting review)
 * externalCount = non-draft PRs whose authorAssociation ∈ OUTSIDE_CONTRIBUTOR_ASSOCIATIONS
 * score = externalCount * 5 + openCount  (new-contributor PRs weighted 5×)
 * externalPullRequests = identity list present only when externalCount > 0
 */
function derivePrSlice(
  node: FleetRepoNode | null,
  alias: string,
  errors: FleetErrorIndex,
): PullRequestsSignalSlice {
  if (errors.has(alias) || errors.coversField(`${alias}.pullRequests`)) {
    return { status: 'error' };
  }
  if (!node?.pullRequests) return { status: 'ready', openCount: 0, externalCount: 0, score: 0 };

  const nonDraft = node.pullRequests.nodes.filter((p) => !p.isDraft);
  const external = nonDraft.filter((p) =>
    OUTSIDE_CONTRIBUTOR_ASSOCIATIONS.has(p.authorAssociation),
  );
  const externalCount = external.length;
  const openCount = nonDraft.length;
  const score = externalCount * 5 + openCount;

  const slice: PullRequestsSignalSlice = { status: 'ready', openCount, externalCount, score };
  if (externalCount > 0) {
    slice.externalPullRequests = external.map((p) => ({
      number: p.number,
      title: p.title,
      html_url: p.url,
      created_at: p.createdAt,
      user_login: p.author?.login ?? '',
      author_association: p.authorAssociation,
    }));
  }
  return slice;
}

/** The PR deriver: open / new-contributor pull requests (non-draft, first 100). */
export const prDeriver: SignalDeriver = {
  signal: 'pullRequests',
  kind: 'per-repo',
  repoFragment: prRepoFragment,
  derive(ctx: FleetChunkContext): Map<string, SignalSlice> {
    const out = new Map<string, SignalSlice>();
    for (const repo of ctx.repos) {
      out.set(repo.nameWithOwner, derivePrSlice(ctx.nodeFor(repo), ctx.aliasFor(repo), ctx.errors));
    }
    return out;
  },
};

// ── Stale deriver (first top-level deriver: aliased GraphQL search) ──────────

/**
 * Builds the ready slice for a repo's stale tally, value-identical to
 * `readyStaleSlice` in `useStaleSignal` so the GraphQL and REST paths agree:
 * `score` is the raw count and `staleItems` is present only when non-empty.
 */
function staleReadySlice(staleCount: number, staleItems: StaleItem[] = []): StaleSignalSlice {
  const slice: StaleSignalSlice = { status: 'ready', staleCount, score: staleCount };
  if (staleItems.length > 0) {
    slice.staleItems = staleItems;
  }
  return slice;
}

/** Zod schema for one node in a stale `search(type: ISSUE)` connection. */
const StaleSearchNodeSchema = z
  .object({
    __typename: z.string(),
    number: z.number(),
    title: z.string(),
    url: z.string(),
    updatedAt: z.string(),
  })
  .passthrough();

/**
 * Zod schema for one aliased `stale_r{i}: search(...)` payload. Tolerant
 * (`.passthrough()`) so the many unused Search-connection fields don't break
 * validation; `issueCount` is the stale tally and `nodes` carry each item's
 * identity (defaulted to `[]` so a count-only payload still validates).
 */
const StaleSearchPayloadSchema = z
  .object({
    issueCount: z.number(),
    nodes: z.array(StaleSearchNodeSchema).optional().default([]),
  })
  .passthrough();

/** The stale alias for the repo at index `i` within a chunk. */
function staleAlias(index: number): string {
  return `stale_r${index}`;
}

/**
 * Top-level variables for the stale deriver: one `stale_r{i}: String!` bound to
 * the per-repo Search query (`repo:<owner>/<name> is:open updated:<<cutoff>`).
 * Passing it as a bound variable — never an inline literal — keeps the document
 * injection-safe (gql-2 review #534). The cutoff is the same UTC `YYYY-MM-DD`
 * threshold the REST hook uses, reused from `lib/stale-cutoff`.
 */
function staleTopLevelVariables(
  repos: readonly Repo[],
): Array<{ name: string; type: string; value: string }> {
  const cutoff = staleCutoffDate(new Date());
  return repos.map((repo, i) => ({
    name: staleAlias(i),
    type: 'String!',
    value: `repo:${repo.owner}/${repo.name} is:open updated:<${cutoff}`,
  }));
}

/**
 * Top-level fragment for the stale deriver: one aliased
 * `stale_r{i}: search(type: ISSUE, first: N, query: $stale_r{i})` per repo,
 * selecting `issueCount` (the tally) plus each node's identity. The per-repo
 * query reaches the document ONLY through the `$stale_r{i}` variable.
 */
function staleTopLevelFragment(repos: readonly Repo[]): string {
  return repos
    .map((_, i) => {
      const alias = staleAlias(i);
      return [
        `${alias}: search(type: ISSUE, first: ${STALE_ITEMS_PER_REPO}, query: $${alias}) {`,
        '  issueCount',
        '  nodes {',
        '    __typename',
        '    ... on Issue { number title url updatedAt }',
        '    ... on PullRequest { number title url updatedAt }',
        '  }',
        '}',
      ].join('\n');
    })
    .join('\n');
}

/**
 * Folds one repo's aliased search payload + the error index into a
 * {@link StaleSignalSlice} that is value-identical to what `useStaleSignal`
 * emits today.
 *
 * - The alias errored (`has`/`coversField`) → `{ status: 'error' }`.
 * - The alias is absent WITHOUT a covering error → ready-zero (no data), so a
 *   repo GitHub silently omitted never reads as a failure.
 * - Otherwise `issueCount` → `staleCount`/`score`; nodes → `staleItems`
 *   (`html_url`/`updated_at` un-projected, `type` from `__typename`), omitted
 *   when empty.
 */
function deriveStaleSlice(alias: string, ctx: FleetChunkContext): StaleSignalSlice {
  if (ctx.errors.has(alias) || ctx.errors.coversField(alias)) {
    return { status: 'error' };
  }
  const raw: unknown = ctx.data[alias];
  if (raw === null || raw === undefined) return staleReadySlice(0);

  const parsed = StaleSearchPayloadSchema.safeParse(raw);
  if (!parsed.success) return staleReadySlice(0);

  const staleItems: StaleItem[] = parsed.data.nodes.map((node) => ({
    number: node.number,
    title: node.title,
    html_url: node.url,
    updated_at: node.updatedAt,
    type: node.__typename === 'PullRequest' ? 'pr' : 'issue',
  }));
  return staleReadySlice(parsed.data.issueCount, staleItems);
}

/** The stale deriver: one aliased top-level `search(...)` per repo (issue #17). */
export const staleDeriver: SignalDeriver = {
  signal: 'stale',
  kind: 'top-level',
  topLevelVariables: staleTopLevelVariables,
  topLevelFragment: staleTopLevelFragment,
  derive(ctx: FleetChunkContext): Map<string, SignalSlice> {
    const out = new Map<string, SignalSlice>();
    ctx.repos.forEach((repo, i) => {
      out.set(repo.nameWithOwner, deriveStaleSlice(staleAlias(i), ctx));
    });
    return out;
  },
};

// ── Reviews deriver (top-level-global: ONE fleet-wide search) ────────────────

/** The single top-level alias for the fleet-wide reviews search. */
const REVIEWS_ALIAS = 'reviews';

/** Zod schema for one node in the reviews `search(type: ISSUE)` connection. */
const ReviewSearchNodeSchema = z
  .object({
    number: z.number(),
    title: z.string(),
    url: z.string(),
    createdAt: z.string(),
    author: z.object({ login: z.string() }).passthrough().nullable().optional(),
    repository: z.object({ nameWithOwner: z.string() }).passthrough(),
  })
  .passthrough();

/**
 * Zod schema for the accumulated `reviews: search(...)` payload. `issueCount`
 * (the fleet-wide exact total) is required so a malformed-but-present payload —
 * one missing it — fails to parse and yields `error` rather than a false
 * ready-zero (gql-7 review #552). `nodes` carry each requested PR's identity
 * (defaulted to `[]` so a count-only payload still validates).
 */
const ReviewSearchPayloadSchema = z
  .object({
    issueCount: z.number(),
    nodes: z.array(ReviewSearchNodeSchema).optional().default([]),
  })
  .passthrough();

type ReviewSearchNode = z.infer<typeof ReviewSearchNodeSchema>;

/**
 * Top-level fragment for the reviews deriver: a single aliased
 * `reviews: search(type: ISSUE, first: 100, query: $reviews_query, after: $after)`
 * selecting `issueCount` (exact fleet total), `pageInfo` (pagination), and each
 * node's identity. The search qualifier reaches the document ONLY through the
 * bound `$reviews_query` variable; `$after` is the shared pagination cursor.
 */
function reviewsTopLevelFragment(): string {
  return [
    `${REVIEWS_ALIAS}: search(type: ISSUE, first: 100, query: $reviews_query, after: $after) {`,
    '  issueCount',
    '  pageInfo { hasNextPage endCursor }',
    '  nodes {',
    '    ... on PullRequest {',
    '      number',
    '      title',
    '      url',
    '      createdAt',
    '      author { login }',
    '      repository { nameWithOwner }',
    '    }',
    '  }',
    '}',
  ].join('\n');
}

/**
 * Top-level variables for the reviews deriver: one `$reviews_query: String!`
 * bound to the constant `review-requested:@me` query. Passing it as a bound
 * variable — never an inline literal — keeps the document injection-safe even
 * though the query has no untrusted input (`@me` is server-resolved).
 */
function reviewsTopLevelVariables(): Array<{ name: string; type: string; value: string }> {
  return [{ name: 'reviews_query', type: 'String!', value: REVIEW_REQUESTED_QUERY }];
}

/**
 * Folds the accumulated reviews nodes into one ready {@link ReviewsSignalSlice}
 * per repo in `repos`: each repo's `requestedCount` is how many returned PRs
 * target it (zero when none), `score` is that count weighted for sort, and
 * `requests` un-projects each targeting PR's per-item identity (omitted when the
 * repo has none). Nodes for repos outside the fleet are ignored. Value-identical
 * to `distributeReviewCounts` in `useReviewsSignal`.
 */
function distributeReviewNodes(
  repos: readonly Repo[],
  nodes: readonly ReviewSearchNode[],
): Map<string, ReviewsSignalSlice> {
  const requestsByRepo = new Map<string, ReviewRequestedPullRequest[]>();
  for (const node of nodes) {
    const fullName = node.repository.nameWithOwner;
    const list = requestsByRepo.get(fullName) ?? [];
    list.push({
      number: node.number,
      title: node.title,
      html_url: node.url,
      created_at: node.createdAt,
      user_login: node.author?.login ?? '',
    });
    requestsByRepo.set(fullName, list);
  }

  const slices = new Map<string, ReviewsSignalSlice>();
  for (const repo of repos) {
    const requests = requestsByRepo.get(repo.nameWithOwner) ?? [];
    const requestedCount = requests.length;
    const slice: ReviewsSignalSlice = {
      status: 'ready',
      requestedCount,
      score: requestedCount * REVIEW_SCORE_WEIGHT,
    };
    if (requestedCount > 0) {
      slice.requests = requests;
    }
    slices.set(repo.nameWithOwner, slice);
  }
  return slices;
}

/** Sets every repo's reviews slice to the same lifecycle status. */
function uniformReviewsSlices(
  repos: readonly Repo[],
  status: 'error',
): Map<string, ReviewsSignalSlice> {
  const slices = new Map<string, ReviewsSignalSlice>();
  for (const repo of repos) slices.set(repo.nameWithOwner, { status });
  return slices;
}

/**
 * Folds the global reviews search payload + the error index into one
 * {@link ReviewsSignalSlice} per repo.
 *
 * - The alias errored (`has`/`coversField`) → every repo `{ status: 'error' }`.
 * - The alias is absent WITHOUT a covering error → ready-zero for all repos (no
 *   requested reviews anywhere).
 * - A malformed-but-present payload (fails the strict parse) → every repo
 *   `{ status: 'error' }`, never a false ready-zero (gql-7 #552).
 * - Otherwise the accumulated nodes are distributed per repo.
 */
function deriveReviewsSlices(ctx: FleetChunkContext): Map<string, ReviewsSignalSlice> {
  if (ctx.errors.has(REVIEWS_ALIAS) || ctx.errors.coversField(REVIEWS_ALIAS)) {
    return uniformReviewsSlices(ctx.repos, 'error');
  }
  const raw: unknown = ctx.data[REVIEWS_ALIAS];
  if (raw === null || raw === undefined) {
    return distributeReviewNodes(ctx.repos, []);
  }
  const parsed = ReviewSearchPayloadSchema.safeParse(raw);
  if (!parsed.success) {
    return uniformReviewsSlices(ctx.repos, 'error');
  }
  return distributeReviewNodes(ctx.repos, parsed.data.nodes);
}

/**
 * The reviews deriver: one fleet-wide `search(review-requested:@me)` run ONCE
 * over the whole fleet (issue #15). The count is exact via `issueCount`; the
 * per-repo inbox lists accumulate up to {@link MAX_REVIEW_PAGES} pages.
 */
export const reviewsDeriver: SignalDeriver = {
  signal: 'reviews',
  kind: 'top-level-global',
  globalSearchAlias: REVIEWS_ALIAS,
  globalMaxPages: MAX_REVIEW_PAGES,
  topLevelVariables: reviewsTopLevelVariables,
  topLevelFragment: reviewsTopLevelFragment,
  derive(ctx: FleetChunkContext): Map<string, SignalSlice> {
    return deriveReviewsSlices(ctx);
  },
};

// ── Signal deriver registry ──────────────────────────────────────────────────

/**
 * The registered signal derivers. Add one entry per signal to extend the
 * batch — nothing in {@link buildFleetQuery} or {@link executeFleetBatch}
 * needs editing when a new deriver is appended here.
 */
export const SIGNAL_DERIVERS: readonly SignalDeriver[] = [
  ciDeriver,
  issuesDeriver,
  prDeriver,
  staleDeriver,
  reviewsDeriver,
];

// ── Query builder ─────────────────────────────────────────────────────────────

/**
 * Builds the variables object paired with {@link buildFleetQuery}: one
 * `owner{i}`/`name{i}` entry per repo, plus a `viewer` entry when
 * `viewerLogin` is non-null/non-empty (consumed by `$viewer: String` when any
 * deriver emits a viewer-scoped fragment). Passing all values as variables
 * (never as string literals) makes the query injection-safe.
 */
export function buildFleetVariables(
  repos: readonly Repo[],
  viewerLogin?: string | null,
): Record<string, string> {
  const vars: Record<string, string> = {};
  repos.forEach((repo, i) => {
    vars[`owner${i}`] = repo.owner;
    vars[`name${i}`] = repo.name;
  });
  if (viewerLogin) {
    vars['viewer'] = viewerLogin;
  }
  // Top-level derivers (e.g. stale's per-repo search) bind their own variables.
  for (const deriver of SIGNAL_DERIVERS) {
    if (deriver.kind !== 'top-level' || !deriver.topLevelVariables) continue;
    for (const { name, value } of deriver.topLevelVariables(repos, viewerLogin ?? null)) {
      vars[name] = value;
    }
  }
  return vars;
}

/** The per-repo derivers' fragments, composed once per repo alias. */
function perRepoSelection(viewerLogin: string | null): string {
  const fragments: string[] = ['nameWithOwner'];
  for (const deriver of SIGNAL_DERIVERS) {
    if (deriver.kind === 'per-repo' && deriver.repoFragment) {
      fragments.push(deriver.repoFragment(viewerLogin));
    }
  }
  return fragments.join('\n');
}

/**
 * Builds the batched fleet GraphQL query for `repos`.
 *
 * Each repo becomes a TOP-LEVEL singular `r{i}: repository(owner: $owner{i},
 * name: $name{i}) { … }` alias — never nested under a connection — so the
 * GraphQL point cost carries no ancestor multiplier. Every registered per-repo
 * deriver's fragment is composed inside each alias; every top-level deriver's
 * aliased field is appended, followed by `viewer { login }` and
 * `rateLimit { cost remaining resetAt limit }`.
 *
 * When `viewerLogin` is non-null/non-empty, `$viewer: String` is added to the
 * variable declarations so per-repo derivers can reference it (e.g. the issues
 * deriver's `myIssues` alias). Pair with {@link buildFleetVariables} which
 * supplies the matching `viewer` binding.
 *
 * @param repos - Repos for this chunk (already chunked by the caller).
 * @param viewerLogin - Viewer login forwarded to per-repo and top-level derivers.
 */
export function buildFleetQuery(repos: readonly Repo[], viewerLogin: string | null): string {
  const selection = perRepoSelection(viewerLogin);

  const varDecls: string[] = [];
  const repoAliases: string[] = [];
  repos.forEach((_, i) => {
    varDecls.push(`$owner${i}: String!`, `$name${i}: String!`);
    repoAliases.push(`r${i}: repository(owner: $owner${i}, name: $name${i}) {\n${selection}\n}`);
  });

  if (viewerLogin) {
    varDecls.push('$viewer: String');
  }

  const topLevelFragments: string[] = [];
  for (const deriver of SIGNAL_DERIVERS) {
    if (deriver.kind !== 'top-level') continue;
    if (deriver.topLevelFragment) {
      topLevelFragments.push(deriver.topLevelFragment(repos, viewerLogin));
    }
    if (deriver.topLevelVariables) {
      for (const { name, type } of deriver.topLevelVariables(repos, viewerLogin)) {
        varDecls.push(`$${name}: ${type}`);
      }
    }
  }

  const header =
    varDecls.length > 0 ? `query FleetQuery(${varDecls.join(', ')})` : 'query FleetQuery';
  const body = [
    ...repoAliases,
    ...topLevelFragments,
    'viewer { login }',
    'rateLimit { cost remaining resetAt limit }',
  ].join('\n');

  return `${header} {\n${body}\n}`;
}

// ── Executor ─────────────────────────────────────────────────────────────────

/**
 * Number of repos per batched GraphQL query. Bounds a single query's selection
 * size (and worst-case point cost) so a large fleet is split across several
 * limiter-throttled requests rather than one oversized document.
 */
export const FLEET_QUERY_CHUNK_SIZE = 12;

/** One slice map per signal: `signal → (nameWithOwner → slice)`. */
export type FleetBatchResult = Map<TileSignalType, Map<string, SignalSlice>>;

/** Splits `items` into consecutive chunks of at most `size`. */
function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/** Builds the per-chunk context derivers read from. */
function buildChunkContext(
  repos: readonly Repo[],
  viewerLogin: string | null,
  data: FleetQueryData,
  errors: FleetErrorIndex,
): FleetChunkContext {
  const aliasByRepo = new Map<Repo, string>();
  repos.forEach((repo, i) => aliasByRepo.set(repo, `r${i}`));
  return {
    repos,
    viewerLogin,
    data,
    errors,
    aliasFor: (repo: Repo): string => aliasByRepo.get(repo) ?? '',
    nodeFor: (repo: Repo): FleetRepoNode | null => {
      const alias = aliasByRepo.get(repo);
      if (!alias) return null;
      const raw = data[alias];
      return (raw as FleetRepoNode | null | undefined) ?? null;
    },
  };
}

/** Sets every repo's slice for `signal` to `slice` in `result`. */
function markChunk(
  result: FleetBatchResult,
  signal: TileSignalType,
  repos: readonly Repo[],
  slice: SignalSlice,
): void {
  const map = result.get(signal);
  if (!map) return;
  for (const repo of repos) map.set(repo.nameWithOwner, { ...slice });
}

/**
 * Shallow-clones a {@link FleetBatchResult} so React sees a fresh reference on
 * each {@link onProgress} emission without a deep copy of every slice.
 */
function cloneResult(r: FleetBatchResult): FleetBatchResult {
  return new Map([...r].map(([sig, m]) => [sig, new Map(m)]));
}

// ── Global (top-level-global) run ────────────────────────────────────────────

/**
 * Lenient schema for reading one page of a global search connection during
 * pagination. Tolerant (`.passthrough()`, `nodes: unknown`) so it only extracts
 * the cursor + raw nodes; the owning deriver re-parses the merged payload
 * strictly so a malformed shape still yields `error` rather than a false
 * ready-zero.
 */
const GlobalSearchPageSchema = z
  .object({
    pageInfo: z
      .object({ hasNextPage: z.boolean(), endCursor: z.string().nullable().optional() })
      .passthrough()
      .optional(),
    nodes: z.array(z.unknown()).optional().default([]),
  })
  .passthrough();

/** Builds the Zod schema for the global query's `data` (aliases pass through). */
function buildGlobalDataSchema(): ZodType<FleetQueryData> {
  return z
    .object({
      viewer: ViewerSchema.nullable(),
      rateLimit: GraphQLRateLimitPartSchema.optional(),
    })
    .passthrough() as unknown as ZodType<FleetQueryData>;
}

/**
 * Builds the single dedicated query for every `top-level-global` deriver. The
 * header declares the shared `$after: String` pagination cursor plus each
 * deriver's own bound variables; the body is the derivers' aliased search
 * fragments followed by `viewer`/`rateLimit`.
 */
function buildGlobalQuery(
  globalDerivers: readonly SignalDeriver[],
  repos: readonly Repo[],
  viewerLogin: string | null,
): string {
  const varDecls: string[] = ['$after: String'];
  const fragments: string[] = [];
  for (const deriver of globalDerivers) {
    if (deriver.topLevelFragment) fragments.push(deriver.topLevelFragment(repos, viewerLogin));
    if (deriver.topLevelVariables) {
      for (const { name, type } of deriver.topLevelVariables(repos, viewerLogin)) {
        varDecls.push(`$${name}: ${type}`);
      }
    }
  }
  const header = `query FleetGlobalQuery(${varDecls.join(', ')})`;
  const body = [
    ...fragments,
    'viewer { login }',
    'rateLimit { cost remaining resetAt limit }',
  ].join('\n');
  return `${header} {\n${body}\n}`;
}

/** Builds the bound variables for {@link buildGlobalQuery} (excluding `$after`). */
function buildGlobalVariables(
  globalDerivers: readonly SignalDeriver[],
  repos: readonly Repo[],
  viewerLogin: string | null,
): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const deriver of globalDerivers) {
    if (!deriver.topLevelVariables) continue;
    for (const { name, value } of deriver.topLevelVariables(repos, viewerLogin)) {
      vars[name] = value;
    }
  }
  return vars;
}

/** Builds the context global derivers read from (alias data + error index). */
function buildGlobalContext(
  repos: readonly Repo[],
  viewerLogin: string | null,
  data: FleetQueryData,
  errors: FleetErrorIndex,
): FleetChunkContext {
  return {
    repos,
    viewerLogin,
    data,
    errors,
    aliasFor: (): string => '',
    nodeFor: (): FleetRepoNode | null => null,
  };
}

/** Per-alias accumulation across pages of a global search. */
interface GlobalAliasAccumulator {
  /** The first page's raw payload, reused as the base for merged data. */
  base: Record<string, unknown>;
  /** All nodes accumulated across pages (raw, re-parsed by the deriver). */
  nodes: unknown[];
  /** Whether the first page parsed leniently (false ⇒ leave raw for the deriver). */
  ok: boolean;
}

/**
 * Runs every `top-level-global` deriver EXACTLY ONCE over the full fleet via a
 * dedicated query, paginating up to each deriver's {@link SignalDeriver.globalMaxPages}
 * cap through the shared `$after` cursor and merging the result into the
 * per-signal maps.
 *
 * Resilience mirrors the per-chunk path: a data-less response or a hard (non-
 * abort) throw marks every repo's global signals `{ status: 'error' }`; aborts
 * re-throw. A malformed-but-present payload is left raw so the owning deriver's
 * strict parse decides `error` vs. ready (never a false ready-zero).
 */
async function runGlobalDerivers(
  globalDerivers: readonly SignalDeriver[],
  repos: readonly Repo[],
  viewerLogin: string | null,
  token: string,
  result: FleetBatchResult,
  signal?: AbortSignal,
): Promise<void> {
  if (globalDerivers.length === 0 || repos.length === 0) return;

  const query = buildGlobalQuery(globalDerivers, repos, viewerLogin);
  const baseVars = buildGlobalVariables(globalDerivers, repos, viewerLogin);
  const dataSchema = buildGlobalDataSchema();
  const maxPages = Math.max(1, ...globalDerivers.map((d) => d.globalMaxPages ?? 1));
  const aliases = globalDerivers
    .map((d) => d.globalSearchAlias)
    .filter((a): a is string => typeof a === 'string');

  const accumulated = new Map<string, GlobalAliasAccumulator>();
  let latestData: FleetQueryData | null = null;
  let latestErrors: GraphQLError[] = [];
  let cursor: string | null = null;

  try {
    for (let pageNumber = 0; pageNumber < maxPages; pageNumber += 1) {
      const variables: Record<string, unknown> = { ...baseVars, after: cursor };
      const { data, errors } = await scheduleGraphQLRequest(
        () =>
          fetchGraphQL<FleetQueryData>({
            query,
            variables,
            dataSchema,
            token,
            signal,
            context: 'executeFleetBatch:global',
          }),
        signal,
      );

      if (!data) {
        // A data-less response is a hard global failure — error every repo.
        for (const deriver of globalDerivers) {
          markChunk(result, deriver.signal, repos, { status: 'error' });
        }
        return;
      }

      if (data.rateLimit) recordGraphQLCost(data.rateLimit);
      latestData = data;
      latestErrors = errors;

      let hasNext = false;
      let nextCursor: string | null = null;
      for (const alias of aliases) {
        const raw: unknown = data[alias];
        if (raw === null || raw === undefined) continue;
        const page = GlobalSearchPageSchema.safeParse(raw);
        if (!page.success) {
          // Malformed page: record it as not-ok so the merge leaves the raw
          // payload in place for the deriver's strict parse to reject.
          if (!accumulated.has(alias)) accumulated.set(alias, { base: {}, nodes: [], ok: false });
          continue;
        }
        const entry = accumulated.get(alias);
        if (!entry) {
          accumulated.set(alias, {
            base: raw as Record<string, unknown>,
            nodes: [...page.data.nodes],
            ok: true,
          });
        } else if (entry.ok) {
          entry.nodes.push(...page.data.nodes);
        }
        const pageInfo = page.data.pageInfo;
        if (pageInfo?.hasNextPage && pageInfo.endCursor) {
          hasNext = true;
          nextCursor = pageInfo.endCursor;
        }
      }

      if (!hasNext || nextCursor === null) break;
      cursor = nextCursor;
    }
  } catch (err) {
    // A caller-abort propagates; any other hard failure errors every repo.
    if (isAbortError(err) || signal?.aborted) throw err;
    for (const deriver of globalDerivers) {
      markChunk(result, deriver.signal, repos, { status: 'error' });
    }
    return;
  }

  if (!latestData) return;

  // Merge accumulated nodes back under each alias (only when its first page
  // parsed); a malformed alias keeps its raw payload so the deriver rejects it.
  const finalData = { ...latestData } as Record<string, unknown>;
  for (const [alias, entry] of accumulated) {
    if (entry.ok) {
      finalData[alias] = { ...entry.base, nodes: entry.nodes };
    }
  }

  const errorIndex = buildErrorIndex(latestErrors);
  const ctx = buildGlobalContext(repos, viewerLogin, finalData as FleetQueryData, errorIndex);
  for (const deriver of globalDerivers) {
    const slices = deriver.derive(ctx);
    const target = result.get(deriver.signal);
    if (!target) continue;
    for (const [key, slice] of slices) target.set(key, slice);
  }
}

/**
 * Executes a registry-driven batched fleet query and returns one slice per
 * (signal, repo).
 *
 * Repos are chunked into groups of {@link FLEET_QUERY_CHUNK_SIZE}; each chunk
 * builds its query, runs through {@link scheduleGraphQLRequest} (sharing the
 * GraphQL limiter), records its `rateLimit` cost via {@link recordGraphQLCost},
 * builds a path-scoped error index, and runs every registered per-repo and
 * top-level deriver. Chunk results are merged into one map per signal. Any
 * `top-level-global` derivers (e.g. reviews) then run EXACTLY ONCE over the full
 * fleet in a dedicated paginated query via {@link runGlobalDerivers}.
 *
 * Resilience:
 *  - A chunk whose response carries no `data` (or whose request hard-throws a
 *    non-abort error) marks that chunk's repos as `{ status: 'error' }` for every
 *    signal and the other chunks still resolve.
 *  - Partial errors within a chunk's `data` are handled per deriver via the
 *    error index, so one null field/repo never errors a sibling signal or repo.
 *  - Aborts are honoured: an {@link AbortSignal} is threaded to every request and
 *    re-thrown so a cancelled batch settles immediately.
 *
 * @param repos - The fleet to query.
 * @param viewerLogin - Viewer login forwarded to top-level derivers (`null` ok).
 * @param token - GitHub token for the GraphQL request.
 * @param signal - Optional abort signal threaded to every request.
 */
export async function executeFleetBatch(
  repos: readonly Repo[],
  viewerLogin: string | null,
  token: string,
  signal?: AbortSignal,
  onProgress?: (partial: FleetBatchResult) => void,
): Promise<FleetBatchResult> {
  const result: FleetBatchResult = new Map();
  for (const deriver of SIGNAL_DERIVERS) {
    if (!result.has(deriver.signal)) result.set(deriver.signal, new Map());
  }
  if (repos.length === 0) return result;

  const chunks = chunk(repos, FLEET_QUERY_CHUNK_SIZE);

  await Promise.all(
    chunks.map(async (chunkRepos) => {
      try {
        const query = buildFleetQuery(chunkRepos, viewerLogin);
        const variables = buildFleetVariables(chunkRepos, viewerLogin);
        const dataSchema = buildChunkDataSchema(chunkRepos.length);

        const { data, errors } = await scheduleGraphQLRequest(
          () =>
            fetchGraphQL<FleetQueryData>({
              query,
              variables,
              dataSchema,
              token,
              signal,
              context: 'executeFleetBatch',
            }),
          signal,
        );

        if (!data) {
          // A data-less response is a hard chunk failure — error this chunk only.
          // Global derivers run separately and own their own error handling.
          for (const deriver of SIGNAL_DERIVERS) {
            if (deriver.kind === 'top-level-global') continue;
            markChunk(result, deriver.signal, chunkRepos, { status: 'error' });
          }
          if (!signal?.aborted) onProgress?.(cloneResult(result));
          return;
        }

        if (data.rateLimit) recordGraphQLCost(data.rateLimit);

        const errorIndex = buildErrorIndex(errors);
        const ctx = buildChunkContext(chunkRepos, viewerLogin, data, errorIndex);
        for (const deriver of SIGNAL_DERIVERS) {
          if (deriver.kind === 'top-level-global') continue;
          const slices = deriver.derive(ctx);
          const target = result.get(deriver.signal);
          if (!target) continue;
          for (const [key, slice] of slices) target.set(key, slice);
        }
        if (!signal?.aborted) onProgress?.(cloneResult(result));
      } catch (err) {
        // A caller-abort propagates; any other hard failure isolates to this chunk.
        if (isAbortError(err) || signal?.aborted) throw err;
        for (const deriver of SIGNAL_DERIVERS) {
          if (deriver.kind === 'top-level-global') continue;
          markChunk(result, deriver.signal, chunkRepos, { status: 'error' });
        }
        onProgress?.(cloneResult(result));
      }
    }),
  );

  // Global (top-level-global) derivers run EXACTLY ONCE over the full fleet,
  // after the per-chunk queries, in a dedicated paginated query.
  const globalDerivers = SIGNAL_DERIVERS.filter((d) => d.kind === 'top-level-global');
  await runGlobalDerivers(globalDerivers, repos, viewerLogin, token, result, signal);

  if (!signal?.aborted) onProgress?.(cloneResult(result));

  return result;
}
