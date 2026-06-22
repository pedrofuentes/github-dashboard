import type { ReactElement } from 'react';

import type { AccentTone } from './types';
import { toneToVar } from './types';

/** The five run conclusions a CI signal slice can carry. */
export type RunConclusion = 'success' | 'failure' | 'in_progress' | 'queued' | 'none';

export interface RunStripProps {
  /** Conclusion of the latest run (the only run the CI hook retains). */
  conclusion: RunConclusion;
  /** Screen-reader sentence — the redundant textual channel. */
  srLabel: string;
}

/**
 * Non-colour shape channel per conclusion (DESIGN-TILES §8, redesign R-grayscale).
 * The cell stays legible in grayscale: `solid` = full filled square, `notch` =
 * a shorter block with a wedge cut from its top edge (failure), `running` =
 * half-height block, `queued` = thin outline, `none` = a baseline tick. Tone is
 * a *redundant* colour layer over the shape, never the sole signal.
 */
const SHAPE: Record<RunConclusion, string> = {
  success: 'solid',
  failure: 'notch',
  in_progress: 'running',
  queued: 'queued',
  none: 'none',
};

/** Conclusion → redundant accent tone (mirrors {@link iconKindTone} for CI). */
const TONE: Record<RunConclusion, AccentTone> = {
  success: 'success',
  failure: 'failure',
  in_progress: 'warning',
  queued: 'info',
  none: 'neutral',
};

/** SVG geometry per shape on a 12×12 grid. `fill`/`stroke` use the tone var. */
function cell(shape: string, fill: string): ReactElement {
  switch (shape) {
    case 'solid':
      return <rect x="1" y="1" width="10" height="10" rx="2" fill={fill} />;
    case 'notch':
      // Shorter block with a V-notch cut from the top — distinct without colour.
      return (
        <path
          d="M2 4 H5 L6 6 L7 4 H10 A1 1 0 0 1 11 5 V10 A1 1 0 0 1 10 11 H2 A1 1 0 0 1 1 10 V5 A1 1 0 0 1 2 4 Z"
          fill={fill}
        />
      );
    case 'running':
      // Half-height filled block.
      return <rect x="1" y="4" width="10" height="5" rx="2" fill={fill} />;
    case 'queued':
      // Thin outline only.
      return (
        <rect
          x="1.5"
          y="1.5"
          width="9"
          height="9"
          rx="2"
          fill="none"
          stroke={fill}
          strokeWidth="1.5"
        />
      );
    default:
      // 'none' — a baseline tick.
      return <rect x="1" y="9" width="10" height="2" rx="1" fill={fill} />;
  }
}

/**
 * A single shape-coded latest-run cell (DESIGN-TILES §5, redesign R3/T7). The CI
 * hook retains only the latest run (no win/loss history), so this replaces the
 * spec's 10-cell strip with one grayscale-survivable cell: the shape encodes the
 * conclusion, tone adds redundant colour, and the `sr-only` label carries the
 * text. The viz is decorative (`aria-hidden`).
 */
export function RunStrip({ conclusion, srLabel }: RunStripProps): ReactElement {
  const shape = SHAPE[conclusion];
  const tone = TONE[conclusion];

  return (
    <span className="inline-flex items-center">
      <svg
        aria-hidden="true"
        data-shape={shape}
        data-tone={tone}
        width={12}
        height={12}
        viewBox="0 0 12 12"
        className="shrink-0"
      >
        {cell(shape, toneToVar(tone))}
      </svg>
      <span className="sr-only">{srLabel}</span>
    </span>
  );
}
