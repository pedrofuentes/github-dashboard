import type { ReactElement } from 'react';

import type { AccentTone } from './types';
import { toneBgClass } from './types';

export interface AccentBarProps {
  /** Status/identity accent the bar paints. */
  tone: AccentTone;
  /** Bar thickness: `sm` (≈4px, default) or `md` (≈6px). */
  thickness?: 'sm' | 'md';
}

/**
 * Top status/identity bar for a tile (DESIGN-TILES §3.2, §5). Purely decorative
 * (non-text, `aria-hidden`); the tile's status is always also encoded by an
 * icon + text elsewhere, so the bar never carries meaning on colour alone.
 */
export function AccentBar({ tone, thickness = 'sm' }: AccentBarProps): ReactElement {
  return (
    <div
      aria-hidden="true"
      data-tone={tone}
      className={`w-full rounded-t ${thickness === 'md' ? 'h-1.5' : 'h-1'} ${toneBgClass(tone)}`}
    />
  );
}
