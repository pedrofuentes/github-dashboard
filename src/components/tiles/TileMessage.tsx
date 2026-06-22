/**
 * TileMessage — the shared presentational "state row" every tile body routes its
 * loading / empty-`0` / failed-to-load / partial branches through (DESIGN-TILES
 * §7; redesign T16). It guarantees the **missing-states matrix** is consistent
 * across all bodies: one distinct glyph + one stable `data-state` per kind, plus
 * a redundant `sr-only` sentence so state is never conveyed by colour alone
 * (WCAG 2.1 AA, both themes — all colour comes from semantic tokens).
 *
 * HARD RULE (spec §7): the calm empty-`0` **all-clear** state (a success check)
 * MUST be visually unmistakable from **failed-to-load** (a warning ⚠). They are
 * kept apart on TWO redundant channels — a different glyph *and* a different
 * `data-state` (`empty` vs `failed-to-load`) — so a colour-blind or grayscale
 * reader still tells "everything's fine" from "this didn't load".
 *
 * Per-tile `Retry` is rendered only for `failed` AND only when an `onRetry`
 * handler is plumbed; bodies without one fall back to the view-level retry.
 *
 * DEFERRED (need new `SignalStatus` metadata — see DECISIONS): `not-configured`,
 * `stale-cache` and `rate-limited` are NOT representable today (`SignalStatus` is
 * only `unknown | loading | ready | error`), so they are out of this matrix. The
 * `partial` kind is wired where a partial count exists (Security `truncated`;
 * Fleet's gated placeholder).
 */
import type { ReactElement } from 'react';

import { StatusGlyph } from './StatusGlyph';
import type { SignalIconKind } from './types';

/** The four missing-states representable today (DESIGN-TILES §7). */
export type TileMessageKind = 'loading' | 'all-clear' | 'failed' | 'partial';

export interface TileMessageProps {
  /** Which matrix state to render — drives the glyph + `data-state`. */
  kind: TileMessageKind;
  /** Visible (aria-hidden) label, e.g. "All clear" / "Couldn't load". */
  message: string;
  /** Redundant `sr-only` sentence — the never-blank text layer. */
  srText: string;
  /**
   * Optional retry handler. Rendered as a "Retry" button ONLY for `failed`; when
   * omitted the body relies on the view-level retry (per-tile retry deferred).
   */
  onRetry?: () => void;
}

interface KindSpec {
  /** Stable state hook tests + styles key off (never colour alone). */
  dataState: string;
  /** Distinct {@link StatusGlyph} shape per kind. */
  glyph: SignalIconKind;
  /** Token-only text accent for the message line. */
  textClass: string;
}

/**
 * Per-kind treatment. `all-clear` (success ✓, `empty`) and `failed` (warning ⚠,
 * `failed-to-load`) deliberately differ on BOTH the glyph and the `data-state`
 * to satisfy the §7 HARD RULE.
 */
const KIND_SPEC: Record<TileMessageKind, KindSpec> = {
  loading: { dataState: 'loading', glyph: 'loading', textClass: 'text-text-muted' },
  'all-clear': { dataState: 'empty', glyph: 'success', textClass: 'text-accent-success' },
  failed: { dataState: 'failed-to-load', glyph: 'warning', textClass: 'text-accent-failure' },
  partial: { dataState: 'partial', glyph: 'info', textClass: 'text-accent-info' },
};

export function TileMessage({ kind, message, srText, onRetry }: TileMessageProps): ReactElement {
  const spec = KIND_SPEC[kind];
  const showRetry = kind === 'failed' && onRetry !== undefined;

  return (
    <div
      data-state={spec.dataState}
      data-kind={kind}
      className={`flex h-full flex-col items-center justify-center gap-1 text-center ${spec.textClass}`}
    >
      <StatusGlyph status={spec.glyph} size={22} title={message} />
      <span aria-hidden="true" className="text-sm font-medium">
        {message}
      </span>
      {showRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-1 inline-flex rounded px-2 py-0.5 text-xs font-medium text-accent-info hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          Retry
        </button>
      ) : null}
      <span className="sr-only">{srText}</span>
    </div>
  );
}
