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
   * Reinforce the always-on 1px inter-segment divider to 2px before every
   * segment after the first. The bar already renders a 1px `border-surface`
   * divider unconditionally (the baseline grayscale channel); this opt-in makes
   * it heavier for dense, high-stakes bars. Defaults to false.
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
 * are omitted. Every segment after the first carries a 1px `border-surface`
 * divider so adjacent fills stay separable without hue (WCAG 1.4.1, grayscale /
 * colour-blind viewing); `dividers` reinforces it to 2px and `stepped` adds a
 * descending-height channel — both opt-in on top of the always-on divider.
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
              index > 0
                ? dividers
                  ? ' border-l-2 border-surface'
                  : ' border-l border-surface'
                : ''
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
