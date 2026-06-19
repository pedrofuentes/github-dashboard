import type { FleetColumn } from '../../types/fleet';
import { StubCell } from './StubCell';

/**
 * CI signal — STUB. Replaced by issue #12 (failing GitHub Actions). To take
 * this over: keep the `id`, populate `render` from `data.ci`, and add
 * `sortable` + `getSortValue` reading `data.ci.score`. See `columns/index.ts`.
 */
export const ciColumn: FleetColumn = {
  id: 'ci',
  header: 'CI',
  align: 'center',
  render: () => <StubCell srLabel="CI status not available yet" />,
};
