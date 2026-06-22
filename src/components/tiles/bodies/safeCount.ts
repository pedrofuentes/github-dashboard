/**
 * `safeCount` — coerce an optional, possibly-garbage count to a safe,
 * non-negative integer (never `NaN`, never negative, never fractional).
 *
 * Signal counts are Zod-validated as non-negative upstream, but each per-signal
 * tile body still routes its hero count through this guard so a missing field,
 * a `NaN`, or an out-of-contract negative degrades to a calm `0` (→ the
 * all-clear state) rather than rendering a misleading or blank hero
 * (DESIGN-TILES §3.6). Shared by Reviews/Issues/Stale (and Prs) so the clamp is
 * defined once instead of duplicated per body (#190).
 */
export function safeCount(value: number | undefined): number {
  return Number.isFinite(value) && (value as number) > 0 ? Math.trunc(value as number) : 0;
}
