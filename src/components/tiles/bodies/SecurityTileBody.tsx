/**
 * SecurityTileBody — the body content for the Security signal tile
 * (DESIGN-TILES §4.2; redesign T8). The shared {@link TileFrame} owns the
 * salience edge/tint/glow; this component renders only the body for
 * `data.security`.
 *
 * The body is **severity-led**: the hero is the worst present severity and its
 * count (e.g. "2 Critical"), the total is demoted to a sub-line, and a stacked
 * {@link SeverityBar} (segment length = count) shows the breakdown. The bar
 * survives grayscale via 2px dividers + stepped heights + worst-first order —
 * never colour alone — and carries no fake threshold tick. Severity TEXT uses
 * the ink token (`text-accent-coral-ink` for High) to clear AA, while the bar
 * fill keeps the saturated `coral` token (redesign R5). The frame paints the
 * PROBLEM edge; the body never does.
 *
 * All colour comes from semantic tokens, so the tile is theme-aware (no
 * hard-coded hex) and AA in both themes. Every missing/garbage field degrades
 * to a safe, labelled state rather than throwing or rendering blank.
 */
import type { ReactElement, ReactNode } from 'react';

import type { SecurityCounts } from '../../../hooks/signals/securityGrade';
import { formatRelativeTime } from '../../../lib/format';
import type { Repo, RepoSignalData, SecurityAlertRow } from '../../../types/fleet';
import { BigValue } from '../BigValue';
import type { SeveritySegment } from '../SeverityBar';
import { SeverityBar } from '../SeverityBar';
import { StatusGlyph } from '../StatusGlyph';
import type { AccentTone, TileTier } from '../types';

export interface SecurityTileBodyProps {
  /** The repository this tile represents (reserved for deep links/labels). */
  repo: Repo;
  /** The repo's resolved signal payload. */
  data: RepoSignalData;
  /** Density tier to render at (DESIGN-TILES §3.4). */
  size: TileTier;
}

/** One severity row: counts key, bar-fill tone, AA text class, glyph + labels. */
interface Severity {
  key: keyof SecurityCounts;
  /** Saturated fill token for the {@link SeverityBar} segment (R5). */
  fill: AccentTone;
  /** AA-clearing TEXT class for hero/breakdown labels (ink token; R5). */
  text: string;
  /** Capitalised display label, e.g. "Critical". */
  label: string;
  /** Lower-case label for the meta tally, e.g. "critical". */
  word: string;
}

/**
 * Severity table, worst-first. The hero leads with the first non-zero row.
 * Fill keeps the saturated token (`failure`/`coral`/`info`/`neutral`); the TEXT
 * uses the ink token so "High" clears AA without a T19 contrast rework (R5):
 * `coral` (#db6d28) fails as text, `coral-ink` (#e8804f) passes.
 */
const SEVERITIES: readonly Severity[] = [
  {
    key: 'critical',
    fill: 'failure',
    text: 'text-accent-failure',
    label: 'Critical',
    word: 'critical',
  },
  { key: 'high', fill: 'coral', text: 'text-accent-coral-ink', label: 'High', word: 'high' },
  { key: 'medium', fill: 'info', text: 'text-accent-info', label: 'Medium', word: 'medium' },
  { key: 'low', fill: 'neutral', text: 'text-accent-neutral', label: 'Low', word: 'low' },
];

/**
 * Severities that make the tile a PROBLEM (critical/high/medium) — they get the
 * live hero announcement; a low-only tile is calm and stays silent (R6). Mirrors
 * `resolveSalience`'s security branch (critical → failure, high/medium → warning).
 */
const PROBLEM_KEYS: ReadonlySet<keyof SecurityCounts> = new Set(['critical', 'high', 'medium']);

function totalAlerts(counts: SecurityCounts): number {
  return counts.critical + counts.high + counts.medium + counts.low;
}

/** First non-zero severity, worst-first; `undefined` only when everything is 0. */
function worstSeverity(counts: SecurityCounts): Severity | undefined {
  return SEVERITIES.find((severity) => counts[severity.key] > 0);
}

/** Stacked-bar segments (worst-first), fill tone per severity. */
function buildSegments(counts: SecurityCounts): SeveritySegment[] {
  return SEVERITIES.map((severity) => ({
    tone: severity.fill,
    value: counts[severity.key],
    label: severity.label,
  }));
}

/** Most-recent alert recency, or `undefined` when there are no alert rows. */
function newestAlertRecency(alerts: SecurityAlertRow[] | undefined): string | undefined {
  if (!alerts || alerts.length === 0) {
    return undefined;
  }
  const newest = alerts.reduce((latest, alert) => {
    const t = new Date(alert.created_at).getTime();
    return Number.isFinite(t) && t > latest ? t : latest;
  }, Number.NEGATIVE_INFINITY);
  return Number.isFinite(newest) ? formatRelativeTime(newest) : undefined;
}

/** Spoken "2 critical, 5 high" list of every non-zero severity (for sr text). */
function spokenSummary(counts: SecurityCounts): string {
  return SEVERITIES.filter((severity) => counts[severity.key] > 0)
    .map((severity) => `${counts[severity.key]} ${severity.word}`)
    .join(', ');
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
  const total = totalAlerts(counts);
  const truncated = security.truncated === true;

  // All-clear: a calm, positive success state — visually unmistakable from an
  // alarm (no live region, success glyph). T16 will later route this through the
  // shared TileMessage; until then the body owns the treatment.
  if (total === 0) {
    return (
      <div
        data-state="ready"
        data-tone="success"
        data-tier={size}
        className="flex h-full flex-col items-center justify-center gap-1 text-center text-accent-success"
      >
        <StatusGlyph status="success" size={size === 'compact' ? 18 : 22} title="No open alerts" />
        <span aria-hidden="true" className="text-sm font-medium">
          All clear
        </span>
        <span className="sr-only">Security: all clear, no open alerts</span>
      </div>
    );
  }

  const worst = worstSeverity(counts) as Severity;
  const worstCount = counts[worst.key];
  const isProblem = PROBLEM_KEYS.has(worst.key);
  const recency = newestAlertRecency(security.alerts);
  const spoken = spokenSummary(counts);

  const totalText = `${truncated ? '≥ ' : ''}${total} total`;
  const srLabel = truncated
    ? `Security: at least ${spoken} (partial — more alerts not counted), ${total} total`
    : `Security: ${spoken}, ${total} total${recency ? `, newest ${recency}` : ''}`;

  // Hero "<count> <Severity>" — number in primary text, label in the AA ink
  // token. Announced live only on PROBLEM tiles (R6).
  const hero = (
    <BigValue
      value={
        <>
          <span className="text-text">{worstCount}</span>{' '}
          <span className={worst.text}>{worst.label}</span>
        </>
      }
      size={size}
      live={isProblem}
    />
  );

  // Tally of every non-zero severity, e.g. "2 critical · 5 high · 3 medium".
  const tally = SEVERITIES.filter((severity) => counts[severity.key] > 0)
    .map((severity) => `${counts[severity.key]} ${severity.word}`)
    .join(' · ');

  const metaParts: ReactNode[] = [
    <span key="tally">{tally}</span>,
    <span key="total" className="tabular-nums">
      {totalText}
    </span>,
  ];
  if (truncated) {
    metaParts.push(
      <span
        key="partial"
        title="Alert count is partial — pagination cap reached; more alerts were not counted"
      >
        partial
      </span>,
    );
  }
  if (recency) {
    metaParts.push(<span key="recency">{recency}</span>);
  }

  const meta = (
    <div
      data-part="meta"
      aria-hidden="true"
      className="flex flex-wrap items-center justify-center gap-x-1.5 gap-y-0.5 text-xs text-text-muted"
    >
      {metaParts.flatMap((part, index) =>
        index === 0
          ? [part]
          : [
              <span key={`sep-${String(index)}`} aria-hidden="true">
                ·
              </span>,
              part,
            ],
      )}
    </div>
  );

  const severityBar =
    size === 'compact' ? null : (
      <div data-part="severity-bar" className="w-full max-w-[16rem]">
        <SeverityBar segments={buildSegments(counts)} stepped dividers />
      </div>
    );

  const breakdown =
    size === 'expanded' ? (
      <ul
        data-part="breakdown"
        aria-hidden="true"
        className="flex w-full max-w-[16rem] flex-col gap-0.5 text-xs"
      >
        {SEVERITIES.filter((severity) => counts[severity.key] > 0).map((severity) => (
          <li key={severity.key} className="flex items-center justify-between">
            <span className={`font-medium ${severity.text}`}>{severity.label}</span>
            <span className="tabular-nums text-text-muted">{counts[severity.key]}</span>
          </li>
        ))}
      </ul>
    ) : null;

  return (
    <div
      data-state="ready"
      data-tone={worst.fill}
      data-tier={size}
      className="flex h-full flex-col items-center justify-center gap-1.5 text-center"
    >
      {hero}
      {size === 'compact' ? (
        <span aria-hidden="true" className="text-xs tabular-nums text-text-muted">
          {totalText}
        </span>
      ) : (
        <>
          {severityBar}
          {meta}
          {breakdown}
        </>
      )}
      <span className="sr-only">{srLabel}</span>
    </div>
  );
}
