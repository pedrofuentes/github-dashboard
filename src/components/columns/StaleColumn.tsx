import type { FleetColumn } from '../../types/fleet';
import { StubCell } from './StubCell';

/**
 * Stale signal — STUB. Replaced by issue #17 (stale branches / inactivity).
 * Populate `render` from `data.stale` and add sorting on `data.stale.score`.
 * See `columns/index.ts`.
 */
export const staleColumn: FleetColumn = {
  id: 'stale',
  header: 'Stale',
  align: 'center',
  render: () => <StubCell srLabel="Staleness not available yet" />,
};
