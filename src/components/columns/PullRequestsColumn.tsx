import type { FleetColumn } from '../../types/fleet';
import { StubCell } from './StubCell';

/**
 * New PRs signal — STUB. Replaced by issue #15 (new external-contributor pull
 * requests). Populate `render` from `data.pullRequests` and add sorting on
 * `data.pullRequests.score`. See `columns/index.ts`.
 */
export const pullRequestsColumn: FleetColumn = {
  id: 'pullRequests',
  header: 'New PRs',
  align: 'center',
  render: () => <StubCell srLabel="New pull requests not available yet" />,
};
