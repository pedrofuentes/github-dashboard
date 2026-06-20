/**
 * FleetSummaryTile — the pinned, glanceable anchor at the top of the at-a-glance
 * Dashboard view (M10 T5).
 *
 * Unlike the per-(repo, signal) {@link SignalTile}s, this card is **not** part of
 * the react-grid-layout grid: it can't be dragged, resized, hidden or removed.
 * It rolls the whole fleet up into a single line — total repos and the
 * broken / warning / healthy split — plus the non-zero per-signal rollups. Every
 * figure is conveyed by an icon **and** text (never colour alone), keeping the
 * card WCAG 2.1 AA / colour-blind safe.
 */
import type { ReactElement } from 'react';

import { cn } from '../lib/cn';
import type { FleetHealthSummary } from '../lib/fleet-summary';

export interface FleetSummaryTileProps {
  /** The aggregated fleet health to display. */
  summary: FleetHealthSummary;
}

interface HealthStat {
  key: 'broken' | 'warning' | 'healthy';
  /** Decorative glyph, paired with the text label (never the sole signal). */
  icon: string;
  /** Visible label following the count, e.g. "need attention". */
  label: string;
  /** Colour enhancement layered on top of the icon + text. */
  className: string;
}

const HEALTH_STATS: readonly HealthStat[] = [
  { key: 'broken', icon: '✗', label: 'need attention', className: 'text-red-700' },
  { key: 'warning', icon: '!', label: 'warning', className: 'text-amber-700' },
  { key: 'healthy', icon: '✓', label: 'healthy', className: 'text-emerald-700' },
];

/** Builds the compact list of non-zero per-signal rollups shown below the split. */
function rollups(summary: FleetHealthSummary): string[] {
  const parts: string[] = [];
  if (summary.failingCi > 0) {
    parts.push(`${summary.failingCi} failing CI`);
  }
  if (summary.securityRisk > 0) {
    parts.push(`${summary.securityRisk} security risk`);
  }
  if (summary.issuesOverThreshold > 0) {
    parts.push(`${summary.issuesOverThreshold} over issue threshold`);
  }
  if (summary.reviewRequested > 0) {
    parts.push(`${summary.reviewRequested} awaiting your review`);
  }
  if (summary.staleRepos > 0) {
    parts.push(`${summary.staleRepos} stale`);
  }
  return parts;
}

export function FleetSummaryTile({ summary }: FleetSummaryTileProps): ReactElement {
  const repoNoun = summary.total === 1 ? 'repo' : 'repos';
  const signalRollups = rollups(summary);

  return (
    <section
      aria-label="Fleet summary"
      className="rounded-md border border-slate-200 bg-white p-4 shadow-sm"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h3 className="text-sm font-semibold text-slate-900">
          {summary.total} {repoNoun}
        </h3>
        <ul role="list" className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          {HEALTH_STATS.map((stat) => (
            <li
              key={stat.key}
              className={cn('inline-flex items-center gap-1 font-medium', stat.className)}
            >
              <span aria-hidden="true">{stat.icon}</span>
              <span className="tabular-nums">
                {summary[stat.key]} {stat.label}
              </span>
            </li>
          ))}
        </ul>
      </div>
      {signalRollups.length > 0 ? (
        <p className="mt-2 text-xs text-slate-600">{signalRollups.join(' · ')}</p>
      ) : null}
    </section>
  );
}
