import type { FleetColumn } from '../../types/fleet';
import { SecurityCell } from './SecurityCell';

/**
 * Security signal — open Dependabot / code-scanning alerts (issue #14). Sorts
 * descending by the weighted alert score (repos needing attention first; repos
 * with no score sink to the bottom). Cell rendering lives in {@link SecurityCell}
 * so this descriptor file stays Fast-Refresh clean (const-only export).
 */
export const securityColumn: FleetColumn = {
  id: 'security',
  header: 'Security',
  align: 'center',
  sortable: true,
  defaultSortDirection: 'desc',
  getSortValue: (_repo, data) => data.security?.score ?? -1,
  render: (_repo, data) => <SecurityCell slice={data.security} />,
};
