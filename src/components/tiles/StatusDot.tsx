import type { ReactElement } from 'react';

import type { AccentTone } from './types';
import { toneBgClass } from './types';

export interface StatusDotProps {
  /** Accent the dot paints. */
  tone: AccentTone;
}

/**
 * Small accent dot for a tile header (DESIGN-TILES §3.3, §5). Decorative
 * (`aria-hidden`) — it reinforces an adjacent status glyph/label and is never
 * the sole status indicator.
 */
export function StatusDot({ tone }: StatusDotProps): ReactElement {
  return (
    <span
      aria-hidden="true"
      data-tone={tone}
      className={`inline-block h-2 w-2 rounded-full ${toneBgClass(tone)}`}
    />
  );
}
