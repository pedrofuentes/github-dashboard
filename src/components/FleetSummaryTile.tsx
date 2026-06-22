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
import type { FleetHealthSummary, RepoHealth, RepoHealthEntry } from '../lib/fleet-summary';
import { AccentBar } from './tiles/AccentBar';
import { Chip } from './tiles/Chip';
import { SeverityBar } from './tiles/SeverityBar';
import { StatusGlyph } from './tiles/StatusGlyph';
import { toneBgClass, toneTextClass } from './tiles/types';
import type { AccentTone, SignalIconKind } from './tiles/types';

export interface FleetSummaryTileProps {
  /** The aggregated fleet health to display. */
  summary: FleetHealthSummary;
  /**
   * Per-repo classified health, feeding the worst-state strip + worst-child
   * chip. Defaults to an empty list (no strip / chip) so the rollup-only tile
   * keeps rendering when a caller has no per-repo entries to hand.
   */
  entries?: RepoHealthEntry[];
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
  /**
   * Footer rank: `act-now` metrics (failing CI, security risk) demand action
   * and are emphasised; `info` metrics are informational and rendered muted, so
   * the footer reads as a ranked list rather than an undifferentiated soup.
   */
  rank: 'act-now' | 'info';
}

/** Per-signal rollups, ordered worst-first; rendered only when their count > 0. */
const ROLLUPS: readonly Rollup[] = [
  { key: 'failingCi', tone: 'failure', glyph: 'failure', label: 'failing CI', rank: 'act-now' },
  {
    key: 'securityRisk',
    tone: 'failure',
    glyph: 'failure',
    label: 'security risk',
    rank: 'act-now',
  },
  {
    key: 'issuesOverThreshold',
    tone: 'warning',
    glyph: 'warning',
    label: 'over issue threshold',
    rank: 'info',
  },
  {
    key: 'reviewRequested',
    tone: 'warning',
    glyph: 'review',
    label: 'awaiting your review',
    rank: 'info',
  },
  { key: 'staleRepos', tone: 'warning', glyph: 'stale', label: 'stale', rank: 'info' },
];

/** Visual treatment for a per-repo strip cell, keyed by health (worst-first). */
interface HealthCell {
  /** Token-driven background tone for the cell. */
  tone: AccentTone;
  /** Height class — broken tallest, healthy shortest (grayscale-survivable). */
  height: string;
}

const HEALTH_CELL: Record<RepoHealth, HealthCell> = {
  broken: { tone: 'failure', height: 'h-4' },
  warning: { tone: 'warning', height: 'h-2.5' },
  healthy: { tone: 'success', height: 'h-1.5' },
};

/** Worst-first sort rank for a repo's health. */
const HEALTH_RANK: Record<RepoHealth, number> = { broken: 0, warning: 1, healthy: 2 };

/** Human-readable noun for a worst-child chip. */
const HEALTH_NOUN: Record<RepoHealth, string> = {
  broken: 'broken',
  warning: 'warning',
  healthy: 'healthy',
};

export function FleetSummaryTile({ summary, entries = [] }: FleetSummaryTileProps): ReactElement {
  const repoNoun = summary.total === 1 ? 'repo' : 'repos';
  const hasFleet = summary.total > 0;
  const segments = HEALTH_STATS.map((stat) => ({
    tone: stat.tone,
    value: summary[stat.key],
    label: stat.segmentLabel,
  }));
  const rollups = ROLLUPS.filter((rollup) => summary[rollup.key] > 0);

  // Inflame the edge to a heavy failure bar when any child is broken (R4); a
  // calm neutral rail otherwise. Thickness doubles as the inflame cue — see
  // DECISIONS ADR-021 (deliberate deviation from spec §4.2 Fleet 6px-always).
  const inflamed = summary.broken > 0;
  const edgeTone: AccentTone = inflamed ? 'failure' : 'neutral';

  // Worst-first ordering for the per-repo strip; the worst child is its head.
  const sortedEntries = [...entries].sort((a, b) => HEALTH_RANK[a.health] - HEALTH_RANK[b.health]);
  const worstChild = sortedEntries.find((entry) => entry.health !== 'healthy');

  return (
    <section
      aria-label="Fleet summary"
      className="overflow-hidden rounded-md border border-border bg-surface shadow-sm"
    >
      <div data-part="fleet-edge">
        <AccentBar tone={edgeTone} thickness={inflamed ? 'problem' : 'calm'} />
      </div>

      <div className="p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-sm font-semibold text-text">
            {summary.total} {repoNoun}
          </h3>
          {worstChild ? (
            <span data-part="worst-child">
              <Chip
                tone={HEALTH_CELL[worstChild.health].tone}
                icon={
                  <StatusGlyph
                    status={worstChild.health === 'broken' ? 'failure' : 'warning'}
                    size={14}
                    title={`Worst repo: ${worstChild.repo}`}
                  />
                }
                srLabel={`is ${HEALTH_NOUN[worstChild.health]}`}
              >
                <span className="font-medium">{worstChild.repo}</span>
              </Chip>
            </span>
          ) : null}
        </div>

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

            {sortedEntries.length > 0 ? (
              <div className="mt-3">
                <div
                  data-part="repo-strip"
                  aria-hidden="true"
                  className="flex h-4 items-end gap-0.5"
                >
                  {sortedEntries.map((entry) => (
                    <span
                      key={entry.repo}
                      data-health={entry.health}
                      title={`${entry.repo}: ${HEALTH_NOUN[entry.health]}`}
                      className={cn(
                        'w-1.5 rounded-sm',
                        HEALTH_CELL[entry.health].height,
                        toneBgClass(HEALTH_CELL[entry.health].tone),
                      )}
                    />
                  ))}
                </div>
                <ul className="sr-only">
                  {sortedEntries.map((entry) => (
                    <li key={entry.repo}>
                      {entry.repo}: {HEALTH_NOUN[entry.health]}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {rollups.length > 0 ? (
              <ul role="list" className="mt-3 flex flex-wrap items-center gap-2">
                {rollups.map((rollup) => (
                  <li
                    key={rollup.key}
                    data-rank={rollup.rank}
                    className={cn(rollup.rank === 'info' && 'opacity-75')}
                  >
                    <Chip
                      tone={rollup.tone}
                      icon={<StatusGlyph status={rollup.glyph} size={14} title={rollup.label} />}
                    >
                      <span
                        className={cn('tabular-nums', rollup.rank === 'act-now' && 'font-semibold')}
                      >
                        {summary[rollup.key]} {rollup.label}
                      </span>
                    </Chip>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        ) : null}
      </div>
    </section>
  );
}
