/**
 * SecurityTileBody — the body content for the Security signal tile
 * (DESIGN-TILES §4.2). The shared {@link TileFrame} owns the accent bar, header
 * and footer; this component renders only the body for `data.security`.
 *
 * The letter grade carries the meaning (never colour alone): it is the hero in
 * the {@link ArcGauge} centre (or a {@link BigValue} at compact sizes), paired
 * with the labelled {@link SeverityBar} severity breakdown and numeric counts.
 * Grading is delegated to the shared `securityGrade` helper — this file never
 * re-implements the rubric. All colour comes from semantic tokens, so the tile
 * is theme-aware (no hard-coded hex) and AA.
 */
import type { ReactElement } from 'react';

import type { SecurityCounts } from '../../../hooks/signals/securityGrade';
import { computeGrade } from '../../../hooks/signals/securityGrade';
import type { Repo, RepoSignalData, SecuritySignalSlice } from '../../../types/fleet';
import { ArcGauge } from '../ArcGauge';
import { BigValue } from '../BigValue';
import type { SeveritySegment } from '../SeverityBar';
import { SeverityBar } from '../SeverityBar';
import { StatusGlyph } from '../StatusGlyph';
import type { AccentTone, TileTier } from '../types';
import { toneTextClass } from '../types';

type SecurityGrade = NonNullable<SecuritySignalSlice['grade']>;

export interface SecurityTileBodyProps {
  /** The repository this tile represents (reserved for deep links/labels). */
  repo: Repo;
  /** The repo's resolved signal payload. */
  data: RepoSignalData;
  /** Density tier to render at (DESIGN-TILES §3.4). */
  size: TileTier;
}

/** Grade → accent tone (DESIGN-TILES §4.2): A–B success, C warning, D–F failure. */
const GRADE_TONE: Record<SecurityGrade, AccentTone> = {
  A: 'success',
  B: 'success',
  C: 'warning',
  D: 'failure',
  E: 'failure',
  F: 'failure',
};

/**
 * Grade → arc fill (0–100). The gauge reads as a quality meter: a full arc at
 * grade A shrinks as the posture worsens. F keeps a small visible sliver so the
 * fill never vanishes entirely.
 */
const GRADE_FILL: Record<SecurityGrade, number> = {
  A: 100,
  B: 80,
  C: 60,
  D: 40,
  E: 24,
  F: 8,
};

/** [counts key, severity tone, compact glyph, spoken label] worst-first (§4.2). */
const SEVERITIES: ReadonlyArray<[keyof SecurityCounts, AccentTone, string, string]> = [
  ['critical', 'failure', 'C', 'Critical'],
  ['high', 'warning', 'H', 'High'],
  ['medium', 'info', 'M', 'Medium'],
  ['low', 'neutral', 'L', 'Low'],
];

function buildSegments(counts: SecurityCounts): SeveritySegment[] {
  return SEVERITIES.map(([key, tone, , label]) => ({ tone, value: counts[key], label }));
}

function compactSummary(counts: SecurityCounts): { compact: string; spoken: string } {
  const compact: string[] = [];
  const spoken: string[] = [];
  for (const [key, , glyph, label] of SEVERITIES) {
    const n = counts[key];
    if (n > 0) {
      compact.push(`${glyph}${n}`);
      spoken.push(`${n} ${label.toLowerCase()}`);
    }
  }
  return { compact: compact.join(' '), spoken: spoken.join(', ') };
}

function totalAlerts(counts: SecurityCounts): number {
  return counts.critical + counts.high + counts.medium + counts.low;
}

/** Neutral container for the "no data" / "no access" states (never blank). */
function NeutralState({ message, srText }: { message: string; srText: string }): ReactElement {
  return (
    <div
      data-state="unavailable"
      className="flex h-full flex-col items-center justify-center text-text-muted"
    >
      <StatusGlyph status="neutral" size={20} title={srText} />
      <span aria-hidden="true" className="mt-1 text-sm">
        {message}
      </span>
      <span className="sr-only">{srText}</span>
    </div>
  );
}

/** A compact severity tally line with an optional truncated ("≥ … partial") hint. */
function SummaryLine({
  counts,
  truncated,
}: {
  counts: SecurityCounts;
  truncated: boolean;
}): ReactElement {
  const { compact, spoken } = compactSummary(counts);
  const total = totalAlerts(counts);
  const partial = truncated && total > 0;
  const label = partial
    ? `At least ${spoken} (partial — more alerts not counted)`
    : `${total} open ${total === 1 ? 'alert' : 'alerts'}: ${spoken}`;

  return (
    <div className="flex flex-col items-center gap-0.5 text-center">
      <span aria-hidden="true" className="text-sm font-medium tabular-nums text-text">
        {partial ? `≥ ${compact}` : compact}
      </span>
      {partial && (
        <span
          aria-hidden="true"
          className="text-xs text-text-muted"
          title="Alert count is partial — pagination cap reached; more alerts were not counted"
        >
          partial
        </span>
      )}
      <span className="sr-only">{label}</span>
    </div>
  );
}

export function SecurityTileBody({ data, size }: SecurityTileBodyProps): ReactElement {
  const security = data.security;

  if (!security || security.status === 'unknown') {
    return <NeutralState message="n/a" srText="Security status unavailable" />;
  }

  if (security.status === 'loading') {
    return (
      <div
        data-state="loading"
        className="flex h-full flex-col items-center justify-center text-text-muted"
      >
        <StatusGlyph status="loading" size={20} title="Loading security…" />
        <span className="sr-only">Loading security…</span>
      </div>
    );
  }

  if (security.status === 'error') {
    return (
      <div
        data-state="error"
        className="flex h-full flex-col items-center justify-center text-accent-failure"
      >
        <StatusGlyph status="failure" size={20} title="Couldn't load security" />
        <span aria-hidden="true" className="mt-1 text-sm">
          Couldn't load security
        </span>
        <span className="sr-only">Couldn't load security</span>
      </div>
    );
  }

  // status === 'ready'
  if (!security.counts) {
    return <NeutralState message="n/a" srText="No security-alert access for this repository" />;
  }

  const counts = security.counts;
  const grade: SecurityGrade = security.grade ?? computeGrade(counts);
  const tone = GRADE_TONE[grade];
  const total = totalAlerts(counts);
  const allClear = total === 0;
  const truncated = security.truncated === true;
  const fill = GRADE_FILL[grade];

  const { spoken } = compactSummary(counts);
  const srLabel = allClear
    ? `Security grade ${grade}: no open alerts`
    : truncated
      ? `Security grade ${grade}: at least ${spoken} (partial — more alerts not counted)`
      : `Security grade ${grade}: ${spoken}`;

  const gradeHero = (
    <span className={`text-3xl font-bold leading-none ${toneTextClass(tone)}`}>{grade}</span>
  );

  const allClearNote = (
    <span className="inline-flex items-center gap-1 text-sm text-accent-success">
      <StatusGlyph status="success" size={14} title="No open alerts" />
      <span aria-hidden="true">No open alerts</span>
    </span>
  );

  // Compact: the grade as a BigValue only — no gauge, no breakdown (§3.4).
  if (size === 'compact') {
    return (
      <div
        data-state="ready"
        data-grade={grade}
        data-tone={tone}
        className="flex h-full flex-col items-center justify-center gap-1 text-center"
      >
        <BigValue value={grade} tone={tone} size="compact" />
        {allClear ? (
          allClearNote
        ) : (
          <span aria-hidden="true" className="text-xs text-text-muted tabular-nums">
            {truncated ? `≥ ${total}` : total} {total === 1 ? 'alert' : 'alerts'}
          </span>
        )}
        <span className="sr-only">{srLabel}</span>
      </div>
    );
  }

  return (
    <div
      data-state="ready"
      data-grade={grade}
      data-tone={tone}
      className="flex h-full flex-col items-center justify-center gap-2 text-center"
    >
      <ArcGauge value={fill} max={100} tone={tone} center={gradeHero} srLabel={srLabel} />
      {allClear ? (
        allClearNote
      ) : size === 'expanded' ? (
        <>
          <SummaryLine counts={counts} truncated={truncated} />
          <div data-part="severity-bar" className="w-full max-w-[16rem]">
            <SeverityBar segments={buildSegments(counts)} />
          </div>
        </>
      ) : (
        <SummaryLine counts={counts} truncated={truncated} />
      )}
    </div>
  );
}
