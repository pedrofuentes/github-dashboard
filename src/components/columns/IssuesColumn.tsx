import type { FleetColumn } from '../../types/fleet';
import { StubCell } from './StubCell';

/**
 * Issues signal — STUB. Replaced by issue #16 (open issue counts / triage).
 * Populate `render` from `data.issues` and add sorting on `data.issues.score`.
 * See `columns/index.ts`.
 */
export const issuesColumn: FleetColumn = {
  id: 'issues',
  header: 'Issues',
  align: 'center',
  render: () => <StubCell srLabel="Issue status not available yet" />,
};
