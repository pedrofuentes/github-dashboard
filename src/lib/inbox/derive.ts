/**
 * `deriveInboxItems` — the §1 pure transform (DESIGN-INBOX).
 *
 * Turns the already-fetched per-repo fleet signal data into the flat,
 * newest-first list of actionable {@link InboxItem}s the Notifications Inbox
 * renders. It is a **pure function of `(repos, getRowData)`**: it issues no
 * request, reads no clock (`Date.now()` is never called — timestamps are fixed
 * per-event instants, §2.3), and given identical input returns byte-identical
 * output (same order, same ids).
 *
 * Each repo contributes up to five kinds, one item per discrete event:
 * - `ci` — a failing latest run (§1.1), keyed by its run id, ordered by `updatedAt`.
 * - `review` — each PR awaiting the viewer's review (§1.2), ordered by `created_at`.
 * - `new-pr` — each new outside-contributor PR (§1.3), ordered by `created_at`.
 * - `security` — each open Dependabot / code-scanning alert (§1.4), ordered by `created_at`.
 * - `stale` — each stale open PR/issue (§1.5), ordered by `updated_at`.
 *
 * Aggregate context (issue/PR open counts, the activity sparkline) is **not**
 * an event and never becomes an item (§1). A slice in `loading`/`error`/
 * `unknown` contributes nothing (§2.3). Every `url` is gated through
 * {@link safeGitHubHref}; an item whose link is not a github.com origin is
 * dropped, never emitted as a live link (§6.2, AC-8).
 */
import { safeGitHubHref } from '../github-url';
import type { AccentTone } from '../../components/tiles/types';
import type { InboxItem } from '../../types/inbox';
import type {
  GetRowData,
  Repo,
  RepoSignalData,
  SecurityAlertRow,
  SecurityAlertSeverity,
} from '../../types/fleet';
import { buildCiId, buildNewPrId, buildReviewId, buildSecurityId, buildStaleId } from './ids';

/** Accent for a security alert, driven by its severity (§5). */
const SECURITY_SEVERITY_ACCENT: Record<SecurityAlertSeverity, AccentTone> = {
  critical: 'failure',
  high: 'warning',
  medium: 'info',
  low: 'neutral',
};

/** Human-readable feed label for a security alert's `type` (§1.4). */
const SECURITY_TYPE_LABEL: Record<SecurityAlertRow['type'], string> = {
  dependabot: 'Dependabot',
  'code-scanning': 'Code scanning',
};

function securityTitle(alert: SecurityAlertRow): string {
  const severity = alert.severity.charAt(0).toUpperCase() + alert.severity.slice(1);
  return `${severity} ${SECURITY_TYPE_LABEL[alert.type]} alert #${alert.number}`;
}

/**
 * Pushes an item only when its url passes the GitHub-origin guard; an unsafe or
 * missing link drops the item entirely so it is never emitted as a live link
 * (§6.2, AC-8). `url` is the guard-validated href, so every emitted item carries
 * a safe github.com origin.
 */
function pushGated(
  items: InboxItem[],
  candidate: Omit<InboxItem, 'url'>,
  rawUrl: string | undefined,
): void {
  const url = safeGitHubHref(rawUrl);
  if (url === undefined) {
    return;
  }
  items.push({ ...candidate, url });
}

/**
 * Builds and pushes a single row in isolation. Id construction
 * ({@link buildCiId}, {@link buildSecurityId}, …) asserts its segments, so one
 * malformed row (e.g. a non-safe-integer alert number) throws. Confining that
 * throw here degrades that row to a skip rather than aborting the whole fleet
 * derive (#238). The transform stays pure: the skip is silent — no clock, no
 * logging (§1).
 */
function emitRow(build: () => void): void {
  try {
    build();
  } catch {
    // A row whose id cannot be built is skipped, never emitted (#238).
  }
}

function collectCi(repo: Repo, data: RepoSignalData, items: InboxItem[]): void {
  const ci = data.ci;
  if (ci?.status !== 'ready' || ci.conclusion !== 'failure') {
    return;
  }
  // A stable `ci:<repo>:<run-id>` item needs the run's identity + instant.
  if (typeof ci.runId !== 'number' || typeof ci.updatedAt !== 'string') {
    return;
  }
  // Capture the narrowed values: control-flow narrowing of `ci.runId` /
  // `ci.updatedAt` does not survive into the `emitRow` closure.
  const runId = ci.runId;
  const updatedAt = ci.updatedAt;
  emitRow(() =>
    pushGated(
      items,
      {
        id: buildCiId(repo.nameWithOwner, runId),
        kind: 'ci',
        repo,
        title: 'CI failing',
        timestamp: updatedAt,
        accent: 'failure',
      },
      ci.latestRunUrl,
    ),
  );
}

function collectReviews(repo: Repo, data: RepoSignalData, items: InboxItem[]): void {
  const reviews = data.reviews;
  if (reviews?.status !== 'ready' || reviews.requests === undefined) {
    return;
  }
  for (const pr of reviews.requests) {
    emitRow(() =>
      pushGated(
        items,
        {
          id: buildReviewId(repo.nameWithOwner, pr.number),
          kind: 'review',
          repo,
          title: pr.title,
          timestamp: pr.created_at,
          accent: 'warning',
        },
        pr.html_url,
      ),
    );
  }
}

function collectNewPrs(repo: Repo, data: RepoSignalData, items: InboxItem[]): void {
  const pullRequests = data.pullRequests;
  if (pullRequests?.status !== 'ready' || pullRequests.externalPullRequests === undefined) {
    return;
  }
  for (const pr of pullRequests.externalPullRequests) {
    emitRow(() =>
      pushGated(
        items,
        {
          id: buildNewPrId(repo.nameWithOwner, pr.number),
          kind: 'new-pr',
          repo,
          title: pr.title,
          timestamp: pr.created_at,
          accent: 'coral',
        },
        pr.html_url,
      ),
    );
  }
}

function collectSecurity(repo: Repo, data: RepoSignalData, items: InboxItem[]): void {
  const security = data.security;
  if (security?.status !== 'ready' || security.alerts === undefined) {
    return;
  }
  for (const alert of security.alerts) {
    emitRow(() =>
      pushGated(
        items,
        {
          id: buildSecurityId(repo.nameWithOwner, alert.type, alert.number),
          kind: 'security',
          repo,
          title: securityTitle(alert),
          timestamp: alert.created_at,
          severity: alert.severity,
          accent: SECURITY_SEVERITY_ACCENT[alert.severity],
        },
        alert.html_url,
      ),
    );
  }
}

function collectStale(repo: Repo, data: RepoSignalData, items: InboxItem[]): void {
  const stale = data.stale;
  if (stale?.status !== 'ready' || stale.staleItems === undefined) {
    return;
  }
  for (const item of stale.staleItems) {
    emitRow(() =>
      pushGated(
        items,
        {
          id: buildStaleId(repo.nameWithOwner, item.type, item.number),
          kind: 'stale',
          repo,
          title: item.title,
          timestamp: item.updated_at,
          accent: 'warning',
        },
        item.html_url,
      ),
    );
  }
}

/** An {@link InboxItem} paired with its timestamp parsed to an instant once. */
interface TimedItem {
  item: InboxItem;
  /** `Date.parse(item.timestamp)`; `NaN` for an empty/non-ISO timestamp. */
  instant: number;
}

/**
 * Ascending-`id` tie-break (ids lexicographically). Ids are unique and
 * deterministic, so this yields a stable total order whenever two items share —
 * or both lack — a comparable instant.
 */
function compareIds(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  if (a > b) {
    return 1;
  }
  return 0;
}

/**
 * Newest-first by the precomputed `instant`, falling through to the
 * deterministic ascending-`id` tie-break for equal OR non-finite instants
 * (§4.1, AC-7).
 *
 * Upstream timestamps are `z.string()` (not `.datetime()`), so an empty/non-ISO
 * value parses to `NaN`. A non-finite instant is treated as the **oldest**
 * possible time, so such items sort *last* and then tie-break by `id` — never
 * collapsing the order. (Comparing `NaN` directly returns `NaN`, which
 * `Array.sort` treats as `0`: it silently skips the tie-break and strands the
 * item at a wrong-but-deterministic position — #237.) Each instant is parsed
 * once up front, not per comparison — #239.
 */
function compareTimed(a: TimedItem, b: TimedItem): number {
  const aFinite = Number.isFinite(a.instant);
  const bFinite = Number.isFinite(b.instant);
  if (aFinite && bFinite && a.instant !== b.instant) {
    return b.instant - a.instant;
  }
  if (aFinite !== bFinite) {
    // Exactly one parseable: the finite (real) instant is newer → comes first.
    return aFinite ? -1 : 1;
  }
  // Equal instants, or both non-finite (oldest) → deterministic id tie-break.
  return compareIds(a.item.id, b.item.id);
}

/**
 * Derives the flat, newest-first Inbox item list from the fleet's already-
 * fetched signal data. Pure and deterministic: `repos` and the data each
 * `getRowData(repo)` returns are the only inputs, and identical input yields
 * byte-identical output (§2.3).
 */
export function deriveInboxItems(repos: readonly Repo[], getRowData: GetRowData): InboxItem[] {
  const items: InboxItem[] = [];
  for (const repo of repos) {
    const data = getRowData(repo);
    collectCi(repo, data, items);
    collectReviews(repo, data, items);
    collectNewPrs(repo, data, items);
    collectSecurity(repo, data, items);
    collectStale(repo, data, items);
  }
  // Decorate-sort-undecorate: parse each timestamp to an instant exactly once
  // (not per comparison — #239), then order newest-first as a total order.
  return items
    .map((item) => ({ item, instant: Date.parse(item.timestamp) }))
    .sort(compareTimed)
    .map(({ item }) => item);
}
