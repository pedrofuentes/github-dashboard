/**
 * IssuesTileBody — the body content for the Issues signal tile
 * (DESIGN-TILES §4.5). The shared {@link TileFrame} owns the accent bar, header
 * and footer; this component renders only the body for `data.issues`.
 *
 * The hero is the {@link BigValue} open-issue count beside an issue
 * {@link StatusGlyph}. The backlog reads neutral until it crosses the triage
 * threshold, at which point a triage {@link StatusGlyph} (warning triangle) plus
 * the words "over triage threshold" *and* the warning accent all flag it — never
 * colour alone. All colour comes from semantic tokens (no hard-coded hex, AA in
 * both themes), and any missing/garbage field degrades to a safe neutral state
 * rather than throwing or rendering blank.
 */
import type { ReactElement } from 'react';

import type { Density } from '../../../lib/density-preference';
import type { Repo, RepoSignalData } from '../../../types/fleet';
import { BigValue } from '../BigValue';
import { StatusGlyph } from '../StatusGlyph';
import type { AccentTone, TileTier } from '../types';

export interface IssuesTileBodyProps {
  /** The repository this tile represents (reserved for deep links/labels). */
  repo: Repo;
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

/** Coerce an optional count to a safe, non-negative integer (never NaN). */
function safeCount(value: number | undefined): number {
  return Number.isFinite(value) && (value as number) > 0 ? Math.trunc(value as number) : 0;
}

/** Neutral container for the loading / error / unavailable states (never blank). */
function CenteredState({
  state,
  tone,
  glyph,
  message,
  srText,
}: {
  state: string;
  tone: 'muted' | 'error';
  glyph: ReactElement;
  message: string;
  srText: string;
}): ReactElement {
  return (
    <div
      data-state={state}
      className={`flex h-full flex-col items-center justify-center ${
        tone === 'error' ? 'text-accent-failure' : 'text-text-muted'
      }`}
    >
      {glyph}
      <span aria-hidden="true" className="mt-1 text-sm">
        {message}
      </span>
      <span className="sr-only">{srText}</span>
    </div>
  );
}

export function IssuesTileBody({
  data,
  size,
  density = 'balanced',
}: IssuesTileBodyProps): ReactElement {
  const issues = data.issues;

  if (issues?.status === 'loading') {
    return (
      <CenteredState
        state="loading"
        tone="muted"
        glyph={<StatusGlyph status="loading" size={20} title="Loading issues…" />}
        message="Loading…"
        srText="Loading issues…"
      />
    );
  }

  if (issues?.status === 'error') {
    return (
      <CenteredState
        state="error"
        tone="error"
        glyph={<StatusGlyph status="failure" size={20} title="Issue count unavailable" />}
        message="Issue count unavailable"
        srText="Issue count unavailable"
      />
    );
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
  // GAP (no new request): a "▲N new" delta and a counts sparkline both need an
  // issue counts time-series the signal hook does not retain — deferred.
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

  const srLabel =
    openCount === 0
      ? 'No open issues'
      : overThreshold
        ? `${openCount} open ${noun}, over the triage threshold`
        : `${openCount} open ${noun}`;
  const staleSrLabel = showStaleMeta ? `, ${staleIssueCount} stale` : '';

  if (openCount === 0) {
    return (
      <div
        data-state="ready"
        data-tone={tone}
        data-tier={size}
        className="flex h-full flex-col items-center justify-center gap-1 text-center text-text-muted"
      >
        <StatusGlyph status="neutral" size={size === 'compact' ? 18 : 22} title="No open issues" />
        <span aria-hidden="true" className="text-sm">
          No open issues
        </span>
        <span className="sr-only">{srLabel}</span>
      </div>
    );
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
        {staleSrLabel}
      </span>
    </div>
  );
}
