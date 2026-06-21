/**
 * StaleTileBody — the body content for the Stale signal tile
 * (DESIGN-TILES §4.6). The shared {@link TileFrame} owns the accent bar, header
 * and footer; this component renders only the body for `data.stale`.
 *
 * The hero is the {@link BigValue} stale-item count beside a clock
 * {@link StatusGlyph}, with the staleness duration spelled out ("no activity in
 * {@link STALE_THRESHOLD_DAYS} days"). Any stale item escalates the accent to
 * warning, but the clock icon, the count, and the word "stale" carry the meaning
 * redundantly — never colour alone. The threshold is imported from the stale
 * signal hook so the copy never drifts from the query. All colour comes from
 * semantic tokens (no hard-coded hex, AA), and any missing/garbage field
 * degrades to a safe neutral state rather than throwing or rendering blank.
 */
import type { ReactElement } from 'react';

import { STALE_THRESHOLD_DAYS } from '../../../hooks/signals/useStaleSignal';
import type { Repo, RepoSignalData } from '../../../types/fleet';
import { BigValue } from '../BigValue';
import { Chip } from '../Chip';
import { StatusGlyph } from '../StatusGlyph';
import type { AccentTone, TileTier } from '../types';

export interface StaleTileBodyProps {
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

export function StaleTileBody({ data, size }: StaleTileBodyProps): ReactElement {
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
  const tone: AccentTone = count > 0 ? 'warning' : 'neutral';
  const noun = count === 1 ? 'item' : 'items';
  const durationText = `no activity in ${STALE_THRESHOLD_DAYS} days`;
  const srLabel =
    count === 0
      ? 'No stale open pull requests or issues'
      : `${count} open ${noun} with ${durationText}`;

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
        <span className="sr-only">{srLabel}</span>
      </div>
    );
  }

  const clock = <StatusGlyph status="stale" size={14} title="Stale" />;

  return (
    <div
      data-state="ready"
      data-tone={tone}
      data-tier={size}
      className="flex h-full flex-col items-center justify-center gap-1.5 text-center"
    >
      <div className="flex items-center gap-2">
        <StatusGlyph status="stale" size={size === 'compact' ? 18 : 22} title="Stale" />
        <BigValue value={count} tone={tone} size={size} />
      </div>
      {size === 'compact' ? (
        <span aria-hidden="true" className="text-xs text-text-muted">
          stale
        </span>
      ) : (
        <Chip tone={tone} icon={clock}>
          {count} stale
        </Chip>
      )}
      {size === 'expanded' ? (
        <span data-part="detail" aria-hidden="true" className="text-xs text-text-muted">
          {count} open {noun} with {durationText}
        </span>
      ) : null}
      <span className="sr-only">{srLabel}</span>
    </div>
  );
}
