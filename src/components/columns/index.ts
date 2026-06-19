/**
 * Fleet column registry — the extension point for the signal features (#12-18).
 *
 * ## How the grid is built
 * `<FleetGrid>` renders its header row and body purely from an ordered array of
 * {@link FleetColumn} descriptors. Each column is a self-contained value:
 *
 *   { id, header, render(repo, data), isRowHeader?, sortable?,
 *     getSortValue?(repo, data), defaultSortDirection?, align? }
 *
 * `render` returns the cell body; `getSortValue` (when `sortable`) returns the
 * value the grid sorts by, reading the column's slice of `RepoSignalData`
 * (e.g. `data.ci`). The grid owns layout, sorting, filtering, a11y and state —
 * columns own only their cell + sort value.
 *
 * ## One column = one file
 * Every column lives in its own file and is registered here, so the six signal
 * features can land in parallel with near-zero merge conflict: each issue
 * replaces exactly one stub file and touches nothing else.
 *
 *   src/components/columns/
 *     RepoColumn.tsx          ← shipped (row anchor + default sort)
 *     CiColumn.tsx            ← stub, owned by #12
 *     SecurityColumn.tsx      ← stub, owned by #13
 *     ReviewsColumn.tsx       ← stub, owned by #14
 *     PullRequestsColumn.tsx  ← stub, owned by #15
 *     IssuesColumn.tsx        ← stub, owned by #16
 *     StaleColumn.tsx         ← stub, owned by #17
 *     index.ts                ← this registry (order = on-screen order)
 *
 * ## To replace a stub (per signal feature)
 * 1. Extend the column's slice in `src/types/fleet.ts` if richer data is needed.
 * 2. Render real content from `data.<slice>`; encode state with icon **and**
 *    text/`aria-label`, never colour alone (WCAG 2.1 AA).
 * 3. Add `sortable: true` + `getSortValue` (and an optional
 *    `defaultSortDirection`) so the column joins the sort model — including the
 *    future composite "most broken" score (#18) that sums the slice scores.
 * 4. Keep the cell component in its own file (e.g. `CiCell.tsx`) and import it,
 *    so the descriptor file stays Fast-Refresh clean (no local components).
 *
 * Column files must export only their descriptor const; cell components live in
 * sibling files. The grid never imports a column directly — only this array.
 */
import type { FleetColumn } from '../../types/fleet';
import { ciColumn } from './CiColumn';
import { issuesColumn } from './IssuesColumn';
import { pullRequestsColumn } from './PullRequestsColumn';
import { repoColumn } from './RepoColumn';
import { reviewsColumn } from './ReviewsColumn';
import { securityColumn } from './SecurityColumn';
import { staleColumn } from './StaleColumn';

/** The MVP columns, left-to-right (PRD F1 order). */
export const fleetColumns: FleetColumn[] = [
  repoColumn,
  ciColumn,
  securityColumn,
  reviewsColumn,
  pullRequestsColumn,
  issuesColumn,
  staleColumn,
];

export {
  repoColumn,
  ciColumn,
  securityColumn,
  reviewsColumn,
  pullRequestsColumn,
  issuesColumn,
  staleColumn,
};
