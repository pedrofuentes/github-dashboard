import type { FleetColumn } from '../../types/fleet';
import { StaleCell } from './StaleCell';

/**
 * Stale column (issue #17) — open PRs and issues with no recent activity. Sorts
 * by the slice `score` (the stale count), descending so the most-neglected
 * repos surface first; repos with no slice or score sort last (`-1`).
 */
export const staleColumn: FleetColumn = {
  id: 'stale',
  header: 'Stale',
  align: 'center',
  sortable: true,
  defaultSortDirection: 'desc',
  getSortValue: (_, data) => data.stale?.score ?? -1,
  render: (_, data) => <StaleCell slice={data.stale} />,
};
