/**
 * StaleTileBody — the body content for the Stale signal tile (DESIGN-TILES §4.6;
 * redesign T12). The shared {@link TileFrame} owns the (calm, neutral) accent
 * edge and the ochre header identity; this component renders only the body for
 * `data.stale` and paints NO edge/glow.
 *
 * The body is **age-led**: staleness urgency is driven by HOW OLD the oldest
 * item is, not how many there are. The hero is the oldest item's age (e.g.
 * "34d"); the count and PR/issue split are demoted to a secondary meta line, and
 * an {@link AgeBucketBar} shows the age distribution (`>14d` / `>30d` / `>60d`).
 * The bucket bar survives grayscale via height-stepping + order + a
 * screen-reader list — never colour alone. A redundant sr-only sentence repeats
 * the count and oldest age. This is a CALM tile, so the hero is not announced
 * with `aria-live` (redesign R6). All colour comes from the semantic `ochre`
 * token (no hard-coded hex, AA in both themes), and any missing/garbage field
 * degrades to a safe, labelled state rather than throwing or rendering blank.
 */
import type { ReactElement } from 'react';

import type { Density } from '../../../lib/density-preference';
import type { Repo, RepoSignalData, StaleItem } from '../../../types/fleet';
import { AgeBucketBar } from '../AgeBucketBar';
import type { AgeBucket } from '../AgeBucketBar';
import { BigValue } from '../BigValue';
import { StatusGlyph } from '../StatusGlyph';
import { TileMessage } from '../TileMessage';
import type { AccentTone, TileTier } from '../types';
import { CenteredState } from './CenteredState';
import { safeCount } from './safeCount';

export interface StaleTileBodyProps {
  /** The repository this tile represents (optional; reserved for deep links/labels). */
  repo?: Repo;
  /** The repo's resolved signal payload. */
  data: RepoSignalData;
  /** Density tier to render at (DESIGN-TILES §3.4). */
  size: TileTier;
  /**
   * Tile density (DESIGN-TILES §6; T15). In `glanceable` the standard tier drops
   * the age-bucket bar so only the hero remains; `balanced` (the default) keeps
   * it, and compact/expanded are unaffected.
   */
  density?: Density;
  /** Injectable "current time" for deterministic age maths; defaults to now. */
  now?: Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Age-bucket partition (ascending age); older buckets render taller in the bar. */
const BUCKET_DEFS: readonly { label: string; min: number; max: number }[] = [
  { label: '>14d', min: 14, max: 30 },
  { label: '>30d', min: 30, max: 60 },
  { label: '>60d', min: 60, max: Number.POSITIVE_INFINITY },
];

/**
 * Whole-day age of an ISO timestamp relative to `now`, or `null` when the
 * timestamp is missing/unparseable. Returning `null` (rather than 0) keeps an
 * undatable item from masquerading as a fresh "0d" one (#283).
 */
function ageInDays(updatedAt: string, now: Date): number | null {
  const then = new Date(updatedAt).getTime();
  if (!Number.isFinite(then)) {
    return null;
  }
  return Math.max(0, Math.floor((now.getTime() - then) / DAY_MS));
}

/**
 * Age (in days) of the oldest item whose date is parseable, or `null` when no
 * item carries a usable timestamp — so the hero can show an explicit unknown
 * state instead of a misleading "0d".
 */
function oldestAgeDays(items: StaleItem[], now: Date): number | null {
  return items.reduce<number | null>((oldest, entry) => {
    const age = ageInDays(entry.updated_at, now);
    if (age === null) {
      return oldest;
    }
    return oldest === null ? age : Math.max(oldest, age);
  }, null);
}

/** Partition items into the ascending-age buckets (undatable items land in none). */
function buildBuckets(items: StaleItem[], now: Date): AgeBucket[] {
  return BUCKET_DEFS.map((def) => ({
    label: def.label,
    value: items.filter((entry) => {
      const age = ageInDays(entry.updated_at, now);
      return age !== null && age > def.min && age <= def.max;
    }).length,
  }));
}

export function StaleTileBody({
  data,
  size,
  now = new Date(),
  density = 'balanced',
}: StaleTileBodyProps): ReactElement {
  const stale = data.stale;

  if (stale?.status === 'loading') {
    return <TileMessage kind="loading" message="Loading…" srText="Loading stale items…" />;
  }

  if (stale?.status === 'error') {
    return (
      <TileMessage kind="failed" message="Couldn't load" srText="Stale activity unavailable" />
    );
  }

  // `unknown`, an absent slice, or any unexpected status → safe neutral.
  if (stale?.status !== 'ready') {
    return (
      <CenteredState
        state="unavailable"
        tone="muted"
        glyph={<StatusGlyph status="neutral" size={20} title="Stale activity not loaded" />}
        message="n/a"
        srText="Stale activity not loaded"
      />
    );
  }

  const count = safeCount(stale.staleCount);
  const tone: AccentTone = count > 0 ? 'ochre' : 'neutral';
  const noun = count === 1 ? 'item' : 'items';

  if (count === 0) {
    return (
      <TileMessage
        kind="all-clear"
        message="All clear"
        srText="No stale open pull requests or issues"
      />
    );
  }

  const items = stale.staleItems ?? [];
  const oldest = oldestAgeDays(items, now);
  const prCount = items.filter((entry) => entry.type === 'pr').length;
  const issueCount = items.filter((entry) => entry.type === 'issue').length;
  const buckets = buildBuckets(items, now);

  // Age is the story: the hero is the oldest age when items are known. If a
  // ready slice carries a positive count but no item details, fall back to the
  // count so the tile never renders a misleading "0d". When items exist but none
  // carries a parseable date, surface an explicit unknown marker instead of a
  // deceptively-fresh "0d" (#283).
  const hasItems = items.length > 0;
  const hasKnownAge = oldest !== null;
  const oldestLabel = hasKnownAge ? `${String(oldest)}d` : '—';

  const heroValue = hasItems ? oldestLabel : String(count);
  const metaText = hasItems
    ? `${String(count)} ${noun} (${String(prCount)} PR · ${String(issueCount)} issue)`
    : `${String(count)} ${noun}`;
  const oldestSrPhrase = hasKnownAge ? `oldest ${String(oldest)} days` : 'oldest age unknown';
  const srLabel = hasItems
    ? `${String(count)} stale ${noun}, ${oldestSrPhrase} — ${String(prCount)} pull requests, ${String(issueCount)} issues`
    : `${String(count)} stale ${noun}`;
  const bucketSrLabel = `Stale items by age: ${String(count)} total`;
  // Glanceable standard drops the age-bucket bar; balanced and expanded keep it.
  const showStandardExtras = density === 'balanced' || size === 'expanded';

  return (
    <div
      data-state="ready"
      data-tone={tone}
      data-tier={size}
      className="flex h-full flex-col items-center justify-center gap-1.5 text-center"
    >
      <div className="flex items-center gap-2">
        <StatusGlyph status="stale" size={size === 'compact' ? 18 : 22} title="Stale" />
        <BigValue value={heroValue} tone={tone} size={size} />
      </div>
      <span data-part="meta" aria-hidden="true" className="text-xs text-text-muted">
        {metaText}
      </span>
      {size !== 'compact' && hasItems && showStandardExtras ? (
        <div data-part="age-bucket-bar" className="w-full max-w-[16rem]">
          <AgeBucketBar buckets={buckets} srLabel={bucketSrLabel} />
        </div>
      ) : null}
      {size === 'expanded' && hasItems ? (
        <ul
          data-part="breakdown"
          aria-hidden="true"
          className="flex w-full max-w-[16rem] flex-col gap-0.5 text-xs"
        >
          <li className="flex items-center justify-between">
            <span className="text-text-muted">Pull requests</span>
            <span className="tabular-nums text-text-muted">{prCount}</span>
          </li>
          <li className="flex items-center justify-between">
            <span className="text-text-muted">Issues</span>
            <span className="tabular-nums text-text-muted">{issueCount}</span>
          </li>
          <li className="flex items-center justify-between">
            <span className="text-accent-ochre">Oldest</span>
            <span className="tabular-nums text-accent-ochre">{oldestLabel}</span>
          </li>
        </ul>
      ) : null}
      <span className="sr-only">{srLabel}</span>
    </div>
  );
}
