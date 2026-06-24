/**
 * IssuesTileBody — the body content for the Issues signal tile
 * (DESIGN-TILES §4.5). The shared {@link TileFrame} owns the accent bar, header
 * and footer; this component renders only the body for `data.issues`.
 *
 * The hero is the {@link BigValue} open-issue count beside an issue
 * {@link StatusGlyph}. The backlog reads neutral until it crosses the triage
 * threshold, at which point a triage {@link StatusGlyph} (warning triangle) plus
 * the words "over triage threshold" *and* the warning accent all flag it — never
 * colour alone. At standard/expanded a cross-slice meta line tallies stale *open
 * issues* (derived from `data.stale`, no extra fetch), and — when the slice
 * carries the viewer's author split (b2) — a neutral `N community · N mine` meta
 * breaks the open total down (the split always rides the accessible summary, even
 * where the visible meta is gated out). All colour comes from semantic tokens (no
 * hard-coded hex, AA in both themes), and any missing/garbage field degrades to a
 * safe neutral state rather than throwing or rendering blank.
 */
import type { ReactElement } from 'react';

import type { Density } from '../../../lib/density-preference';
import type { Repo, RepoSignalData } from '../../../types/fleet';
import { BigValue } from '../BigValue';
import { StatusGlyph } from '../StatusGlyph';
import { TileMessage } from '../TileMessage';
import type { AccentTone, TileTier } from '../types';
import { CenteredState } from './CenteredState';
import { safeCount } from './safeCount';

export interface IssuesTileBodyProps {
  /** The repository this tile represents (optional; reserved for deep links/labels). */
  repo?: Repo;
  /** The repo's resolved signal payload. */
  data: RepoSignalData;
  /** Density tier to render at (DESIGN-TILES §3.4). */
  size: TileTier;
  /**
   * Tile density (DESIGN-TILES §6; T15). In `glanceable` the standard tier drops
   * the stale meta so only the hero remains; `balanced` (the default) keeps it,
   * and compact/expanded are unaffected.
   */
  density?: Density;
}

export function IssuesTileBody({
  data,
  size,
  density = 'balanced',
}: IssuesTileBodyProps): ReactElement {
  const issues = data.issues;

  if (issues?.status === 'loading') {
    return <TileMessage kind="loading" message="Loading…" srText="Loading issues…" />;
  }

  if (issues?.status === 'error') {
    return <TileMessage kind="failed" message="Couldn't load" srText="Issue count unavailable" />;
  }

  // `unknown`, an absent slice, or any unexpected status → safe neutral.
  if (issues?.status !== 'ready') {
    return (
      <CenteredState
        state="unavailable"
        tone="muted"
        glyph={<StatusGlyph status="neutral" size={20} title="Issue count not available" />}
        message="n/a"
        srText="Issue count not available"
      />
    );
  }

  const openCount = safeCount(issues.openCount);
  const overThreshold = openCount > 0 && issues.overThreshold === true;
  const tone: AccentTone = overThreshold ? 'warning' : 'neutral';
  const noun = openCount === 1 ? 'issue' : 'issues';

  // Cross-slice meta: count stale *issues* from the stale slice (filtered to
  // `type === 'issue'`). The body already receives the full RepoSignalData, so
  // this needs no extra fetch. Undefined while stale is absent/loading/errored.
  // DEFERRED (no new request): a "▲N new" delta and a counts sparkline both need
  // an issue-counts time-series the signal hook does not retain — out of scope.
  const staleIssueCount =
    data.stale?.status === 'ready'
      ? (data.stale.staleItems ?? []).filter((item) => item.type === 'issue').length
      : undefined;
  // Glanceable standard drops the stale meta; balanced and expanded keep it.
  const showStandardExtras = density === 'balanced' || size === 'expanded';
  const showStaleMeta =
    size !== 'compact' &&
    showStandardExtras &&
    staleIssueCount !== undefined &&
    staleIssueCount > 0;

  // Community-vs-mine split (b2): present only when a viewer is authenticated,
  // so both counts arrive together. Guard on presence so a viewer-less slice is
  // byte-identical to before. The *visible* meta follows the stale gating
  // (hidden at compact / glanceable-standard), but the accessible summary always
  // carries the split when the data is present.
  const hasAuthorSplit =
    typeof issues.communityCount === 'number' && typeof issues.mineCount === 'number';
  const communityCount = safeCount(issues.communityCount);
  const mineCount = safeCount(issues.mineCount);
  const showSplitMeta = size !== 'compact' && showStandardExtras && hasAuthorSplit;

  const srLabel =
    openCount === 0
      ? 'No open issues'
      : overThreshold
        ? `${openCount} open ${noun}, over the triage threshold`
        : `${openCount} open ${noun}`;
  const splitSrLabel = hasAuthorSplit
    ? `, ${communityCount} from the community, ${mineCount} yours`
    : '';
  const staleSrLabel = showStaleMeta ? `, ${staleIssueCount} stale` : '';

  if (openCount === 0) {
    return <TileMessage kind="all-clear" message="All clear" srText={srLabel} />;
  }

  const issueGlyph = <StatusGlyph status="info" size={14} title="Open issues" />;

  return (
    <div
      data-state="ready"
      data-tone={tone}
      data-tier={size}
      className="flex h-full flex-col items-center justify-center gap-1.5 text-center"
    >
      <BigValue value={openCount} tone={tone} size={size} />
      <span
        aria-hidden="true"
        className={`inline-flex items-center gap-1 text-xs ${
          overThreshold ? 'font-medium text-accent-warning' : 'text-text-muted'
        }`}
      >
        {issueGlyph}
        {openCount} open
      </span>
      {overThreshold ? (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-accent-warning">
          <StatusGlyph status="warning" size={14} title="Over triage threshold" />
          <span aria-hidden="true">Over triage threshold</span>
        </span>
      ) : null}
      {showSplitMeta ? (
        <span
          data-part="author-split-meta"
          aria-hidden="true"
          className="inline-flex items-center gap-1 text-xs text-text-muted"
        >
          <StatusGlyph status="info" size={12} title="Issue authors" />
          <span>{communityCount} community</span>
          <span aria-hidden="true">·</span>
          <span className="font-medium text-text">{mineCount} mine</span>
        </span>
      ) : null}
      {showStaleMeta ? (
        <span
          data-part="stale-meta"
          aria-hidden="true"
          className="inline-flex items-center gap-1 text-xs text-text-muted"
        >
          <StatusGlyph status="neutral" size={12} title="Stale issues" />
          <span>{staleIssueCount} stale</span>
        </span>
      ) : null}
      {size === 'expanded' ? (
        <span data-part="detail" aria-hidden="true" className="text-xs text-text-muted">
          {openCount} open {noun}
          {overThreshold ? ', over the triage threshold' : ''}
        </span>
      ) : null}
      <span className="sr-only">
        {srLabel}
        {splitSrLabel}
        {staleSrLabel}
      </span>
    </div>
  );
}
