import type { FleetColumn } from '../../types/fleet';
import { CiCell } from './CiCell';

/**
 * The CI column — owned by issue #12 (failing GitHub Actions). Centered and
 * sortable by the slice `score`, with a descending default so failing repos
 * surface at the top. The cell lives in {@link CiCell}; this file exports only
 * the descriptor so it stays Fast-Refresh clean.
 */
export const ciColumn: FleetColumn = {
  id: 'ci',
  header: 'CI',
  align: 'center',
  sortable: true,
  defaultSortDirection: 'desc',
  getSortValue: (_, data) => data.ci?.score ?? -1,
  render: (_, data) => <CiCell slice={data.ci} />,
};
