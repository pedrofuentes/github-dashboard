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
 * Proportional width (%) for a segment, clamped to `[0, 100]`. A zero/negative
 * denominator yields `0`; a value larger than `total` (only reachable when an
 * upstream subset is mis-projected past its own total) clamps to `100` so the
 * segment fills the track instead of overflowing it.
 */
function segmentWidth(value: number, total: number): number {
  if (total <= 0) {
    return 0;
  }
  return Math.min(100, Math.max(0, (value / total) * 100));
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
            key={`${segment.tone}-${segment.label}-${index}`}
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
              width: `${segmentWidth(segment.value, total)}%`,
              ...(stepped ? { height: `${steppedHeight(index)}%` } : {}),
            }}
          />
        ))}
      </div>
      {/* The bar is decorative; this sr-only list is the source of truth, so the
          counts stay announced even when an explicit max={0} collapses every
          segment to 0%-width (a blank bar) for assistive-tech users. */}
      <ul className="sr-only">
        {visible.map((segment, index) => (
          <li key={`${segment.tone}-${segment.label}-${index}`}>
            {segment.label}: {segment.value}
          </li>
        ))}
      </ul>
    </div>
  );
}
