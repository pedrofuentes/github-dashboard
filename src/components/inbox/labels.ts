/**
 * Shared Inbox label constants.
 *
 * Kept in a component-free module so both `InboxItemRow` (row text) and
 * `InboxView` (kind filter options) can import it without tripping
 * `react-refresh/only-export-components`.
 */
import type { InboxKind } from '../../types/inbox';

/** Human-readable kind labels — the redundant text layer paired with the accent. */
export const KIND_LABELS: Record<InboxKind, string> = {
  ci: 'CI failing',
  review: 'Review requested',
  'new-pr': 'New contributor PR',
  security: 'Security alert',
  stale: 'Stale',
};
