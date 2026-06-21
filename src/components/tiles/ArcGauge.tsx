/**
 * ArcGauge — a small, theme-aware semicircular gauge (DESIGN-TILES §5).
 *
 * Fills `value / max` of a 180° arc in the `tone` accent colour over a muted
 * track, with the consumer-supplied `center` node (the security letter grade)
 * floating in the middle. The ink resolves to a `--color-<tone>` theme variable
 * (via {@link toneToVar}) so a single `.dark` flip recolours it — there are no
 * hard-coded hex colours here.
 *
 * Accessibility: the SVG carries `role="img"` + `aria-label`, and `srLabel` is
 * also rendered as visually-hidden text, so the gauge is never colour-only
 * (redundant encoding, WCAG 2.1 AA). The render is fully static (no animation),
 * so `prefers-reduced-motion` needs no special handling.
 *
 * Degenerate inputs render gracefully and never emit `NaN`/`Infinity` geometry:
 * `max <= 0` clamps the fill fraction to 0, `value > max` clamps to a full arc,
 * and negative values clamp to 0.
 */
import type { ReactElement, ReactNode } from 'react';

import type { AccentTone } from './types';
import { toneToVar } from './types';

export interface ArcGaugeProps {
  /** Current value the arc fills toward `max`. */
  value: number;
  /** Denominator for the fill fraction. Defaults to 100. */
  max?: number;
  /** Accent tone for the filled arc. */
  tone: AccentTone;
  /** Centered hero node (e.g. the letter grade). */
  center: ReactNode;
  /** Screen-reader summary; rendered as `aria-label` and sr-only text. */
  srLabel: string;
}

const WIDTH = 120;
const STROKE = 12;
const RADIUS = (WIDTH - STROKE) / 2;
const PADDING = STROKE / 2;
const CX = WIDTH / 2;
const CY = RADIUS + PADDING;
const HEIGHT = RADIUS + STROKE;

/** Rounds to 2dp and normalises `-0` to `0` for stable, finite path output. */
function round(n: number): number {
  return Math.round(n * 100) / 100 || 0;
}

/**
 * Point on the top semicircle for fraction `t` in `[0, 1]`: `t = 0` is the left
 * end, `t = 1` the right end, sweeping over the top.
 */
function pointAt(t: number): { x: number; y: number } {
  const angle = Math.PI * (1 - t);
  return { x: round(CX + RADIUS * Math.cos(angle)), y: round(CY - RADIUS * Math.sin(angle)) };
}

/** Builds the arc path from the left end to fraction `t` over the top. */
function arcPath(t: number): string {
  const start = pointAt(0);
  const end = pointAt(t);
  return `M${start.x} ${start.y} A${RADIUS} ${RADIUS} 0 0 1 ${end.x} ${end.y}`;
}

export function ArcGauge({ value, max = 100, tone, center, srLabel }: ArcGaugeProps): ReactElement {
  const fraction = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  const color = toneToVar(tone);

  return (
    <span className="relative inline-flex" data-part="arc-gauge">
      <svg
        role="img"
        aria-label={srLabel}
        width={WIDTH}
        height={HEIGHT}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        fill="none"
      >
        <path
          data-part="track"
          d={arcPath(1)}
          stroke="var(--color-border)"
          strokeWidth={STROKE}
          strokeLinecap="round"
        />
        {fraction > 0 && (
          <path
            data-part="fill"
            d={arcPath(fraction)}
            stroke={color}
            strokeWidth={STROKE}
            strokeLinecap="round"
          />
        )}
      </svg>
      <span
        aria-hidden="true"
        className="absolute inset-x-0 bottom-0 flex items-end justify-center"
      >
        {center}
      </span>
      <span className="sr-only">{srLabel}</span>
    </span>
  );
}
