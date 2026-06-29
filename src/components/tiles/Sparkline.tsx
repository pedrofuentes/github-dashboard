/**
 * Sparkline — a small, theme-aware area sparkline for weekly commit activity.
 *
 * Renders a polyline area chart of `data` (per-week totals, most recent last)
 * scaled to fit `width`×`height`, with a solid endpoint dot at the latest value.
 * The ink (stroke + dot) and the low-opacity area fill both resolve to the
 * `tone` accent **CSS variable** (`var(--color-<tone>)`), so a single `.dark`
 * theme flip recolours the visual — there are no hard-coded hex colours here.
 *
 * Accessibility: the chart is decorative-with-text-alternative. The SVG carries
 * `role="img"` + `aria-label`, and the consumer-supplied `srLabel` summary is
 * also rendered as sr-only text, so the information is never colour-only
 * (redundant encoding, WCAG 2.1 AA). The render is fully static (no animation),
 * so `prefers-reduced-motion` needs no special handling.
 *
 * Degenerate inputs render gracefully and never emit `NaN`/`Infinity` geometry:
 * empty `data` draws no path (label only), an all-zero series draws a flat line
 * (max is clamped so there is no division by zero), and a single point is
 * centred horizontally with its height still encoding the value — so a non-zero
 * point sits at the top of the plot and a zero point on the baseline, not at the
 * viewport centre. Non-finite (`NaN`/`Infinity`) or negative values are treated
 * as `0`, so a single out-of-contract point can neither corrupt the `max` scale
 * nor push geometry out of bounds.
 */
import type { ReactElement } from 'react';

import type { AccentTone } from './types';
import { toneToVar } from './types';

export interface SparklineProps {
  /** Per-week commit totals, most recent last. Values are expected to be ≥ 0. */
  data: number[];
  /** Accent tone for the ink + area fill. Defaults to `success`. */
  tone?: AccentTone;
  /**
   * Consumer-supplied screen-reader summary, e.g.
   * "12 commits over 8 weeks, trend up". Rendered as both the SVG `aria-label`
   * and visually-hidden text so the chart is never colour-only.
   */
  srLabel: string;
  /** Viewport width in px. Defaults to 96. */
  width?: number;
  /** Viewport height in px. Defaults to 24. */
  height?: number;
}

/** Inner padding (px) so the stroke and endpoint dot never clip the viewport. */
const PADDING = 3;
/** Endpoint dot radius (px). */
const DOT_RADIUS = 2;
/** Opacity of the area fill. */
const AREA_FILL_OPACITY = 0.18;

/** Rounds to 2dp and normalises `-0` to `0` for stable, finite path output. */
function round(n: number): number {
  return Math.round(n * 100) / 100 || 0;
}

interface Point {
  x: number;
  y: number;
}

/**
 * Coerce a series value to a finite, non-negative number. Non-finite
 * (`NaN` / `Infinity`) and negative values become `0` so a single
 * out-of-contract point can neither corrupt the `max` scale nor emit
 * out-of-bounds geometry (defense-in-depth; the slice is Zod-validated).
 */
function toValue(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/** Computes the plotted points for `data` within the padded viewport. */
function computePoints(data: number[], width: number, height: number): Point[] {
  const n = data.length;
  if (n === 0) return [];

  const innerW = Math.max(0, width - PADDING * 2);
  const innerH = Math.max(0, height - PADDING * 2);
  const baseY = PADDING + innerH;
  // Clamp the denominator so an all-zero (or non-finite) series cannot divide
  // by zero — it renders as a flat baseline rather than producing NaN.
  const max = Math.max(0, ...data.map(toValue)) || 1;

  return data.map((value, i) => {
    const ratio = n === 1 ? 0.5 : i / (n - 1);
    const x = PADDING + ratio * innerW;
    const normalised = toValue(value) / max;
    const y = baseY - normalised * innerH;
    return { x: round(x), y: round(y) };
  });
}

/** Builds the open stroke path (`M … L …`) through the points. */
function linePath(points: Point[]): string {
  if (points.length === 0) return '';
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`).join(' ');
}

/** Builds the closed area path by dropping to the baseline and back. */
function areaPath(points: Point[], height: number): string {
  if (points.length === 0) return '';
  const baseY = round(height - PADDING);
  const first = points[0];
  const last = points[points.length - 1];
  return `${linePath(points)} L${last.x} ${baseY} L${first.x} ${baseY} Z`;
}

export function Sparkline({
  data,
  tone = 'success',
  srLabel,
  width = 96,
  height = 24,
}: SparklineProps): ReactElement {
  const color = toneToVar(tone);
  const points = computePoints(data, width, height);
  const last = points[points.length - 1];

  return (
    <span className="inline-flex items-center">
      <svg
        role="img"
        aria-label={srLabel}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="overflow-visible"
      >
        {points.length > 0 && (
          <>
            <path
              data-part="area"
              d={areaPath(points, height)}
              fill={color}
              fillOpacity={AREA_FILL_OPACITY}
              stroke="none"
            />
            <path
              data-part="line"
              d={linePath(points)}
              fill="none"
              stroke={color}
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {last && (
              <circle
                data-part="dot"
                cx={last.x}
                cy={last.y}
                r={DOT_RADIUS}
                fill={color}
                stroke="none"
              />
            )}
          </>
        )}
      </svg>
      <span className="sr-only">{srLabel}</span>
    </span>
  );
}
