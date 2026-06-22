/**
 * Shared types for the Fleet overview grid.
 *
 * This module is intentionally free of runtime values so it emits no JS and
 * stays outside coverage accounting — keep it that way (helpers with behavior
 * belong in `src/lib/fleet-sort.ts`).
 */
import type { ReactNode } from 'react';

/** A single repository anchored by its `owner/repo` full name. */
export interface Repo {
  /** `owner/repo`, e.g. `octocat/hello-world`. */
  nameWithOwner: string;
  /** The owner login, e.g. `octocat`. */
  owner: string;
  /** The bare repository name, e.g. `hello-world`. */
  name: string;
  /** Whether the repository is private (surfaced non-visually for a11y). */
  isPrivate: boolean;
}

/** Lifecycle of a per-repo signal cell (features #12-18 populate these). */
export type SignalStatus = 'unknown' | 'loading' | 'ready' | 'error';

/**
 * Base shape every signal column shares. Signal features extend the registry
 * by reading their own slice from {@link RepoSignalData}; `score` feeds the
 * future composite "most broken" sort.
 */
export interface SignalSlice {
  status: SignalStatus;
  /** Higher = more attention needed; contributes to sort ordering. */
  score?: number;
}

/**
 * CI slice — owned by issue #12 (failing GitHub Actions). Carries the latest
 * workflow conclusion, how many workflows are currently failing, and a deep
 * link to the most recent run.
 *
 * `runId` and `updatedAt` un-project the latest run's identity already present
 * in the same `?per_page=1` response (the Notifications Inbox keys a
 * `ci:<repo>:<run-id>` item off them and orders it by `updatedAt`).
 */
export interface CiSignalSlice extends SignalSlice {
  conclusion?: 'success' | 'failure' | 'in_progress' | 'queued' | 'none';
  failingCount?: number;
  latestRunUrl?: string;
  /** The latest run's numeric id (GitHub Actions run id). */
  runId?: number;
  /** ISO-8601 timestamp of when the latest run was last updated. */
  updatedAt?: string;
}

/**
 * Severity of a single security alert — mirrors the alert feed's `AlertSeverity`
 * (kept here too so this pure-type module needs no api/github import).
 */
export type SecurityAlertSeverity = 'critical' | 'high' | 'medium' | 'low';

/**
 * Per-alert identity for ONE open security alert, retained from the already-
 * fetched feed body so {@link SecuritySignalSlice.alerts} can carry it across a
 * conditional (304) refresh and the Notifications Inbox can derive one stable
 * item per alert (INBOX-2B, issue #216). `number` is the GitHub alert number,
 * unique within a (repo, feed) pair; `type` disambiguates the two feeds.
 */
export interface SecurityAlertRow {
  number: number;
  type: 'dependabot' | 'code-scanning';
  severity: SecurityAlertSeverity;
  html_url: string;
  created_at: string;
}

/**
 * Security slice — owned by issue #13 (Dependabot / code-scanning alerts).
 * Carries a letter grade plus the alert breakdown by severity.
 */
export interface SecuritySignalSlice extends SignalSlice {
  grade?: 'A' | 'B' | 'C' | 'D' | 'E' | 'F';
  counts?: { critical: number; high: number; medium: number; low: number };
  /**
   * `true` when at least one contributing alert feed hit the pagination cap, so
   * the counts/grade are a lower bound and the cell shows a partial indicator
   * (issue #77). Omitted when every feed was fully counted.
   */
  truncated?: boolean;
  /**
   * Per-alert identity rows (one per OPEN alert across both feeds), retained so
   * a later `deriveInboxItems` can emit one stable inbox item per alert that
   * survives a conditional (304) refresh. Omitted entirely when there are no
   * alerts, so a clean slice stays byte-identical (INBOX-2B, issue #216).
   */
  alerts?: SecurityAlertRow[];
}

/**
 * A pull request awaiting the viewer's review, as un-projected from the
 * cross-repo `review-requested:@me` Search results (no extra request). One
 * `review:<repo>:#<number>` Inbox item is emitted per entry, ordered by
 * `created_at`.
 */
export interface ReviewRequestedPullRequest {
  number: number;
  title: string;
  html_url: string;
  created_at: string;
  /** PR author login (empty string when GitHub returns a null author). */
  user_login: string;
}

/** Reviews slice — owned by issue #14 (review requests assigned to the viewer). */
export interface ReviewsSignalSlice extends SignalSlice {
  requestedCount?: number;
  /** Per-PR identity for the Inbox; omitted when the repo has none awaiting. */
  requests?: ReviewRequestedPullRequest[];
}

/**
 * A new outside-contributor pull request, un-projected from the same
 * `/pulls?state=open` response (no extra request). Already filtered to
 * non-draft PRs from a new outside contributor; one `new-pr:<repo>:#<number>`
 * Inbox item is emitted per entry, ordered by `created_at`.
 */
export interface ExternalPullRequest {
  number: number;
  title: string;
  html_url: string;
  created_at: string;
  /** PR author login (empty string when GitHub returns a null author). */
  user_login: string;
  /** GitHub `author_association`, e.g. `FIRST_TIME_CONTRIBUTOR` or `NONE`. */
  author_association: string;
}

/** Pull-requests slice — owned by issue #15 (open / external-contributor PRs). */
export interface PullRequestsSignalSlice extends SignalSlice {
  openCount?: number;
  externalCount?: number;
  /** External, non-draft PR identity for the Inbox; omitted when there are none. */
  externalPullRequests?: ExternalPullRequest[];
}

/** Issues slice — owned by issue #16 (open issue counts / triage threshold). */
export interface IssuesSignalSlice extends SignalSlice {
  openCount?: number;
  overThreshold?: boolean;
}

/**
 * A stale open PR or issue, un-projected from the same per-repo Search call
 * (its `per_page` widened and `sort=updated&order=desc` appended — no extra
 * request). One `stale:<repo>:<pr|issue>:#<number>` Inbox item is emitted per
 * entry, ordered by `updated_at`.
 */
export interface StaleItem {
  number: number;
  title: string;
  html_url: string;
  updated_at: string;
  /** `pr` when the Search item carried a `pull_request` field, else `issue`. */
  type: 'pr' | 'issue';
}

/** Stale slice — owned by issue #17 (stale branches / inactivity). */
export interface StaleSignalSlice extends SignalSlice {
  staleCount?: number;
  /** Per-item identity for the Inbox (bounded page); omitted when none stale. */
  staleItems?: StaleItem[];
}

/**
 * Per-repo signal payload. Each optional slot is owned by one signal feature
 * (issues #12-17) and carries every field that feature needs, so populating a
 * column never requires another edit to this file.
 */
export interface RepoSignalData {
  ci?: CiSignalSlice;
  security?: SecuritySignalSlice;
  reviews?: ReviewsSignalSlice;
  pullRequests?: PullRequestsSignalSlice;
  issues?: IssuesSignalSlice;
  stale?: StaleSignalSlice;
}

/** Resolves the signal payload for a repo (defaults to empty in the framework). */
export type GetRowData = (repo: Repo) => RepoSignalData;

/** Sortable values are compared as numbers or case-insensitively as strings. */
export type SortValue = string | number;

/** Sort direction for a column. */
export type SortDirection = 'asc' | 'desc';

/** The active sort: which column and in which direction. */
export interface FleetSortState {
  columnId: string;
  direction: SortDirection;
}

/**
 * A registry column descriptor. One column = one file under
 * `src/components/columns/`; see `columns/index.ts` for the extension pattern.
 */
export interface FleetColumn {
  /** Stable id used for sort persistence and registry ordering. */
  id: string;
  /** Visible, human-readable column header. */
  header: string;
  /** Marks the column whose cell is the row's `<th scope="row">` anchor. */
  isRowHeader?: boolean;
  /** Whether the header is a click/Enter/Space sortable control. */
  sortable?: boolean;
  /** Preferred direction applied the first time a column becomes active. */
  defaultSortDirection?: SortDirection;
  /** Horizontal alignment of the cell content. */
  align?: 'start' | 'center' | 'end';
  /** Produces the value used to sort by this column (defaults to repo name). */
  getSortValue?: (repo: Repo, data: RepoSignalData) => SortValue;
  /** Renders the cell body for a repo row. */
  render: (repo: Repo, data: RepoSignalData) => ReactNode;
}
