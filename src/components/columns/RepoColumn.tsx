import type { FleetColumn } from '../../types/fleet';
import { RepoCell } from './RepoCell';

/**
 * The Repo column — the row's anchor and the framework's default sort. It is
 * the one `isRowHeader` column (rendered as `<th scope="row">`) and sorts by
 * the lowercased `owner/repo` name.
 */
export const repoColumn: FleetColumn = {
  id: 'repo',
  header: 'Repository',
  isRowHeader: true,
  sortable: true,
  defaultSortDirection: 'asc',
  align: 'start',
  getSortValue: (repo) => repo.nameWithOwner.toLowerCase(),
  render: (repo) => <RepoCell repo={repo} />,
};
