import type { ReactElement } from 'react';

import type { AccentTone } from './types';
import { toneBgClass } from './types';

/**
 * Salience-weighted thickness of the accent bar. `calm` (default) paints the
 * thin 5px bar; `problem` paints the heavier 6px bar.
 */
export type AccentBarThickness = 'calm' | 'problem';

export interface AccentBarProps {
  /** Status/identity accent the bar paints. */
  tone: AccentTone;
  /** Bar thickness: `calm` (5px, default) or `problem` (6px). */
  thickness?: AccentBarThickness;
}

const THICKNESS_HEIGHT: Record<AccentBarThickness, string> = {
  calm: 'h-[5px]',
  problem: 'h-[6px]',
};

/**
 * Top status/identity bar for a tile (DESIGN-TILES §3.2, §5). Purely decorative
 * (non-text, `aria-hidden`); the tile's status is always also encoded by an
 * icon + text elsewhere, so the bar never carries meaning on colour alone.
 */
export function AccentBar({ tone, thickness = 'calm' }: AccentBarProps): ReactElement {
  return (
    <div
      aria-hidden="true"
      data-tone={tone}
      className={`w-full rounded-t ${THICKNESS_HEIGHT[thickness]} ${toneBgClass(tone)}`}
    />
  );
}
