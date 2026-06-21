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
}

/**
 * Segmented horizontal bar (DESIGN-TILES §5) for security severities / fleet
 * health splits. Each non-zero segment is sized proportionally and carries a
 * `<title>`; the accessible breakdown is a screen-reader list (the coloured bar
 * is decorative), so meaning never rests on colour alone. Zero-value segments
 * are omitted.
 */
export function SeverityBar({ segments, max }: SeverityBarProps): ReactElement {
  const visible = segments.filter((segment) => segment.value > 0);
  const total = max ?? visible.reduce((sum, segment) => sum + segment.value, 0);

  return (
    <div className="w-full">
      <div
        aria-hidden="true"
        className="flex h-2 w-full overflow-hidden rounded-full bg-surface-raised"
      >
        {visible.map((segment) => (
          <div
            key={segment.label}
            data-tone={segment.tone}
            title={`${segment.label}: ${segment.value}`}
            className={toneBgClass(segment.tone)}
            style={{ width: total > 0 ? `${(segment.value / total) * 100}%` : '0%' }}
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
