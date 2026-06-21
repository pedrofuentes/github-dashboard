import type { ReactElement, ReactNode } from 'react';

import type { SignalIconKind } from './types';
import { iconKindTone, toneTextClass } from './types';

export interface StatusGlyphProps {
  /** Which canonical status glyph to render (DESIGN-TILES §2.1). */
  status: SignalIconKind;
  /** Square pixel size of the glyph. Defaults to 16. */
  size?: number;
  /** Accessible name; falls back to the status's default label. */
  title?: string;
}

/** Default accessible labels — the redundant text layer paired with colour. */
const DEFAULT_LABEL: Record<SignalIconKind, string> = {
  success: 'Passing',
  failure: 'Failing',
  running: 'Running',
  queued: 'Queued',
  warning: 'Warning',
  stale: 'Stale',
  neutral: 'None',
  external: 'External',
  review: 'Awaiting you',
  loading: 'Loading…',
  unknown: 'Unavailable',
  info: 'Info',
};

/**
 * Inline SVG glyph geometry on a 16×16 grid. Strokes use `currentColor` so the
 * wrapper's tone text class colourises them; the few filled marks set
 * `fill="currentColor"` explicitly.
 */
const GLYPH: Record<SignalIconKind, ReactNode> = {
  success: <polyline points="3.5,8.5 6.75,11.75 12.5,4.5" />,
  failure: (
    <>
      <line x1="4.5" y1="4.5" x2="11.5" y2="11.5" />
      <line x1="11.5" y1="4.5" x2="4.5" y2="11.5" />
    </>
  ),
  // Three-quarter arc (the spinner shape, shown static here).
  running: <path d="M14 8a6 6 0 1 0-2.2 4.6" />,
  queued: (
    <>
      <circle cx="8" cy="8" r="6" />
      <polyline points="8,4.5 8,8 10.5,9.5" />
    </>
  ),
  warning: (
    <>
      <path d="M8 2.5 14 13 H2 Z" />
      <line x1="8" y1="6.5" x2="8" y2="9.5" />
      <line x1="8" y1="11.3" x2="8" y2="11.4" />
    </>
  ),
  stale: (
    <>
      <circle cx="8" cy="8" r="6" />
      <polyline points="8,4.5 8,8 10.5,9.5" />
    </>
  ),
  neutral: <line x1="3.5" y1="8" x2="12.5" y2="8" />,
  external: (
    <path
      fill="currentColor"
      stroke="none"
      d="M8 2.2 9.7 6.1 13.9 6.5 10.8 9.3 11.7 13.4 8 11.2 4.3 13.4 5.2 9.3 2.1 6.5 6.3 6.1 Z"
    />
  ),
  review: (
    <>
      <circle cx="8" cy="8" r="6" />
      <circle cx="8" cy="8" r="2" fill="currentColor" stroke="none" />
    </>
  ),
  // Loading spinner: a static arc unless motion is allowed (motion-reduce
  // disables the spin — DESIGN-TILES §2.2).
  loading: <path d="M14 8a6 6 0 1 0-2.2 4.6" />,
  unknown: <line x1="3.5" y1="8" x2="12.5" y2="8" />,
  info: (
    <>
      <circle cx="8" cy="8" r="6" />
      <line x1="8" y1="7.5" x2="8" y2="11" />
      <circle cx="8" cy="5" r="0.6" fill="currentColor" stroke="none" />
    </>
  ),
};

/**
 * Inline SVG status icon (DESIGN-TILES §2.1, §5), colourised through a tone
 * token class. State is encoded redundantly — every glyph carries an accessible
 * name (`title` or a per-status default), never colour alone. The `loading`
 * variant spins, but `motion-reduce:animate-none` freezes it to a static arc
 * under `prefers-reduced-motion` (§2.2).
 */
export function StatusGlyph({ status, size = 16, title }: StatusGlyphProps): ReactElement {
  const label = title ?? DEFAULT_LABEL[status];
  const spin = status === 'loading' ? ' animate-spin motion-reduce:animate-none' : '';

  return (
    <span className={`inline-flex ${toneTextClass(iconKindTone(status))}`}>
      <svg
        role="img"
        aria-label={label}
        data-status={status}
        width={size}
        height={size}
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={spin}
      >
        <title>{label}</title>
        {GLYPH[status]}
      </svg>
    </span>
  );
}
