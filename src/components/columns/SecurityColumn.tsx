import type { FleetColumn } from '../../types/fleet';
import { StubCell } from './StubCell';

/**
 * Security signal — STUB. Replaced by issue #13 (Dependabot / code-scanning
 * alerts). Populate `render` from `data.security` and add sorting on
 * `data.security.score`. See `columns/index.ts`.
 */
export const securityColumn: FleetColumn = {
  id: 'security',
  header: 'Security',
  align: 'center',
  render: () => <StubCell srLabel="Security status not available yet" />,
};
