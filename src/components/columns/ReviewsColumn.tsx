import type { FleetColumn } from '../../types/fleet';
import { StubCell } from './StubCell';

/**
 * Reviews signal — STUB. Replaced by issue #14 (review requests assigned to the
 * viewer). Populate `render` from `data.reviews` and add sorting on
 * `data.reviews.score`. See `columns/index.ts`.
 */
export const reviewsColumn: FleetColumn = {
  id: 'reviews',
  header: 'Reviews',
  align: 'center',
  render: () => <StubCell srLabel="Review queue not available yet" />,
};
