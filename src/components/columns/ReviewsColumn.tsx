import type { FleetColumn } from '../../types/fleet';
import { ReviewsCell } from './ReviewsCell';

/**
 * Reviews column (issue #15) — open PRs awaiting the viewer's review. Sorts by
 * the slice `score` (weighted count), descending so the repos demanding your
 * attention surface first; repos with no slice or score sort last (`-1`).
 */
export const reviewsColumn: FleetColumn = {
  id: 'reviews',
  header: 'Reviews',
  align: 'center',
  sortable: true,
  defaultSortDirection: 'desc',
  getSortValue: (_, data) => data.reviews?.score ?? -1,
  render: (_, data) => <ReviewsCell slice={data.reviews} />,
};
