import type { ReactElement } from 'react';

import type { Density } from '../../../lib/density-preference';
import { formatRelativeTime } from '../../../lib/format';
import type {
  ExternalPullRequest,
  PullRequestsSignalSlice,
  Repo,
  RepoSignalData,
} from '../../../types/fleet';
import type { AccentTone, TileTier } from '../types';
import { BigValue } from '../BigValue';
import { Chip } from '../Chip';
import { SeverityBar } from '../SeverityBar';

export interface PrsTileBodyProps {
  /** The repo this tile represents — used for accessible context. */
  repo: Repo;
  /** The repo's signal payload; this body reads only `data.pullRequests`. */
  data: RepoSignalData;
  /** Density tier the surrounding TileFrame measured (DESIGN-TILES §3.4). */
  size: TileTier;
  /**
   * Tile density (DESIGN-TILES §6; T15). In `glanceable` the standard tier drops
   * the 2-segment bar so only the hero + new-contributor flag remain; `balanced`
   * (the default) keeps it, and compact/expanded are unaffected.
   */
  density?: Density;
}

/**
 * GitHub `author_association` values that mark a PR author as a new outside
 * contributor (DESIGN-TILES §4.3). `externalPullRequests` is already filtered to
 * new outside contributors upstream, but we re-derive the count from the
 * association so the body's signal is honest about exactly what it counts.
 */
const NEW_CONTRIBUTOR_ASSOCIATIONS = new Set(['NONE', 'FIRST_TIME_CONTRIBUTOR', 'FIRST_TIMER']);

/** Decorative star (the ★ new-contributor mark from DESIGN-TILES §4.3). */
function StarIcon(): ReactElement {
  return (
    <svg viewBox="0 0 16 16" width="11" height="11" fill="currentColor" aria-hidden="true">
      <path d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.751.751 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25Z" />
    </svg>
  );
}

/**
 * Count new outside contributors among the external PRs by `author_association`.
 * When the identity array is absent (only `externalCount` is known) we fall back
 * to `externalCount` — the slice's external PRs are, by construction, new
 * outside contributors.
 */
function countNewContributors(prs: ExternalPullRequest[], externalCount: number): number {
  if (prs.length === 0) {
    return externalCount;
  }
  return prs.filter((pr) => NEW_CONTRIBUTOR_ASSOCIATIONS.has(pr.author_association)).length;
}

/** ISO `created_at` of the oldest external PR, or `undefined` when none exist. */
function oldestCreatedAt(prs: ExternalPullRequest[]): string | undefined {
  if (prs.length === 0) {
    return undefined;
  }
  return prs.reduce(
    (oldest, pr) =>
      new Date(pr.created_at).getTime() < new Date(oldest).getTime() ? pr.created_at : oldest,
    prs[0].created_at,
  );
}

/**
 * Body for the Pull-requests tile (DESIGN-TILES §4.3) — a CALM tile: identity
 * lives in the TileFrame header icon, so this body paints no edge/glow and only
 * renders the `data.pullRequests` slice. The open-PR count is the hero
 * `BigValue`; when new-contributor PRs exist it escalates to `accent-coral` and a
 * redundant `Chip` (icon + text + sr-only sentence + hover title) calls them out.
 *
 * DATA GAPS (honest fallbacks — none of these are in the slice, so we do NOT
 * fabricate them):
 *  - no draft count → the micro-viz is a 2-segment new-contributor/other-open
 *    bar (not a 3-segment review/new/draft bar);
 *  - no historical open-PR count → no `▲` delta on the hero;
 *  - no overall-oldest open-PR timestamp → the age shown is the oldest
 *    *external* (new-contributor) PR, explicitly labelled as such.
 *
 * Density follows the three §3.4 tiers around a fixed hero anchor: compact =
 * hero + new-contributor flag; standard adds the 2-segment bar; expanded adds
 * the oldest-external age + a descriptive breakdown. Every §3.6 state renders a
 * meaning-bearing fallback instead of a blank card, and all colour comes from
 * tokens (no inline status hex).
 */
export function PrsTileBody({
  repo,
  data,
  size,
  density = 'balanced',
}: PrsTileBodyProps): ReactElement {
  const slice: PullRequestsSignalSlice | undefined = data.pullRequests;
  const status = slice?.status ?? 'unknown';

  if (status === 'loading') {
    return (
      <div data-state="loading" className="flex flex-col gap-2" aria-busy="true">
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
      <div data-state="error" className="flex items-center gap-2 text-accent-failure">
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
      <div data-state="unavailable" className="flex items-center gap-2 text-text-muted">
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
      <div data-state="empty" className="flex items-center gap-2 text-accent-success">
        <span aria-hidden="true" className="text-lg font-semibold leading-none">
          ✓
        </span>
        <span className="text-sm">No open PRs</span>
        <span className="sr-only">No open pull requests in {repo.nameWithOwner}</span>
      </div>
    );
  }

  const externalPrs = slice?.externalPullRequests ?? [];
  const newContributorCount = countNewContributors(externalPrs, externalCount);
  const hasNewContributors = newContributorCount > 0;
  const heroTone: AccentTone = hasNewContributors ? 'coral' : 'info';

  const openNoun = openCount === 1 ? 'open pull request' : 'open pull requests';
  const contributorNoun = newContributorCount === 1 ? 'contributor' : 'contributors';
  const contributorLabel = `${newContributorCount} new ${contributorNoun}`;
  const contributorAbbrev = newContributorCount === 1 ? 'PR' : 'PRs';
  const contributorSrLabel = `${newContributorCount} new-contributor ${
    newContributorCount === 1 ? 'pull request' : 'pull requests'
  } in ${repo.nameWithOwner}`;
  const contributorTitle = `${newContributorCount} ${contributorAbbrev} from new outside contributors`;

  const otherOpen = Math.max(0, openCount - newContributorCount);
  const oldestExternal = oldestCreatedAt(externalPrs);
  // Glanceable standard drops the 2-segment bar; balanced and expanded keep it.
  const showStandardExtras = density === 'balanced' || size === 'expanded';
  const descriptive = hasNewContributors
    ? `${openCount} open · ${contributorLabel}`
    : `${openCount} open`;

  const contributorChip = (
    <Chip tone="coral" icon={<StarIcon />} title={contributorTitle} srLabel={contributorSrLabel}>
      {contributorLabel}
    </Chip>
  );

  return (
    <div data-state="ready" data-tone={heroTone} data-tier={size} className="flex flex-col gap-1.5">
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
        {hasNewContributors && size !== 'compact' ? contributorChip : null}
      </div>

      {hasNewContributors && size === 'compact' ? (
        <Chip
          tone="coral"
          icon={<StarIcon />}
          title={contributorTitle}
          srLabel={contributorSrLabel}
        >
          {newContributorCount}
        </Chip>
      ) : null}

      {hasNewContributors && size !== 'compact' && showStandardExtras ? (
        <SeverityBar
          max={openCount}
          segments={[
            { tone: 'coral', value: newContributorCount, label: 'New-contributor' },
            { tone: 'info', value: otherOpen, label: 'Other open' },
          ]}
        />
      ) : null}

      {size === 'expanded' && oldestExternal ? (
        <p aria-hidden="true" className="text-sm text-text-muted">
          Oldest new-contributor PR {formatRelativeTime(oldestExternal)}
        </p>
      ) : null}

      {size === 'expanded' ? (
        <p aria-hidden="true" className="text-sm text-text-muted">
          {descriptive}
        </p>
      ) : null}
    </div>
  );
}
