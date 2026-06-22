import type { ReactElement } from 'react';

import type { AccentTone } from './types';
import { toneBgClass } from './types';

export interface SeveritySegment {
  /** Accent for this segment. */
  tone: AccentTone;
  /** Count this segment represents (zero-value segments are omitted). */
  value: number;
  /** Human-readable severity name (e.g. "Critical"). */
  label: string;
}

export interface SeverityBarProps {
  /** Ordered severity segments. */
  segments: SeveritySegment[];
  /** Optional denominator; defaults to the sum of visible values. */
  max?: number;
  /**
   * When true, insert a 2px divider before every segment after the first so
   * adjacent fills stay distinguishable without relying on colour (grayscale,
   * colour-blindness). Defaults to false to keep existing callers unchanged.
   */
  dividers?: boolean;
  /**
   * When true, step each visible segment's height down by render order (100%,
   * 80%, …) so the severity ordering reads as a non-colour height channel.
   * Defaults to false (every segment fills the full bar height).
   */
  stepped?: boolean;
}

/** Height (%) for the segment at `index` when {@link SeverityBarProps.stepped}. */
function steppedHeight(index: number): number {
  return Math.max(40, 100 - index * 20);
}

/**
 * Segmented horizontal bar (DESIGN-TILES §5) for security severities / fleet
 * health splits. Each non-zero segment is sized proportionally and carries a
 * `<title>`; the accessible breakdown is a screen-reader list (the coloured bar
 * is decorative), so meaning never rests on colour alone. Zero-value segments
 * are omitted. When `dividers`/`stepped` are set the bar additionally encodes
 * segment order via 2px dividers and descending heights, so it survives
 * grayscale and colour-blind viewing without a fake threshold tick.
 */
export function SeverityBar({ segments, max, dividers, stepped }: SeverityBarProps): ReactElement {
  const visible = segments.filter((segment) => segment.value > 0);
  const total = max ?? visible.reduce((sum, segment) => sum + segment.value, 0);

  return (
    <div className="w-full">
      <div
        aria-hidden="true"
        className={`flex w-full overflow-hidden rounded-full bg-surface-raised ${
          stepped ? 'h-4 items-end' : 'h-2'
        }`}
      >
        {visible.map((segment, index) => (
          <div
            key={segment.label}
            data-tone={segment.tone}
            title={`${segment.label}: ${segment.value}`}
            className={`${toneBgClass(segment.tone)}${
              dividers && index > 0 ? ' border-l-2 border-surface' : ''
            }`}
            style={{
              width: total > 0 ? `${(segment.value / total) * 100}%` : '0%',
              ...(stepped ? { height: `${steppedHeight(index)}%` } : {}),
            }}
          />
        ))}
      </div>
      <ul className="sr-only">
        {visible.map((segment) => (
          <li key={segment.label}>
            {segment.label}: {segment.value}
          </li>
        ))}
      </ul>
    </div>
  );
}
