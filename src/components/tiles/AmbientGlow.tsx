import type { ReactElement } from 'react';

import type { AccentTone } from './types';
import { toneToVar } from './types';

export interface AmbientGlowProps {
  /** Status accent the glow tints the tile body with. */
  tone: AccentTone;
  /** Tint opacity (0–1). Defaults to 0.06 (DESIGN-TILES §2.2). */
  opacity?: number;
}

/** Default tint opacity (DESIGN-TILES §2.2) — a subtle, never-opaque wash. */
const DEFAULT_OPACITY = 0.06;

/**
 * Clamp an opacity to the valid `[0, 1]` range, substituting the subtle default
 * for any non-finite (`NaN` / `Infinity`) value. Without this an out-of-contract
 * opacity reaches the DOM unguarded — a `NaN` is dropped as invalid and the tint
 * renders **fully opaque**, swamping the tile body instead of washing it. Kept
 * local (not exported) per the primitive convention; the resolved value is
 * surfaced on the element as `data-opacity` for tests.
 */
function clampOpacity(opacity: number): number {
  if (!Number.isFinite(opacity)) {
    return DEFAULT_OPACITY;
  }
  return Math.min(1, Math.max(0, opacity));
}

/**
 * Static low-opacity status tint behind a tile body (DESIGN-TILES §2.2, §5).
 * Decorative (`aria-hidden`, `pointer-events-none`) and intentionally static —
 * never a pulsing "breathe". The parent must be positioned for the absolute
 * fill to cover it. If a pulse is ever added it must be gated behind
 * `motion-safe:` so reduced-motion users keep the flat tint.
 */
export function AmbientGlow({ tone, opacity = DEFAULT_OPACITY }: AmbientGlowProps): ReactElement {
  const resolved = clampOpacity(opacity);
  return (
    <div
      aria-hidden="true"
      data-tone={tone}
      data-opacity={resolved}
      className="pointer-events-none absolute inset-0"
      style={{ backgroundColor: toneToVar(tone), opacity: resolved }}
    />
  );
}
