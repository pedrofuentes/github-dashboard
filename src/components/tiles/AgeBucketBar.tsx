/**
 * AgeBucketBar — a compact micro-viz (redesign T12, DESIGN-TILES §5) showing how
 * a tile's stale items distribute across age buckets (`>14d` / `>30d` / `>60d`).
 *
 * The buckets are passed in ascending-age order and rendered as height-stepped
 * segments where older buckets are TALLER. Age ordering therefore reads as a
 * non-colour height channel (plus render order plus the screen-reader list), so
 * the bar survives grayscale and colour-blind viewing — meaning never rests on
 * colour alone. The single warm accent uses the `ochre` token (T1), so the tile
 * stays theme-aware and AA with no hard-coded hex. Zero-value buckets are
 * omitted; an all-zero input renders nothing visible but stays safe.
 */
import type { ReactElement } from 'react';

export interface AgeBucket {
  /** Human-readable bucket label, e.g. ">30d". */
  label: string;
  /** Number of stale items in this bucket (zero-value buckets are omitted). */
  value: number;
}

export interface AgeBucketBarProps {
  /** Age buckets in ascending-age order; older buckets render taller. */
  buckets: AgeBucket[];
  /** Screen-reader summary of the whole distribution. */
  srLabel: string;
}

/**
 * Ascending height utilities — the segment at render `index` (older buckets come
 * later) is taller, encoding age ordering without colour. Beyond the table the
 * tallest height is reused (bounded bucket sets keep this within range).
 */
const HEIGHT_CLASSES = ['h-2', 'h-4', 'h-6', 'h-8'] as const;

function heightClass(index: number): string {
  return HEIGHT_CLASSES[Math.min(index, HEIGHT_CLASSES.length - 1)];
}

export function AgeBucketBar({ buckets, srLabel }: AgeBucketBarProps): ReactElement {
  const visible = buckets.filter((bucket) => bucket.value > 0);
  const total = visible.reduce((sum, bucket) => sum + bucket.value, 0);

  return (
    <div className="w-full">
      <div aria-hidden="true" className="flex h-8 w-full items-end gap-1">
        {visible.map((bucket, index) => (
          <div
            key={bucket.label}
            data-bucket={bucket.label}
            title={`${bucket.label}: ${bucket.value}`}
            className={`rounded-sm bg-accent-ochre ${heightClass(index)}`}
            style={{ width: total > 0 ? `${(bucket.value / total) * 100}%` : '0%' }}
          />
        ))}
      </div>
      <ul className="sr-only">
        <li>{srLabel}</li>
        {visible.map((bucket) => (
          <li key={bucket.label}>
            {bucket.label}: {bucket.value}
          </li>
        ))}
      </ul>
    </div>
  );
}
