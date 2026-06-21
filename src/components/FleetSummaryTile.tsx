/**
 * FleetSummaryTile — the pinned, glanceable anchor at the top of the at-a-glance
 * Dashboard view (DESIGN-TILES §4.8).
 *
 * Unlike the per-(repo, signal) {@link SignalTile}s, this card is **not** part of
 * the react-grid-layout grid: it can't be dragged, resized, hidden or removed.
 * It rolls the whole fleet up into a **health-split bar** — the broken / warning
 * / healthy proportions of `total` — plus the non-zero per-signal rollup chips
 * below it. Every figure is conveyed by an icon **and** text (never colour
 * alone), keeping the card WCAG 2.1 AA / colour-blind safe in both themes.
 */
import type { ReactElement } from 'react';

import { cn } from '../lib/cn';
import type { FleetHealthSummary } from '../lib/fleet-summary';
import { Chip } from './tiles/Chip';
import { SeverityBar } from './tiles/SeverityBar';
import { StatusGlyph } from './tiles/StatusGlyph';
import { toneTextClass } from './tiles/types';
import type { AccentTone, SignalIconKind } from './tiles/types';

export interface FleetSummaryTileProps {
  /** The aggregated fleet health to display. */
  summary: FleetHealthSummary;
}

interface HealthStat {
  key: 'broken' | 'warning' | 'healthy';
  /** Health tone painting the bar segment, glyph and label. */
  tone: AccentTone;
  /** Redundant status glyph paired with the count + word. */
  glyph: SignalIconKind;
  /** Word following the count, e.g. "need attention". */
  label: string;
  /** Segment / sr-region label inside the {@link SeverityBar}. */
  segmentLabel: string;
}

/** The three health buckets, worst-first, with their tones + redundant glyphs. */
const HEALTH_STATS: readonly HealthStat[] = [
  {
    key: 'broken',
    tone: 'failure',
    glyph: 'failure',
    label: 'need attention',
    segmentLabel: 'Need attention',
  },
  { key: 'warning', tone: 'warning', glyph: 'warning', label: 'warning', segmentLabel: 'Warning' },
  { key: 'healthy', tone: 'success', glyph: 'success', label: 'healthy', segmentLabel: 'Healthy' },
];

interface Rollup {
  /** The numeric field on {@link FleetHealthSummary} this chip surfaces. */
  key: 'failingCi' | 'securityRisk' | 'issuesOverThreshold' | 'reviewRequested' | 'staleRepos';
  /** Signal accent (DESIGN-TILES §1.4 / §4.8). */
  tone: AccentTone;
  /** Redundant status glyph for the chip. */
  glyph: SignalIconKind;
  /** Word(s) following the count. */
  label: string;
}

/** Per-signal rollups, ordered worst-first; rendered only when their count > 0. */
const ROLLUPS: readonly Rollup[] = [
  { key: 'failingCi', tone: 'failure', glyph: 'failure', label: 'failing CI' },
  { key: 'securityRisk', tone: 'failure', glyph: 'failure', label: 'security risk' },
  { key: 'issuesOverThreshold', tone: 'warning', glyph: 'warning', label: 'over issue threshold' },
  { key: 'reviewRequested', tone: 'warning', glyph: 'review', label: 'awaiting your review' },
  { key: 'staleRepos', tone: 'warning', glyph: 'stale', label: 'stale' },
];

export function FleetSummaryTile({ summary }: FleetSummaryTileProps): ReactElement {
  const repoNoun = summary.total === 1 ? 'repo' : 'repos';
  const hasFleet = summary.total > 0;
  const segments = HEALTH_STATS.map((stat) => ({
    tone: stat.tone,
    value: summary[stat.key],
    label: stat.segmentLabel,
  }));
  const rollups = ROLLUPS.filter((rollup) => summary[rollup.key] > 0);

  return (
    <section
      aria-label="Fleet summary"
      className="rounded-md border border-border bg-surface p-4 shadow-sm"
    >
      <h3 className="text-sm font-semibold text-text">
        {summary.total} {repoNoun}
      </h3>

      {hasFleet ? (
        <>
          <div className="mt-3">
            <SeverityBar segments={segments} max={summary.total} />
          </div>

          <ul role="list" className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            {HEALTH_STATS.map((stat) => (
              <li
                key={stat.key}
                className={cn(
                  'inline-flex items-center gap-1 font-medium',
                  toneTextClass(stat.tone),
                )}
              >
                <StatusGlyph status={stat.glyph} size={14} title={stat.segmentLabel} />
                <span className="tabular-nums">
                  {summary[stat.key]} {stat.label}
                </span>
              </li>
            ))}
          </ul>

          {rollups.length > 0 ? (
            <ul role="list" className="mt-3 flex flex-wrap items-center gap-2">
              {rollups.map((rollup) => (
                <li key={rollup.key}>
                  <Chip
                    tone={rollup.tone}
                    icon={<StatusGlyph status={rollup.glyph} size={14} title={rollup.label} />}
                  >
                    <span className="tabular-nums">
                      {summary[rollup.key]} {rollup.label}
                    </span>
                  </Chip>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
