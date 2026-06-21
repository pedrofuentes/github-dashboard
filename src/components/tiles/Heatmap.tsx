/**
 * `Heatmap` — an accessible, theme-aware SVG commit-activity grid
 * (DESIGN-TILES §4.7 / §5).
 *
 * The grid is laid out as weeks (columns) × 7 days (rows, Sunday..Saturday),
 * mirroring the GitHub contribution graph. Each cell's intensity encodes
 * `count / max` as a shade of the `tone` accent (default `success`), where
 * `max` defaults to the data maximum. Crucially the encoding is **not**
 * color-only: every cell carries a `<title>` ("{count} commits", or a custom
 * `cellTitle`) for a tooltip, and an `sr-only` table of weekly totals provides
 * the full data to assistive technology without relying on hue.
 *
 * The SVG references theme CSS variables (`var(--color-*)`) for every fill, so a
 * single `.dark` flip on the document recolors it. The visual is static (no
 * animation), so it already honors `prefers-reduced-motion`.
 *
 * Robustness: ragged weeks (fewer than 7 days), an empty `weeks` array,
 * all-zero data, and `max === 0` are all handled without emitting `NaN` /
 * `Infinity` geometry or dividing by zero.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */

/**
 * Semantic accent tones, each resolving to a `--color-<tone>` CSS variable
 * defined in `src/index.css`. Defined locally so this primitive stays
 * self-contained (the sibling tiles share no barrel yet).
 */
export type AccentTone =
  | 'success'
  | 'failure'
  | 'warning'
  | 'info'
  | 'neutral'
  | 'coral'
  | 'purple'
  | 'gold';

export interface HeatmapProps {
  /** Commit counts as weeks × days (Sunday..Saturday). Ragged rows are padded. */
  weeks: number[][];
  /** Accent tone for non-empty cells. Defaults to `success` (activity ink). */
  tone?: AccentTone;
  /** Intensity denominator. Defaults to the data maximum; guarded against 0. */
  max?: number;
  /** Accessible summary describing the whole heatmap (the `role="img"` name). */
  srLabel: string;
  /** Custom per-cell tooltip. Defaults to "{count} commits". */
  cellTitle?: (weekIndex: number, dayIndex: number, count: number) => string;
}

/** Days in a week — the grid always renders a full 7-row column. */
const DAYS_PER_WEEK = 7;
/** Cell edge length in user-space units. */
const CELL = 12;
/** Gap between cells in user-space units. */
const GAP = 3;
/** Corner radius for each cell. */
const RADIUS = 2;
/**
 * Lowest fill-opacity for a non-zero cell, so a single commit is still visible
 * and clearly distinct from an empty cell (which uses a different fill).
 */
const MIN_INTENSITY = 0.18;

/** Coerce any value (including `undefined` from ragged rows) to a finite count. */
function toCount(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

/** Sum the provided days of a (possibly ragged) week. */
function weekTotal(week: number[]): number {
  return week.reduce((sum, day) => sum + toCount(day), 0);
}

export function Heatmap({
  weeks,
  tone = 'success',
  max,
  srLabel,
  cellTitle,
}: HeatmapProps): JSX.Element {
  const dataMax = weeks.reduce(
    (peak, week) => week.reduce((rowPeak, day) => Math.max(rowPeak, toCount(day)), peak),
    0,
  );
  // `max` may be explicitly 0 (or the data may be all-zero); guard the divide.
  const effectiveMax = max !== undefined ? max : dataMax;
  const denominator = effectiveMax > 0 ? effectiveMax : 0;

  const toneVar = `var(--color-${tone})`;
  const emptyFill = 'var(--color-surface-raised)';

  const width = Math.max(weeks.length * (CELL + GAP) - GAP, 1);
  const height = DAYS_PER_WEEK * (CELL + GAP) - GAP;

  return (
    <div className="inline-block">
      <svg
        role="img"
        aria-label={srLabel}
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        preserveAspectRatio="xMinYMin meet"
      >
        {weeks.map((week, weekIndex) =>
          Array.from({ length: DAYS_PER_WEEK }, (_, dayIndex) => {
            const count = toCount(week[dayIndex]);
            const ratio = denominator > 0 ? count / denominator : 0;
            const isEmpty = count === 0;
            const intensity = isEmpty
              ? 1
              : MIN_INTENSITY + (1 - MIN_INTENSITY) * Math.min(Math.max(ratio, 0), 1);
            const title = cellTitle ? cellTitle(weekIndex, dayIndex, count) : `${count} commits`;

            return (
              <rect
                key={`${weekIndex}-${dayIndex}`}
                data-heatmap-cell=""
                data-count={count}
                data-week={weekIndex}
                data-day={dayIndex}
                x={weekIndex * (CELL + GAP)}
                y={dayIndex * (CELL + GAP)}
                width={CELL}
                height={CELL}
                rx={RADIUS}
                ry={RADIUS}
                fill={isEmpty ? emptyFill : toneVar}
                fillOpacity={intensity}
                stroke="var(--color-border)"
                strokeWidth={1}
              >
                <title>{title}</title>
              </rect>
            );
          }),
        )}
      </svg>
      <table className="sr-only">
        <caption>{srLabel}</caption>
        <thead>
          <tr>
            <th scope="col">Week</th>
            <th scope="col">Commits</th>
          </tr>
        </thead>
        <tbody>
          {weeks.map((week, weekIndex) => (
            <tr key={weekIndex}>
              <th scope="row">{weekIndex + 1}</th>
              <td>{weekTotal(week)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
