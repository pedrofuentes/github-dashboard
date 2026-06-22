/**
 * `ActivityTileBody` — the bespoke body for the Activity tile (DESIGN-TILES
 * §4.7). It owns only the inner visual; the surrounding TileFrame paints the
 * accent bar, header, footer, and ALL salience treatment. Activity is a CALM
 * tile whose identity colour is **purple** (`SIGNAL_IDENTITY_TONE.activity`);
 * the frame moves that identity to the header glyph and keeps a neutral edge, so
 * this body paints no edge/glow — only the hero, delta, and micro-viz, all in
 * the shared purple ink.
 *
 * It reads weekly commit activity via {@link useCommitActivity} and renders:
 *
 * - **compact:** the commits-THIS-week hero {@link BigValue} plus a ▲/▼ delta vs
 *   last week (fixed hero anchor — no micro-viz).
 * - **standard:** additionally a purple {@link Sparkline} of the per-week totals.
 * - **expanded:** additionally a purple {@link Heatmap} (weeks × 7 days).
 *
 * Hero metric — DATA GAP: the spec wants "merged PRs / week", but
 * {@link useCommitActivity} returns weekly **commit** activity, not merged PRs,
 * and a merged-PR count would need a new GitHub Search request (forbidden by the
 * no-new-request constraint). So the honest stand-in is **commits this week**
 * (`weeks.at(-1).total`) with a ▲/▼ delta vs last week (`weeks.at(-2).total`) —
 * one coherent metric + delta, killing the prior "↑18 … steady" contradiction.
 * Surfacing literal merged-PR counts is deferred until a data source exists.
 *
 * R1 — body-owned live announcement: Activity has no slice on `RepoSignalData`
 * (it self-fetches here), so `SignalTile` cannot announce the hero metric — the
 * frame's accessible summary falls back to scope + state ("recent activity").
 * This body therefore owns the live hero announcement: the count renders in a
 * body-owned `aria-live="polite"` region (via {@link BigValue} `live`), and a
 * redundant sr-only sentence states commits-this-week + delta in words.
 *
 * Redundant encoding (never colour-only, WCAG 2.1 AA): the delta carries a ▲/▼
 * glyph (shape, not just hue), the count is stated as a number, the sparkline
 * and heatmap each carry an sr-only summary, and the heatmap exposes per-cell
 * `<title>`s and an sr-only weekly-totals table. Every non-`ok` state renders a
 * meaning-bearing, calm fallback — a reduced-motion-safe skeleton (`loading`),
 * "Computing…" (`computing`), "No recent commit activity" (`empty`), and
 * "Activity unavailable" (`error`) — so the body is never blank and never throws.
 *
 * Theming is token-only (`tone="purple"` → `var(--color-purple)` /
 * `text-accent-*` utilities), so a single `.dark` flip recolours it.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */
import type { ReactElement } from 'react';

import { useCommitActivity } from '../../../hooks/useCommitActivity';
import type { Density } from '../../../lib/density-preference';
import { formatDelta } from '../../../lib/format';
import type { Repo } from '../../../types/fleet';
import { BigValue } from '../BigValue';
import { Heatmap } from '../Heatmap';
import { Sparkline } from '../Sparkline';
import { TileMessage } from '../TileMessage';
import type { TileTier } from '../types';

export interface ActivityTileBodyProps {
  /** The repo this tile represents — its commit activity is fetched lazily. */
  repo: Repo;
  /** Density tier the surrounding TileFrame measured (DESIGN-TILES §3.4). */
  size: TileTier;
  /**
   * Tile density (DESIGN-TILES §6; T15). In `glanceable` the standard tier drops
   * the sparkline so only the hero + delta remain; `balanced` (the default)
   * keeps it, and compact/expanded are unaffected.
   */
  density?: Density;
}

/**
 * Activity's calm identity accent (DESIGN-TILES §5; redesign R2). A `'purple'`
 * literal so it satisfies both the shared `AccentTone` (BigValue) and the
 * narrower local tone unions of `Sparkline`/`Heatmap` (which omit `ochre`).
 */
const ACTIVITY_TONE = 'purple' as const;

/** Pluralises "week"/"commit" for the screen-reader summary. */
function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/**
 * Words for the week-over-week delta, for the sr-only sentence (the visible
 * delta uses the ▲/▼ {@link formatDelta} glyph). Returns a no-comparison phrase
 * when there is no prior week.
 */
function deltaPhrase(latest: number, previous: number | undefined): string {
  if (previous === undefined) {
    return 'no prior week to compare';
  }
  const diff = latest - previous;
  if (diff === 0) {
    return 'no change from last week';
  }
  return diff > 0 ? `${diff} more than last week` : `${Math.abs(diff)} fewer than last week`;
}

/**
 * Body for the Activity tile (DESIGN-TILES §4.7). Renders a commits-this-week
 * hero + week-over-week delta, with a purple sparkline (standard) and heatmap
 * (expanded), plus a meaning-bearing fallback for every load state.
 */
export function ActivityTileBody({
  repo,
  size,
  density = 'balanced',
}: ActivityTileBodyProps): ReactElement {
  const activity = useCommitActivity(repo);

  if (activity.state === 'loading') {
    return <TileMessage kind="loading" message="Loading…" srText="Loading commit activity…" />;
  }

  if (activity.state === 'computing') {
    return (
      <div data-state="computing" className="flex items-center gap-2 text-text-muted">
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
    // Empty-`0` activity is calm, not an alarm — route it through the shared
    // all-clear row (success glyph, data-state "empty"); the Activity-specific
    // wording is preserved as the visible message + sr sentence.
    return (
      <TileMessage
        kind="all-clear"
        message="No recent commit activity"
        srText={`No commits in the recent window for ${repo.nameWithOwner}`}
      />
    );
  }

  if (activity.state === 'error') {
    return (
      <TileMessage
        kind="failed"
        message="Couldn't load"
        srText={`Couldn't load commit activity for ${repo.nameWithOwner}`}
      />
    );
  }

  const { weeks } = activity;
  const weeklyTotals = weeks.map((w) => w.total);
  const totalCommits = weeklyTotals.reduce((sum, total) => sum + total, 0);
  const weekCount = weeks.length;

  // Hero = commits THIS week (latest week), with a ▲/▼ delta vs last week. NOT
  // the all-weeks sum — see the file header for the merged-PRs/week GAP note.
  const commitsThisWeek = weeks.at(-1)?.total ?? 0;
  const previousWeek = weekCount >= 2 ? (weeks.at(-2)?.total ?? 0) : undefined;
  const deltaText = previousWeek === undefined ? '—' : formatDelta(commitsThisWeek - previousWeek);

  const heroSentence = `${plural(commitsThisWeek, 'commit')} this week in ${repo.nameWithOwner}; ${deltaPhrase(commitsThisWeek, previousWeek)}`;
  const sparkSrLabel = `${plural(totalCommits, 'commit')} over ${plural(weekCount, 'week')} in ${repo.nameWithOwner}`;
  const heatmapSrLabel = `Commit activity heatmap for ${repo.nameWithOwner}: ${plural(totalCommits, 'commit')} over ${plural(weekCount, 'week')}`;

  // Glanceable standard drops the sparkline so only the hero + delta remain;
  // balanced and expanded keep it (compact never shows it).
  const showStandardExtras = density === 'balanced' || size === 'expanded';
  const showSparkline = size !== 'compact' && showStandardExtras;
  const showHeatmap = size === 'expanded';

  return (
    <div
      data-state="ready"
      data-tone={ACTIVITY_TONE}
      data-tier={size}
      className="flex flex-col gap-2"
    >
      {/* R1: body-owned aria-live hero — the count announces in place. */}
      <div className="flex flex-wrap items-end gap-x-3 gap-y-1">
        <span className="inline-flex items-end gap-1.5">
          <BigValue value={commitsThisWeek} tone={ACTIVITY_TONE} size={size} live />
          {size !== 'compact' ? (
            <span aria-hidden="true" className="pb-1 text-sm text-text-muted">
              this week
            </span>
          ) : null}
        </span>
        <span
          data-part="delta"
          aria-hidden="true"
          className="pb-1 text-sm tabular-nums text-text-muted"
        >
          {deltaText}
        </span>
        <span className="sr-only">{heroSentence}</span>
      </div>

      {showSparkline ? (
        <div className="flex items-center gap-2">
          <Sparkline data={weeklyTotals} tone={ACTIVITY_TONE} srLabel={sparkSrLabel} />
          <span aria-hidden="true" className="text-xs text-text-muted">
            last {plural(weekCount, 'week')}
          </span>
        </div>
      ) : null}

      {showHeatmap ? (
        <Heatmap weeks={weeks.map((w) => w.days)} tone={ACTIVITY_TONE} srLabel={heatmapSrLabel} />
      ) : null}
    </div>
  );
}
