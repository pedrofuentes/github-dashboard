/**
 * `CenteredState` — the shared neutral container every per-signal tile body
 * routes its loading / error / unavailable ("n/a") branches through, so the body
 * is never blank (DESIGN-TILES §3.6). It centres a {@link StatusGlyph}, an
 * aria-hidden visible message, and a redundant `sr-only` sentence, tinting the
 * whole block with a single token (`text-text-muted` for muted, the failure
 * accent for error) — never colour alone.
 *
 * Extracted from Reviews/Issues/StaleTileBody, where it was duplicated
 * byte-for-byte (#190). Security/Prs keep their own structurally-different
 * neutral states; this covers the three that shared an identical implementation.
 */
import type { ReactElement } from 'react';

export interface CenteredStateProps {
  /** Stable state key tests + styles hook off (e.g. "unavailable"). */
  state: string;
  /** Token-only tint: muted for neutral states, error for failures. */
  tone: 'muted' | 'error';
  /** The redundant status glyph paired with the message. */
  glyph: ReactElement;
  /** Visible (aria-hidden) label, e.g. "n/a" / "Couldn't load". */
  message: string;
  /** Redundant `sr-only` sentence — the never-blank text layer. */
  srText: string;
}

export function CenteredState({
  state,
  tone,
  glyph,
  message,
  srText,
}: CenteredStateProps): ReactElement {
  return (
    <div
      data-state={state}
      className={`flex h-full flex-col items-center justify-center ${
        tone === 'error' ? 'text-accent-failure' : 'text-text-muted'
      }`}
    >
      {glyph}
      <span aria-hidden="true" className="mt-1 text-sm">
        {message}
      </span>
      <span className="sr-only">{srText}</span>
    </div>
  );
}
