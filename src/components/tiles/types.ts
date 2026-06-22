/**
 * Shared types and token helpers for the tile primitive library
 * (DESIGN-TILES §1–§2, §5). These are the single source of truth that keeps
 * every primitive — and the per-signal tiles that consume them — on the same
 * semantic-token / `tone` API. Components reference token names only (via these
 * helpers); raw hex lives once per theme in `src/index.css`, so a single
 * `.dark` class on `<html>` flips the whole tree.
 */
import type { TileSignalType } from '../../types/dashboard';

/** A semantic accent that resolves to a status/identity colour token. */
export type AccentTone =
  | 'success'
  | 'failure'
  | 'warning'
  | 'info'
  | 'neutral'
  | 'coral'
  | 'purple'
  | 'gold'
  | 'ochre';

/** Density tier a tile renders at (DESIGN-TILES §3.4). */
export type TileTier = 'compact' | 'standard' | 'expanded';

/**
 * Status-glyph kinds. The first eleven mirror DESIGN-TILES §2.1's canonical
 * CI / PR / review statuses; `info` extends the set for the neutral
 * informational glyph used by data-display tile bodies — it is not a run state.
 */
export type SignalIconKind =
  | 'success'
  | 'failure'
  | 'running'
  | 'queued'
  | 'warning'
  | 'stale'
  | 'neutral'
  | 'external'
  | 'review'
  | 'loading'
  | 'unknown'
  | 'info';

/**
 * Resolve a tone to its CSS custom property reference — for SVG `fill`/`stroke`
 * or inline `style` tints that must flip with the theme. Never returns raw hex.
 *
 * The lookup doubles as a **runtime allowlist**: a value outside the canonical
 * `AccentTone` set (only reachable via a type-cast / unvalidated data) resolves
 * to the neutral token instead of interpolating an arbitrary string into
 * `var(--color-…)` — defense-in-depth on top of the type + CSP guards.
 */
const TONE_VAR: Record<AccentTone, string> = {
  success: 'var(--color-success)',
  failure: 'var(--color-failure)',
  warning: 'var(--color-warning)',
  info: 'var(--color-info)',
  neutral: 'var(--color-neutral)',
  coral: 'var(--color-coral)',
  purple: 'var(--color-purple)',
  gold: 'var(--color-gold)',
  ochre: 'var(--color-ochre)',
};

export function toneToVar(tone: AccentTone): string {
  return TONE_VAR[tone] ?? TONE_VAR.neutral;
}

/**
 * Full literal class strings (not template-interpolated) so Tailwind's content
 * scanner keeps each utility. `text-accent-*` clears AA on tile surfaces in both
 * themes (DESIGN-TILES §1.5).
 */
const TONE_TEXT_CLASS: Record<AccentTone, string> = {
  success: 'text-accent-success',
  failure: 'text-accent-failure',
  warning: 'text-accent-warning',
  info: 'text-accent-info',
  neutral: 'text-accent-neutral',
  coral: 'text-accent-coral',
  purple: 'text-accent-purple',
  gold: 'text-accent-gold',
  ochre: 'text-accent-ochre',
};

/** Tailwind text-colour class for a tone. */
export function toneTextClass(tone: AccentTone): string {
  return TONE_TEXT_CLASS[tone];
}

const TONE_BG_CLASS: Record<AccentTone, string> = {
  success: 'bg-accent-success',
  failure: 'bg-accent-failure',
  warning: 'bg-accent-warning',
  info: 'bg-accent-info',
  neutral: 'bg-accent-neutral',
  coral: 'bg-accent-coral',
  purple: 'bg-accent-purple',
  gold: 'bg-accent-gold',
  ochre: 'bg-accent-ochre',
};

/** Tailwind background-colour class for a tone (solid, non-text fills). */
export function toneBgClass(tone: AccentTone): string {
  return TONE_BG_CLASS[tone];
}

const ICON_KIND_TONE: Record<SignalIconKind, AccentTone> = {
  success: 'success',
  failure: 'failure',
  running: 'warning',
  queued: 'info',
  warning: 'warning',
  stale: 'warning',
  neutral: 'neutral',
  external: 'coral',
  review: 'warning',
  loading: 'neutral',
  unknown: 'neutral',
  info: 'info',
};

/** Resolve the accent a status glyph paints with (DESIGN-TILES §2.1). */
export function iconKindTone(kind: SignalIconKind): AccentTone {
  return ICON_KIND_TONE[kind];
}

/**
 * Per-signal **identity** accent for a CALM tile's header dot/icon
 * (DESIGN-TILES §3, §5). On calm tiles the edge bar is neutral and the signal's
 * identity colour moves to the header glyph, so colour-blind redundancy is kept
 * via the adjacent label + icon shape rather than the bar. Problem/actionable
 * tiers override this with their salience edge tone (handled by `TileFrame`).
 */
export const SIGNAL_IDENTITY_TONE: Record<TileSignalType, AccentTone> = {
  ci: 'neutral',
  security: 'neutral',
  pullRequests: 'info',
  reviews: 'info',
  issues: 'neutral',
  stale: 'ochre',
  activity: 'purple',
};
