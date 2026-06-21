import type { ReactElement } from 'react';

import type { AccentTone } from './types';
import { toneToVar } from './types';

export interface AmbientGlowProps {
  /** Status accent the glow tints the tile body with. */
  tone: AccentTone;
  /** Tint opacity (0–1). Defaults to 0.06 (DESIGN-TILES §2.2). */
  opacity?: number;
}

/**
 * Static low-opacity status tint behind a tile body (DESIGN-TILES §2.2, §5).
 * Decorative (`aria-hidden`, `pointer-events-none`) and intentionally static —
 * never a pulsing "breathe". The parent must be positioned for the absolute
 * fill to cover it. If a pulse is ever added it must be gated behind
 * `motion-safe:` so reduced-motion users keep the flat tint.
 */
export function AmbientGlow({ tone, opacity = 0.06 }: AmbientGlowProps): ReactElement {
  return (
    <div
      aria-hidden="true"
      data-tone={tone}
      className="pointer-events-none absolute inset-0"
      style={{ backgroundColor: toneToVar(tone), opacity }}
    />
  );
}
