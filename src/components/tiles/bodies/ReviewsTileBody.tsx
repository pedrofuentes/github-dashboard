/**
 * ReviewsTileBody — the body content for the Reviews signal tile
 * (DESIGN-TILES §4.4). The shared {@link TileFrame} owns the accent bar, header,
 * footer, and ALL salience treatment — Reviews is an ACTIONABLE tile, so the
 * frame (not this body) paints the persistent info-blue edge tab when reviews
 * await the viewer. This component renders only the body for `data.reviews`.
 *
 * The hero is the {@link BigValue} review-request count paired with an eye
 * {@link StatusGlyph}; it carries `live` so assistive tech announces in-place
 * updates on this "needs-me" tile (redesign R6). Standard/expanded tiers add the
 * oldest-waiting age (the real urgency driver — the min of
 * `reviews.requests[].created_at` via {@link formatRelativeTime}); the compact
 * tier keeps a fixed hero anchor (count + "awaiting you" only). Urgency is
 * *redundantly* encoded — the count and the word carry it, while the accent
 * mirrors the Stream Deck PR-queue thresholds (blue→amber→red): `0` neutral ·
 * `1–2` info · `3–4` warning · `5+` failure. All colour comes from semantic
 * tokens, so the tile is theme-aware (no hard-coded hex) and AA, and any
 * missing/garbage field degrades to a safe neutral state rather than throwing
 * or rendering blank.
 */
import type { ReactElement } from 'react';

import type { Density } from '../../../lib/density-preference';
import { formatRelativeTime } from '../../../lib/format';
import type { Repo, RepoSignalData, ReviewRequestedPullRequest } from '../../../types/fleet';
import { BigValue } from '../BigValue';
import { Chip } from '../Chip';
import { StatusGlyph } from '../StatusGlyph';
import { TileMessage } from '../TileMessage';
import type { AccentTone, TileTier } from '../types';
import { CenteredState } from './CenteredState';
import { safeCount } from './safeCount';

export interface ReviewsTileBodyProps {
  /** The repository this tile represents (reserved for deep links/labels). */
  repo: Repo;
  /** The repo's resolved signal payload. */
  data: RepoSignalData;
  /** Density tier to render at (DESIGN-TILES §3.4). */
  size: TileTier;
  /**
   * Tile density (DESIGN-TILES §6; T15). In `glanceable` the standard tier drops
   * the oldest-age meta so only the hero remains; `balanced` (the default) keeps
   * it, and compact/expanded are unaffected.
   */
  density?: Density;
}

/** Review-queue urgency → accent (DESIGN-TILES §4.4). */
function urgencyTone(count: number): AccentTone {
  if (count <= 0) return 'neutral';
  if (count <= 2) return 'info';
  if (count <= 4) return 'warning';
  return 'failure';
}

/**
 * Relative age of the *oldest* awaiting review request — the real urgency
 * driver — from the min `created_at` across `reviews.requests`. Unparseable
 * timestamps are skipped; returns `null` when no usable per-request data exists
 * (the meta is then omitted rather than rendered blank).
 */
function oldestRequestAge(requests: ReviewRequestedPullRequest[] | undefined): string | null {
  if (!requests || requests.length === 0) {
    return null;
  }
  let oldestMs = Number.POSITIVE_INFINITY;
  for (const request of requests) {
    const ms = new Date(request.created_at).getTime();
    if (Number.isFinite(ms)) {
      oldestMs = Math.min(oldestMs, ms);
    }
  }
  return Number.isFinite(oldestMs) ? formatRelativeTime(new Date(oldestMs)) : null;
}

export function ReviewsTileBody({
  data,
  size,
  density = 'balanced',
}: ReviewsTileBodyProps): ReactElement {
  const reviews = data.reviews;

  if (reviews?.status === 'loading') {
    return <TileMessage kind="loading" message="Loading…" srText="Loading reviews…" />;
  }

  if (reviews?.status === 'error') {
    return <TileMessage kind="failed" message="Couldn't load" srText="Review queue unavailable" />;
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
  const oldestAge = oldestRequestAge(reviews.requests);
  const srLabel =
    count === 0
      ? 'No pull requests awaiting your review'
      : `${count} ${plural} awaiting your review${oldestAge ? `; oldest ${oldestAge}` : ''}`;

  if (count === 0) {
    return <TileMessage kind="all-clear" message="All clear" srText={srLabel} />;
  }

  const eye = <StatusGlyph status="review" size={14} title="Awaiting your review" />;
  // Glanceable standard drops the oldest-age meta; balanced and expanded keep it.
  const showStandardExtras = density === 'balanced' || size === 'expanded';

  return (
    <div
      data-state="ready"
      data-tone={tone}
      data-tier={size}
      className="flex h-full flex-col items-center justify-center gap-1.5 text-center"
    >
      <BigValue value={count} tone={tone} size={size} live />
      {size === 'compact' ? (
        <span aria-hidden="true" className="text-xs text-text-muted">
          awaiting you
        </span>
      ) : (
        <Chip tone={tone} icon={eye}>
          {count} awaiting you
        </Chip>
      )}
      {size !== 'compact' && showStandardExtras && oldestAge ? (
        <span data-part="oldest" aria-hidden="true" className="text-xs text-text-muted">
          oldest {oldestAge}
        </span>
      ) : null}
      {size === 'expanded' ? (
        <span data-part="detail" aria-hidden="true" className="text-xs text-text-muted">
          {count} {plural} awaiting your review
        </span>
      ) : null}
      <span className="sr-only">{srLabel}</span>
    </div>
  );
}
