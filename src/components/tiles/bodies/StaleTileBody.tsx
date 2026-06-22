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

import type { Repo, RepoSignalData, StaleItem } from '../../../types/fleet';
import { AgeBucketBar } from '../AgeBucketBar';
import type { AgeBucket } from '../AgeBucketBar';
import { BigValue } from '../BigValue';
import { StatusGlyph } from '../StatusGlyph';
import type { AccentTone, TileTier } from '../types';

export interface StaleTileBodyProps {
  /** The repository this tile represents (reserved for deep links/labels). */
  repo: Repo;
  /** The repo's resolved signal payload. */
  data: RepoSignalData;
  /** Density tier to render at (DESIGN-TILES §3.4). */
  size: TileTier;
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

/** Coerce an optional count to a safe, non-negative integer (never NaN). */
function safeCount(value: number | undefined): number {
  return Number.isFinite(value) && (value as number) > 0 ? Math.trunc(value as number) : 0;
}

/** Whole-day age of an ISO timestamp relative to `now` (0 when unparseable). */
function ageInDays(updatedAt: string, now: Date): number {
  const then = new Date(updatedAt).getTime();
  if (!Number.isFinite(then)) {
    return 0;
  }
  return Math.max(0, Math.floor((now.getTime() - then) / DAY_MS));
}

/** Age (in days) of the oldest item, or 0 when there are no items. */
function oldestAgeDays(items: StaleItem[], now: Date): number {
  return items.reduce((max, entry) => Math.max(max, ageInDays(entry.updated_at, now)), 0);
}

/** Partition items into the ascending-age buckets (each item lands in one). */
function buildBuckets(items: StaleItem[], now: Date): AgeBucket[] {
  return BUCKET_DEFS.map((def) => ({
    label: def.label,
    value: items.filter((entry) => {
      const age = ageInDays(entry.updated_at, now);
      return age > def.min && age <= def.max;
    }).length,
  }));
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

export function StaleTileBody({ data, size, now = new Date() }: StaleTileBodyProps): ReactElement {
  const stale = data.stale;

  if (stale?.status === 'loading') {
    return (
      <CenteredState
        state="loading"
        tone="muted"
        glyph={<StatusGlyph status="loading" size={20} title="Loading stale items…" />}
        message="Loading…"
        srText="Loading stale items…"
      />
    );
  }

  if (stale?.status === 'error') {
    return (
      <CenteredState
        state="error"
        tone="error"
        glyph={<StatusGlyph status="failure" size={20} title="Stale activity unavailable" />}
        message="Stale activity unavailable"
        srText="Stale activity unavailable"
      />
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
      <div
        data-state="ready"
        data-tone={tone}
        data-tier={size}
        className="flex h-full flex-col items-center justify-center gap-1 text-center text-text-muted"
      >
        <StatusGlyph status="neutral" size={size === 'compact' ? 18 : 22} title="Nothing stale" />
        <span aria-hidden="true" className="text-sm">
          Nothing stale
        </span>
        <span className="sr-only">No stale open pull requests or issues</span>
      </div>
    );
  }

  const items = stale.staleItems ?? [];
  const oldest = oldestAgeDays(items, now);
  const prCount = items.filter((entry) => entry.type === 'pr').length;
  const issueCount = items.filter((entry) => entry.type === 'issue').length;
  const buckets = buildBuckets(items, now);

  // Age is the story: the hero is the oldest age when items are known. If a
  // ready slice carries a positive count but no item details, fall back to the
  // count so the tile never renders a misleading "0d".
  const hasItems = items.length > 0;
  const heroValue = hasItems ? `${String(oldest)}d` : String(count);
  const metaText = hasItems
    ? `${String(count)} ${noun} (${String(prCount)} PR · ${String(issueCount)} issue)`
    : `${String(count)} ${noun}`;
  const srLabel = hasItems
    ? `${String(count)} stale ${noun}, oldest ${String(oldest)} days — ${String(prCount)} pull requests, ${String(issueCount)} issues`
    : `${String(count)} stale ${noun}`;
  const bucketSrLabel = `Stale items by age: ${String(count)} total`;

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
      {size !== 'compact' && hasItems ? (
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
            <span className="tabular-nums text-accent-ochre">{oldest}d</span>
          </li>
        </ul>
      ) : null}
      <span className="sr-only">{srLabel}</span>
    </div>
  );
}
