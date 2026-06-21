/**
 * Security signal — open Dependabot **and** code-scanning alerts per repo,
 * aggregated into a severity breakdown, weighted score and letter grade
 * (issue #14; research-api §(c),(4)).
 *
 * Replaces the stub: it owns this file only. For each repo it fetches the two
 * alert feeds concurrently, merges their open counts, and emits one
 * {@link SecuritySignalSlice}. Missing access to a feed (403 token scope, or
 * 404 feature disabled) is treated as "no data from that feed" rather than an
 * error; when neither feed is accessible the slice is `ready` with no counts
 * (the cell renders "n/a"). A generation ref discards results from a superseded
 * token, and null token / empty fleet yield an empty map.
 *
 * Two concurrency-sensitive invariants are upheld here:
 *  - Each repo issues two feed requests, and BOTH are scheduled as independent
 *    tasks through {@link mapWithConcurrency}. The real in-flight ceiling is the
 *    documented {@link SIGNAL_FETCH_CONCURRENCY} cap, not twice it as it would
 *    be if each repo fired both feeds via `Promise.all` (issue #71).
 *  - The effect re-runs only when the repo *key set* changes, not on every new
 *    array identity, so a caller passing a non-memoized `repos` prop cannot spin
 *    the populated render path into an infinite loop (issue #65).
 */
import { useEffect, useRef, useState } from 'react';

import {
  GitHubApiError,
  GitHubErrorCode,
  type SecurityAlertFeed,
  fetchCodeScanningAlerts,
  fetchDependabotAlerts,
} from '../../api/github';
import { SIGNAL_FETCH_CONCURRENCY, mapWithConcurrency } from '../../api/concurrency';
import { isAbortError } from '../../lib/abort';
import type { Repo, SecurityAlertRow, SecuritySignalSlice } from '../../types/fleet';
import { computeGrade, computeSecurityScore, type SecurityCounts } from './securityGrade';

/** Shared stable identity for every empty result (no token / no repos). */
const EMPTY: Map<string, SecuritySignalSlice> = new Map();

/** Sentinel: a feed exists but is not accessible to this token/repo. */
const NO_ACCESS = Symbol('security:no-access');
/** Severity counts from one accessible feed, plus whether it was truncated. */
interface FeedData {
  counts: SecurityCounts;
  /** `true` when this feed hit the pagination cap (partial count; issue #77). */
  truncated: boolean;
  /** Per-alert identity rows retained for the inbox derivation (issue #216). */
  rows: SecurityAlertRow[];
}
type FeedResult = FeedData | typeof NO_ACCESS;

/** One alert feed for a repo: severity counts, or NO_ACCESS when unavailable. */
type FeedLoader = (repo: Repo, token: string, signal?: AbortSignal) => Promise<FeedResult>;

/** Raw feed fetcher shared by both feeds: severity counts + per-alert rows. */
type FeedFetcher = (
  owner: string,
  repo: string,
  token: string,
  signal?: AbortSignal,
) => Promise<SecurityAlertFeed>;

function emptyCounts(): SecurityCounts {
  return { critical: 0, high: 0, medium: 0, low: 0 };
}

/**
 * A 403 (missing alert scope) or 404 (feature disabled / repo not visible)
 * means "no data" — never a hard error. A rate-limited 403 is a real error.
 */
function isNoAccessError(error: unknown): boolean {
  return (
    error instanceof GitHubApiError &&
    (error.status === 403 || error.status === 404) &&
    error.code !== GitHubErrorCode.RATE_LIMITED
  );
}

/** Wraps a feed fetcher into a feed loader that maps "no access" to NO_ACCESS. */
function feedLoader(fetcher: FeedFetcher): FeedLoader {
  return async (repo, token, signal) => {
    try {
      const feed = await fetcher(repo.owner, repo.name, token, signal);
      return {
        counts: {
          critical: feed.critical,
          high: feed.high,
          medium: feed.medium,
          low: feed.low,
        },
        truncated: feed.truncated,
        rows: feed.rows,
      };
    } catch (error) {
      if (isNoAccessError(error)) return NO_ACCESS;
      throw error;
    }
  };
}

const loadDependabot = feedLoader(fetchDependabotAlerts);
const loadCodeScanning = feedLoader(fetchCodeScanningAlerts);

/** Merges a repo's two feed results into its final slice. */
function combineFeeds(feeds: FeedResult[]): SecuritySignalSlice {
  if (feeds.every((feed) => feed === NO_ACCESS)) {
    // Neither feed is available — surface "no data", not an error.
    return { status: 'ready' };
  }

  const counts = emptyCounts();
  let truncated = false;
  const alerts: SecurityAlertRow[] = [];
  for (const feed of feeds) {
    if (feed === NO_ACCESS) continue;
    counts.critical += feed.counts.critical;
    counts.high += feed.counts.high;
    counts.medium += feed.counts.medium;
    counts.low += feed.counts.low;
    // Any partial feed makes the merged count a lower bound (issue #77).
    if (feed.truncated) truncated = true;
    // Collect every feed's per-alert rows for the later inbox derivation; merge
    // order is irrelevant (deriveInboxItems sorts by timestamp+id; issue #216).
    for (const row of feed.rows) alerts.push(row);
  }

  const slice: SecuritySignalSlice = {
    status: 'ready',
    score: computeSecurityScore(counts),
    grade: computeGrade(counts),
    counts,
  };
  // Only set the flag when partial, so a fully-counted slice stays clean.
  if (truncated) slice.truncated = true;
  // Omit `alerts` entirely when empty, mirroring the `truncated` omission, so a
  // no-alert slice stays byte-identical to its pre-INBOX shape (issue #216).
  if (alerts.length > 0) slice.alerts = alerts;
  return slice;
}

/** One scheduled unit of work: a single feed request for a single repo. */
interface FeedTask {
  repo: Repo;
  load: FeedLoader;
}

/** Per-repo accumulator that collects both feeds before emitting one slice. */
interface RepoAccumulator {
  feeds: FeedResult[];
  settled: boolean;
}

/**
 * Per-repo open security-alert signal keyed by `repo.nameWithOwner`.
 *
 * @param repos - Repositories to resolve the signal for.
 * @param token - GitHub token; `null` yields an empty map and no requests.
 */
export function useSecuritySignal(
  repos: Repo[],
  token: string | null,
): Map<string, SecuritySignalSlice> {
  const [slices, setSlices] = useState<Map<string, SecuritySignalSlice>>(EMPTY);
  const generationRef = useRef(0);
  // Mirror the latest repos into a ref so the effect can read them without
  // depending on the array's identity (a caller passing a fresh array with the
  // same repos each render must not trigger a refetch loop).
  const reposRef = useRef(repos);
  reposRef.current = repos;

  // Re-run only when the *set* of repos changes, not on every new array.
  const repoSignature = repos.map((repo) => repo.nameWithOwner).join('\n');

  useEffect(() => {
    const generation = (generationRef.current += 1);
    const currentRepos = reposRef.current;

    if (!token || currentRepos.length === 0) {
      setSlices(EMPTY);
      return;
    }

    // One controller per run: cleanup (or a repos/token change) aborts every
    // in-flight request so superseded work stops instead of racing to set state.
    const controller = new AbortController();

    setSlices(
      new Map(
        currentRepos.map((repo): [string, SecuritySignalSlice] => [
          repo.nameWithOwner,
          { status: 'loading' },
        ]),
      ),
    );

    // One accumulator per repo: each of its two feed tasks reports here, and the
    // repo's slice is emitted once both feeds settle (or the first hard error).
    const accumulators = new Map<string, RepoAccumulator>(
      currentRepos.map((repo) => [repo.nameWithOwner, { feeds: [], settled: false }]),
    );

    // Flatten to per-(repo,feed) tasks so EVERY request counts against the
    // limiter — the true in-flight ceiling is SIGNAL_FETCH_CONCURRENCY, not 2×
    // it as a per-repo `Promise.all([dependabot, codeScanning])` would allow.
    const tasks: FeedTask[] = currentRepos.flatMap((repo) => [
      { repo, load: loadDependabot },
      { repo, load: loadCodeScanning },
    ]);

    void mapWithConcurrency(
      tasks,
      SIGNAL_FETCH_CONCURRENCY,
      async ({ repo, load }, signal) => {
        const acc = accumulators.get(repo.nameWithOwner);
        if (!acc) return;
        try {
          const feed = await load(repo, token, signal);
          // Discard a superseded generation, or a sibling that already settled
          // this repo (the other feed hit a hard error first).
          if (generation !== generationRef.current || acc.settled) return;
          acc.feeds.push(feed);
          if (acc.feeds.length === 2) {
            acc.settled = true;
            setSlices((prev) => new Map(prev).set(repo.nameWithOwner, combineFeeds(acc.feeds)));
          }
        } catch (err) {
          // A cancelled request is not a failure: stay quiet (no log, no error).
          if (signal?.aborted || isAbortError(err)) return;
          // The first hard error settles the repo; its sibling feed is ignored.
          if (acc.settled) return;
          acc.settled = true;
          console.error(
            `useSecuritySignal: failed to fetch security alerts for ${repo.nameWithOwner}`,
            err,
          );
          if (generation !== generationRef.current) return;
          setSlices((prev) => new Map(prev).set(repo.nameWithOwner, { status: 'error' }));
        }
      },
      controller.signal,
    );

    return () => controller.abort();
  }, [repoSignature, token]);

  return slices;
}
