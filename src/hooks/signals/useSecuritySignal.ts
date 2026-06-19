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
 */
import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';

import {
  GITHUB_API_BASE,
  GitHubApiError,
  GitHubErrorCode,
  fetchDependabotAlerts,
  fetchWithETag,
} from '../../api/github';
import { SIGNAL_FETCH_CONCURRENCY, mapWithConcurrency } from '../../api/concurrency';
import { isAbortError } from '../../lib/abort';
import type { Repo, SecuritySignalSlice } from '../../types/fleet';
import { computeGrade, computeSecurityScore, type SecurityCounts } from './securityGrade';

type Severity = keyof SecurityCounts;

/** Local Zod schema for the code-scanning alerts list (research-api §(c),(4)). */
const CodeScanningAlertSchema = z
  .object({
    rule: z
      .object({
        severity: z.string().nullable().optional(),
        security_severity_level: z.string().nullable().optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
  })
  .passthrough();
const CodeScanningAlertsSchema = z.array(CodeScanningAlertSchema);
type CodeScanningAlert = z.infer<typeof CodeScanningAlertSchema>;

/** Sentinel: a feed exists but is not accessible to this token/repo. */
const NO_ACCESS = Symbol('security:no-access');
type FeedResult = SecurityCounts | typeof NO_ACCESS;

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

async function loadDependabot(
  repo: Repo,
  token: string,
  signal?: AbortSignal,
): Promise<FeedResult> {
  try {
    const summary = await fetchDependabotAlerts(repo.owner, repo.name, token, signal);
    return {
      critical: summary.critical,
      high: summary.high,
      medium: summary.medium,
      low: summary.low,
    };
  } catch (error) {
    if (isNoAccessError(error)) return NO_ACCESS;
    throw error;
  }
}

/** Buckets a code-scanning alert by CVSS level, falling back to rule severity. */
function codeScanningSeverity(alert: CodeScanningAlert): Severity | null {
  const level = alert.rule?.security_severity_level?.toLowerCase();
  if (level === 'critical' || level === 'high' || level === 'medium' || level === 'low') {
    return level;
  }
  switch (alert.rule?.severity?.toLowerCase()) {
    case 'error':
      return 'high';
    case 'warning':
      return 'medium';
    case 'note':
      return 'low';
    default:
      return null;
  }
}

async function loadCodeScanning(
  repo: Repo,
  token: string,
  signal?: AbortSignal,
): Promise<FeedResult> {
  const url =
    `${GITHUB_API_BASE}/repos/${encodeURIComponent(repo.owner)}/` +
    `${encodeURIComponent(repo.name)}/code-scanning/alerts?state=open&per_page=100`;
  try {
    const alerts = await fetchWithETag(url, CodeScanningAlertsSchema, {
      token,
      context: 'fetchCodeScanningAlerts',
      signal,
    });
    const counts = emptyCounts();
    for (const alert of alerts) {
      const severity = codeScanningSeverity(alert);
      if (severity) counts[severity] += 1;
    }
    return counts;
  } catch (error) {
    if (isNoAccessError(error)) return NO_ACCESS;
    throw error;
  }
}

async function loadSecuritySlice(
  repo: Repo,
  token: string,
  signal?: AbortSignal,
): Promise<SecuritySignalSlice> {
  const feeds = await Promise.all([
    loadDependabot(repo, token, signal),
    loadCodeScanning(repo, token, signal),
  ]);

  if (feeds.every((feed) => feed === NO_ACCESS)) {
    // Neither feed is available — surface "no data", not an error.
    return { status: 'ready' };
  }

  const counts = emptyCounts();
  for (const feed of feeds) {
    if (feed === NO_ACCESS) continue;
    counts.critical += feed.critical;
    counts.high += feed.high;
    counts.medium += feed.medium;
    counts.low += feed.low;
  }

  return {
    status: 'ready',
    score: computeSecurityScore(counts),
    grade: computeGrade(counts),
    counts,
  };
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
  const [slices, setSlices] = useState<Map<string, SecuritySignalSlice>>(() => new Map());
  const generationRef = useRef(0);

  useEffect(() => {
    const generation = (generationRef.current += 1);

    if (!token || repos.length === 0) {
      // Bail out without churning identity (a fresh Map would re-render and, if
      // the caller passes a new array each render, loop) — keep the same ref.
      setSlices((prev) => (prev.size === 0 ? prev : new Map()));
      return;
    }

    // One controller per run: cleanup (or a repos/token change) aborts every
    // in-flight request so superseded work stops instead of racing to set state.
    const controller = new AbortController();

    setSlices(
      new Map(
        repos.map((repo): [string, SecuritySignalSlice] => [
          repo.nameWithOwner,
          { status: 'loading' },
        ]),
      ),
    );

    void mapWithConcurrency(
      repos,
      SIGNAL_FETCH_CONCURRENCY,
      async (repo, signal) => {
        try {
          const slice = await loadSecuritySlice(repo, token, signal);
          if (generation !== generationRef.current) return;
          setSlices((prev) => new Map(prev).set(repo.nameWithOwner, slice));
        } catch (err) {
          // A cancelled request is not a failure: stay quiet (no log, no error).
          if (signal?.aborted || isAbortError(err)) return;
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
  }, [repos, token]);

  return slices;
}
