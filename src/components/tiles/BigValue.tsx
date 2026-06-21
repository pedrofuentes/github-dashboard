import type { ReactElement, ReactNode } from 'react';

import type { AccentTone, TileTier } from './types';
import { toneTextClass } from './types';

export interface BigValueProps {
  /** The hero number or word. */
  value: ReactNode;
  /** Optional muted secondary line below the value. */
  sub?: string;
  /** Optional accent tint for the value; defaults to primary text. */
  tone?: AccentTone;
  /** Density tier that drives the value's font size. Defaults to `standard`. */
  size?: TileTier;
}

/** Size-aware hero typography (DESIGN-TILES §3.4). */
const VALUE_SIZE: Record<TileTier, string> = {
  compact: 'text-2xl',
  standard: 'text-4xl',
  expanded: 'text-6xl',
};

/**
 * Hero number/word for a tile body (DESIGN-TILES §5). The value scales with the
 * tile's density tier; an optional sub-label adds muted context. The value is
 * tinted with a tone token when given, otherwise it uses the primary text
 * token — both AA on tile surfaces (§1.5).
 */
export function BigValue({ value, sub, tone, size = 'standard' }: BigValueProps): ReactElement {
  return (
    <div className="flex flex-col">
      <span
        className={`font-semibold leading-none tabular-nums ${VALUE_SIZE[size]} ${
          tone ? toneTextClass(tone) : 'text-text'
        }`}
      >
        {value}
      </span>
      {sub ? <span className="mt-1 text-sm text-text-muted">{sub}</span> : null}
    </div>
  );
}
