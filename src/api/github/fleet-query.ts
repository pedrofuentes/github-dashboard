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
import type { TileSignalType } from '../../types/dashboard';
import type { CiSignalSlice, IssuesSignalSlice, Repo, SignalSlice } from '../../types/fleet';
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
 *
 * `derive` always returns a `Map<nameWithOwner, SignalSlice>`. The concrete
 * slice subtype is known from {@link signal} (e.g. `'ci'` ⇒ {@link CiSignalSlice});
 * callers narrow when reading.
 */
export interface SignalDeriver {
  /** The signal this deriver populates. */
  readonly signal: TileSignalType;
  /** Whether the deriver contributes inside each repo or at the top level. */
  readonly kind: 'per-repo' | 'top-level';
  /** Selection-set fragment composed inside each `repository(...)` alias. */
  repoFragment?(viewerLogin: string | null): string;
  /** Aliased top-level selection (e.g. a `search(...)` field). */
  topLevelFragment?(repos: readonly Repo[], viewerLogin: string | null): string;
  /** Folds the chunk into one slice per `nameWithOwner`. */
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
 * Error guard: if the whole repo alias or its `openIssues` subtree errored →
 * `{ status: 'error' }`. Absent node (no error) → zero ready slice. Otherwise
 * derives from `openIssues.totalCount`; if `myIssues` is present, includes the
 * viewer's mine/community split.
 */
function deriveIssuesSlice(
  node: FleetRepoNode | null,
  alias: string,
  errors: FleetErrorIndex,
): IssuesSignalSlice {
  if (errors.has(alias) || errors.coversField(`${alias}.openIssues`)) {
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

// ── Signal deriver registry ──────────────────────────────────────────────────

/**
 * The registered signal derivers. Add one entry per signal to extend the
 * batch — nothing in {@link buildFleetQuery} or {@link executeFleetBatch}
 * needs editing when a new deriver is appended here.
 */
export const SIGNAL_DERIVERS: readonly SignalDeriver[] = [ciDeriver, issuesDeriver];

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
    if (deriver.kind === 'top-level' && deriver.topLevelFragment) {
      topLevelFragments.push(deriver.topLevelFragment(repos, viewerLogin));
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
 * Executes a registry-driven batched fleet query and returns one slice per
 * (signal, repo).
 *
 * Repos are chunked into groups of {@link FLEET_QUERY_CHUNK_SIZE}; each chunk
 * builds its query, runs through {@link scheduleGraphQLRequest} (sharing the
 * GraphQL limiter), records its `rateLimit` cost via {@link recordGraphQLCost},
 * builds a path-scoped error index, and runs every registered deriver. Chunk
 * results are merged into one map per signal.
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
          for (const deriver of SIGNAL_DERIVERS) {
            markChunk(result, deriver.signal, chunkRepos, { status: 'error' });
          }
          return;
        }

        if (data.rateLimit) recordGraphQLCost(data.rateLimit);

        const errorIndex = buildErrorIndex(errors);
        const ctx = buildChunkContext(chunkRepos, viewerLogin, data, errorIndex);
        for (const deriver of SIGNAL_DERIVERS) {
          const slices = deriver.derive(ctx);
          const target = result.get(deriver.signal);
          if (!target) continue;
          for (const [key, slice] of slices) target.set(key, slice);
        }
      } catch (err) {
        // A caller-abort propagates; any other hard failure isolates to this chunk.
        if (isAbortError(err) || signal?.aborted) throw err;
        for (const deriver of SIGNAL_DERIVERS) {
          markChunk(result, deriver.signal, chunkRepos, { status: 'error' });
        }
      }
    }),
  );

  return result;
}
