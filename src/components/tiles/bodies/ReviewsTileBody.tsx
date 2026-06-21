/**
 * ReviewsTileBody — the body content for the Reviews signal tile
 * (DESIGN-TILES §4.4). The shared {@link TileFrame} owns the accent bar, header
 * and footer; this component renders only the body for `data.reviews`.
 *
 * The hero is the {@link BigValue} review-request count paired with an eye
 * {@link StatusGlyph}. Urgency is *redundantly* encoded — the count and the word
 * carry it, while the accent merely mirrors the Stream Deck PR-queue thresholds
 * (blue→amber→red): `0` neutral · `1–2` info · `3–4` warning · `5+` failure. All
 * colour comes from semantic tokens, so the tile is theme-aware (no hard-coded
 * hex) and AA, and any missing/garbage field degrades to a safe neutral state
 * rather than throwing or rendering blank.
 */
import type { ReactElement } from 'react';

import type { Repo, RepoSignalData } from '../../../types/fleet';
import { BigValue } from '../BigValue';
import { Chip } from '../Chip';
import { StatusGlyph } from '../StatusGlyph';
import type { AccentTone, TileTier } from '../types';

export interface ReviewsTileBodyProps {
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

/** Review-queue urgency → accent (DESIGN-TILES §4.4). */
function urgencyTone(count: number): AccentTone {
  if (count <= 0) return 'neutral';
  if (count <= 2) return 'info';
  if (count <= 4) return 'warning';
  return 'failure';
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

export function ReviewsTileBody({ data, size }: ReviewsTileBodyProps): ReactElement {
  const reviews = data.reviews;

  if (reviews?.status === 'loading') {
    return (
      <CenteredState
        state="loading"
        tone="muted"
        glyph={<StatusGlyph status="loading" size={20} title="Loading reviews…" />}
        message="Loading…"
        srText="Loading reviews…"
      />
    );
  }

  if (reviews?.status === 'error') {
    return (
      <CenteredState
        state="error"
        tone="error"
        glyph={<StatusGlyph status="failure" size={20} title="Review queue unavailable" />}
        message="Review queue unavailable"
        srText="Review queue unavailable"
      />
    );
  }

  // `unknown`, an absent slice, or any unexpected status → safe neutral.
  if (reviews?.status !== 'ready') {
    return (
      <CenteredState
        state="unavailable"
        tone="muted"
        glyph={<StatusGlyph status="neutral" size={20} title="Review queue not loaded" />}
        message="n/a"
        srText="Review queue not loaded"
      />
    );
  }

  const count = safeCount(reviews.requestedCount);
  const tone = urgencyTone(count);
  const plural = count === 1 ? 'pull request' : 'pull requests';
  const srLabel =
    count === 0
      ? 'No pull requests awaiting your review'
      : `${count} ${plural} awaiting your review`;

  if (count === 0) {
    return (
      <div
        data-state="ready"
        data-tone={tone}
        data-tier={size}
        className="flex h-full flex-col items-center justify-center gap-1 text-center text-text-muted"
      >
        <StatusGlyph status="neutral" size={size === 'compact' ? 18 : 22} title="None awaiting" />
        <span aria-hidden="true" className="text-sm">
          None awaiting your review
        </span>
        <span className="sr-only">{srLabel}</span>
      </div>
    );
  }

  const eye = <StatusGlyph status="review" size={14} title="Awaiting your review" />;

  return (
    <div
      data-state="ready"
      data-tone={tone}
      data-tier={size}
      className="flex h-full flex-col items-center justify-center gap-1.5 text-center"
    >
      <BigValue value={count} tone={tone} size={size} />
      {size === 'compact' ? (
        <span aria-hidden="true" className="text-xs text-text-muted">
          awaiting you
        </span>
      ) : (
        <Chip tone={tone} icon={eye}>
          {count} awaiting you
        </Chip>
      )}
      {size === 'expanded' ? (
        <span data-part="detail" aria-hidden="true" className="text-xs text-text-muted">
          {count} {plural} awaiting your review
        </span>
      ) : null}
      <span className="sr-only">{srLabel}</span>
    </div>
  );
}
