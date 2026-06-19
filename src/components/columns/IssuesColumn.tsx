import type { FleetColumn } from '../../types/fleet';
import { IssuesCell } from './IssuesCell';

/**
 * The Issues column (issue #16) — open issue counts (pull requests excluded)
 * with a triage-threshold flag. Sortable by the slice score, defaulting to
 * descending so the noisiest backlogs surface first; repos without a score
 * (no data yet, loading, or error) sort last.
 */
export const issuesColumn: FleetColumn = {
  id: 'issues',
  header: 'Issues',
  align: 'center',
  sortable: true,
  defaultSortDirection: 'desc',
  getSortValue: (_, data) => data.issues?.score ?? -1,
  render: (_, data) => <IssuesCell slice={data.issues} />,
};
