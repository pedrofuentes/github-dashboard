import { useRepoOwner } from '../../hooks/useRepoOwner';
import { formatRepoLabel } from '../../lib/repo-owner-preference';
import type { Repo } from '../../types/fleet';

interface RepoCellProps {
  repo: Repo;
}

function LockIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      width="12"
      height="12"
      fill="currentColor"
      className="shrink-0 text-text-muted"
    >
      <path d="M4 6V4a4 4 0 1 1 8 0v2h.5A1.5 1.5 0 0 1 14 7.5v6A1.5 1.5 0 0 1 12.5 15h-9A1.5 1.5 0 0 1 2 13.5v-6A1.5 1.5 0 0 1 3.5 6H4Zm2 0h4V4a2 2 0 1 0-4 0v2Z" />
    </svg>
  );
}

/**
 * Row-header cell for the Repo column: the `owner/repo` anchor, truncated to
 * ~24 characters with a full-name `title` tooltip, plus a non-visual private
 * indicator (icon + screen-reader text — never colour alone).
 */
export function RepoCell({ repo }: RepoCellProps) {
  const { display } = useRepoOwner();
  return (
    <span className="flex items-center gap-1.5">
      {repo.isPrivate ? (
        <>
          <LockIcon />
          <span className="sr-only">private repository</span>
        </>
      ) : null}
      <span
        className="block truncate font-medium text-text"
        style={{ maxWidth: '24ch' }}
        title={repo.nameWithOwner}
      >
        {formatRepoLabel(repo, display)}
      </span>
    </span>
  );
}
