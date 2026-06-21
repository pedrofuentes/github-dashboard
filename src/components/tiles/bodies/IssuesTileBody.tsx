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

export function IssuesTileBody({ data, size }: IssuesTileBodyProps): ReactElement {
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
  const srLabel =
    openCount === 0
      ? 'No open issues'
      : overThreshold
        ? `${openCount} open ${noun}, over the triage threshold`
        : `${openCount} open ${noun}`;

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
      {size === 'expanded' ? (
        <span data-part="detail" aria-hidden="true" className="text-xs text-text-muted">
          {openCount} open {noun}
          {overThreshold ? ', over the triage threshold' : ''}
        </span>
      ) : null}
      <span className="sr-only">{srLabel}</span>
    </div>
  );
}
