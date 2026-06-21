import type { ReactElement } from 'react';

import type { PullRequestsSignalSlice, Repo, RepoSignalData } from '../../../types/fleet';
import type { TileTier } from '../types';
import { BigValue } from '../BigValue';
import { Chip } from '../Chip';

export interface PrsTileBodyProps {
  /** The repo this tile represents — used for accessible context. */
  repo: Repo;
  /** The repo's signal payload; this body reads only `data.pullRequests`. */
  data: RepoSignalData;
  /** Density tier the surrounding TileFrame measured (DESIGN-TILES §3.4). */
  size: TileTier;
}

/** Decorative star (the ★ new-contributor mark from DESIGN-TILES §4.3). */
function StarIcon(): ReactElement {
  return (
    <svg viewBox="0 0 16 16" width="11" height="11" fill="currentColor" aria-hidden="true">
      <path d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.751.751 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25Z" />
    </svg>
  );
}

/**
 * Body for the Pull-requests tile (DESIGN-TILES §4.3). Renders the
 * `data.pullRequests` slice only — TileFrame owns the accent bar, header, and
 * footer. The open-PR count is the hero `BigValue`; when external
 * (new-contributor) PRs exist the hero escalates to `accent-coral` and a
 * redundant `Chip` (icon + text + sr-only sentence + hover title) calls them
 * out. Density follows the three §3.4 tiers, and every §3.6 state renders a
 * meaning-bearing fallback instead of a blank card.
 */
export function PrsTileBody({ repo, data, size }: PrsTileBodyProps): ReactElement {
  const slice: PullRequestsSignalSlice | undefined = data.pullRequests;
  const status = slice?.status ?? 'unknown';

  if (status === 'loading') {
    return (
      <div className="flex flex-col gap-2" aria-busy="true">
        <span
          aria-hidden="true"
          className="h-8 w-16 animate-pulse rounded bg-surface-raised motion-reduce:animate-none"
        />
        <span className="sr-only">Loading pull requests…</span>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="flex items-center gap-2 text-accent-failure">
        <span aria-hidden="true" className="text-lg font-semibold leading-none">
          ✗
        </span>
        <span className="text-sm">Couldn’t load pull requests</span>
        <span className="sr-only">in {repo.nameWithOwner}</span>
      </div>
    );
  }

  if (status !== 'ready') {
    return (
      <div className="flex items-center gap-2 text-text-muted">
        <span aria-hidden="true" className="text-lg leading-none">
          —
        </span>
        <span className="text-sm">n/a</span>
        <span className="sr-only">No pull request data for {repo.nameWithOwner}</span>
      </div>
    );
  }

  const openCount = slice?.openCount ?? 0;
  const externalCount = slice?.externalCount ?? 0;

  if (openCount === 0) {
    return (
      <div className="flex items-center gap-2 text-accent-success">
        <span aria-hidden="true" className="text-lg font-semibold leading-none">
          ✓
        </span>
        <span className="text-sm">No open PRs</span>
        <span className="sr-only">No open pull requests in {repo.nameWithOwner}</span>
      </div>
    );
  }

  const hasExternal = externalCount > 0;
  const heroTone = hasExternal ? 'coral' : 'info';
  const openNoun = openCount === 1 ? 'open pull request' : 'open pull requests';
  const externalNoun = externalCount === 1 ? 'pull request' : 'pull requests';
  const externalAbbrev = externalCount === 1 ? 'PR' : 'PRs';
  const externalSrLabel = `${externalCount} external-contributor ${externalNoun} in ${repo.nameWithOwner}`;
  const externalTitle = `${externalCount} ${externalAbbrev} from new outside contributors`;
  const descriptive = hasExternal
    ? `${openCount} open · ${externalCount} from external contributors`
    : `${openCount} open`;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-end gap-x-2 gap-y-1">
        <span className="inline-flex items-end gap-1.5">
          <BigValue value={openCount} tone={heroTone} size={size} />
          {size !== 'compact' ? (
            <span aria-hidden="true" className="pb-1 text-sm text-text-muted">
              open
            </span>
          ) : null}
        </span>
        <span className="sr-only">
          {openCount} {openNoun} in {repo.nameWithOwner}
        </span>
        {hasExternal && size !== 'compact' ? (
          <Chip tone="coral" icon={<StarIcon />} title={externalTitle} srLabel={externalSrLabel}>
            {externalCount} external
          </Chip>
        ) : null}
      </div>

      {hasExternal && size === 'compact' ? (
        <Chip tone="coral" icon={<StarIcon />} title={externalTitle} srLabel={externalSrLabel}>
          {externalCount}
        </Chip>
      ) : null}

      {size === 'expanded' ? (
        <p aria-hidden="true" className="text-sm text-text-muted">
          {descriptive}
        </p>
      ) : null}
    </div>
  );
}
