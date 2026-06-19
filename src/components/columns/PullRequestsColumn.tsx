import type { FleetColumn } from '../../types/fleet';
import { PullRequestsCell } from './PullRequestsCell';

/**
 * The PRs column (issue #15) — open pull requests with a highlight for those
 * from new outside contributors. Sorts on the slice `score`, which weights
 * new-contributor PRs heavily, so the most attention-worthy repos lead a
 * descending sort. A missing/scoreless slice sorts below every real score.
 */
export const pullRequestsColumn: FleetColumn = {
  id: 'pullRequests',
  header: 'PRs',
  align: 'center',
  sortable: true,
  defaultSortDirection: 'desc',
  getSortValue: (_, d) => d.pullRequests?.score ?? -1,
  render: (_, d) => <PullRequestsCell slice={d.pullRequests} />,
};
