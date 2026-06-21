/**
 * `ActivityTileBody` — the bespoke body for the Activity tile (DESIGN-TILES
 * §4.7). It owns only the inner visual; the surrounding TileFrame paints the
 * accent bar, header, and footer.
 *
 * It reads weekly commit activity via {@link useCommitActivity} and renders a
 * dual visual in the `success` (activity) ink:
 *
 * - **compact / standard:** a {@link Sparkline} of the per-week totals plus the
 *   total commit count as a hero {@link BigValue}.
 * - **expanded:** additionally a {@link Heatmap} (weeks × 7 days) below the
 *   sparkline — the scaled-up touch-strip view.
 *
 * Redundant encoding (never colour-only, WCAG 2.1 AA): the sparkline carries an
 * sr-only summary ("N commits over M weeks"), the total is stated as a number,
 * and the heatmap exposes per-cell `<title>`s and an sr-only weekly-totals
 * table. Every non-`ok` state renders a meaning-bearing fallback — a
 * reduced-motion-safe skeleton (`loading`), "Computing…" (`computing`), "No
 * recent commit activity" with a flat sparkline (`empty`), and "Activity
 * unavailable" (`error`) — so the body is never blank and never throws.
 *
 * Theming is token-only (`var(--color-*)` / `text-accent-*` utilities), so a
 * single `.dark` flip recolours it.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */
import type { ReactElement } from 'react';

import { useCommitActivity } from '../../../hooks/useCommitActivity';
import type { Repo } from '../../../types/fleet';
import { BigValue } from '../BigValue';
import { Heatmap } from '../Heatmap';
import { Sparkline } from '../Sparkline';
import type { TileTier } from '../types';

export interface ActivityTileBodyProps {
  /** The repo this tile represents — its commit activity is fetched lazily. */
  repo: Repo;
  /** Density tier the surrounding TileFrame measured (DESIGN-TILES §3.4). */
  size: TileTier;
}

/** Number of weeks shown in the empty-state placeholder sparkline. */
const EMPTY_SPARK_WEEKS = 8;

/** Pluralises "week"/"commit" for the screen-reader summary. */
function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/**
 * Body for the Activity tile (DESIGN-TILES §4.7). Renders a commit-activity
 * sparkline (+ heatmap when expanded) tinted with the `success` accent, with a
 * meaning-bearing fallback for every load state.
 */
export function ActivityTileBody({ repo, size }: ActivityTileBodyProps): ReactElement {
  const activity = useCommitActivity(repo);

  if (activity.state === 'loading') {
    return (
      <div className="flex flex-col gap-2" aria-busy="true">
        <span
          aria-hidden="true"
          className="h-6 w-24 animate-pulse rounded bg-surface-raised motion-reduce:animate-none"
        />
        <span className="sr-only">Loading commit activity…</span>
      </div>
    );
  }

  if (activity.state === 'computing') {
    return (
      <div className="flex items-center gap-2 text-text-muted">
        <span aria-hidden="true" className="text-lg leading-none">
          …
        </span>
        <span className="text-sm">Computing…</span>
        <span className="sr-only">
          GitHub is still preparing commit statistics for {repo.nameWithOwner}
        </span>
      </div>
    );
  }

  if (activity.state === 'empty') {
    const flat = Array.from({ length: EMPTY_SPARK_WEEKS }, () => 0);
    return (
      <div className="flex items-center gap-2 text-text-muted">
        <Sparkline
          data={flat}
          tone="success"
          srLabel={`Zero commits in the recent window for ${repo.nameWithOwner}`}
        />
        <span className="text-sm">No recent commit activity</span>
      </div>
    );
  }

  if (activity.state === 'error') {
    return (
      <div className="flex items-center gap-2 text-accent-failure">
        <span aria-hidden="true" className="text-lg font-semibold leading-none">
          ✗
        </span>
        <span className="text-sm">Activity unavailable</span>
        <span className="sr-only">Couldn’t load commit activity for {repo.nameWithOwner}</span>
      </div>
    );
  }

  const { weeks } = activity;
  const weeklyTotals = weeks.map((w) => w.total);
  const totalCommits = weeklyTotals.reduce((sum, total) => sum + total, 0);
  const weekCount = weeks.length;
  const sparkSrLabel = `${plural(totalCommits, 'commit')} over ${plural(weekCount, 'week')} in ${repo.nameWithOwner}`;
  const heatmapSrLabel = `Commit activity heatmap for ${repo.nameWithOwner}: ${plural(totalCommits, 'commit')} over ${plural(weekCount, 'week')}`;
  const showHeatmap = size === 'expanded';

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-x-3 gap-y-1">
        <span className="inline-flex items-end gap-1.5">
          <BigValue value={totalCommits} tone="success" size={size} />
          {size !== 'compact' ? (
            <span aria-hidden="true" className="pb-1 text-sm text-text-muted">
              commits
            </span>
          ) : null}
        </span>
        <Sparkline data={weeklyTotals} tone="success" srLabel={sparkSrLabel} />
        <span className="sr-only">{sparkSrLabel}</span>
      </div>

      {size !== 'compact' ? (
        <p aria-hidden="true" className="text-sm text-text-muted">
          last {plural(weekCount, 'week')}
        </p>
      ) : null}

      {showHeatmap ? (
        <Heatmap weeks={weeks.map((w) => w.days)} tone="success" srLabel={heatmapSrLabel} />
      ) : null}
    </div>
  );
}
