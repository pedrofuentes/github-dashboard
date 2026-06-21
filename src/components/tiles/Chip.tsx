import type { ReactElement, ReactNode } from 'react';

import type { AccentTone } from './types';
import { toneTextClass, toneToVar } from './types';

export interface ChipProps {
  /** Accent that tints the chip. */
  tone: AccentTone;
  /** Optional leading icon (decorative — hidden from assistive tech). */
  icon?: ReactNode;
  /** Visible chip text. */
  children: ReactNode;
  /** Optional hover/tooltip context. */
  title?: string;
  /** Optional screen-reader-only expansion of an abbreviated label. */
  srLabel?: string;
}

/**
 * Tinted pill (DESIGN-TILES §5). Uses the AA-safe tint pattern in both themes
 * (§1.5): accent-coloured text/icon over a low-opacity accent tint of the
 * surface — `color-mix` keeps the tint tied to the same theme variable, so it
 * flips with `.dark`. State is carried by icon + text, never colour alone.
 */
export function Chip({ tone, icon, children, title, srLabel }: ChipProps): ReactElement {
  return (
    <span
      data-tone={tone}
      title={title}
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${toneTextClass(
        tone,
      )}`}
      style={{ backgroundColor: `color-mix(in srgb, ${toneToVar(tone)} 14%, transparent)` }}
    >
      {icon ? (
        <span aria-hidden="true" className="inline-flex">
          {icon}
        </span>
      ) : null}
      <span>{children}</span>
      {srLabel ? <span className="sr-only">{srLabel}</span> : null}
    </span>
  );
}
