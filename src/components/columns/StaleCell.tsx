import type { StaleSignalSlice } from '../../types/fleet';
import { StubCell } from './StubCell';
import { STALE_THRESHOLD_DAYS } from '../../hooks/signals/useStaleSignal';

interface StaleCellProps {
  /** The repo's stale slice, or `undefined` before it has been resolved. */
  slice: StaleSignalSlice | undefined;
}

function ClockIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
    >
      <circle cx="8" cy="8" r="6.25" />
      <path d="M8 4.75V8l2.5 1.5" />
    </svg>
  );
}

/**
 * Stale column cell: how many of a repo's open PRs and issues have had no
 * activity in the last {@link STALE_THRESHOLD_DAYS} days.
 *
 * - `> 0` → an amber badge "N stale", labelled for screen readers and paired
 *   with a clock icon so the warning never rests on colour alone (WCAG 2.1 AA,
 *   colourblind-safe).
 * - `0` → a muted dash with an accessible "nothing stale" label.
 * - `loading` → an animated skeleton (with an SR-only "loading" message).
 * - `error` / not-yet-resolved → an accessible dash, like every signal stub.
 */
export function StaleCell({ slice }: StaleCellProps) {
  if (slice?.status === 'loading') {
    return (
      <span className="inline-flex items-center justify-center">
        <span aria-hidden="true" className="block h-3 w-12 animate-pulse rounded bg-slate-300/70" />
        <span className="sr-only">Loading stale items…</span>
      </span>
    );
  }

  if (slice?.status === 'error') {
    return <StubCell srLabel="Stale activity unavailable" />;
  }

  if (slice?.status === 'ready') {
    const count = slice.staleCount ?? 0;
    if (count > 0) {
      const label = `${count} open item${count === 1 ? '' : 's'} with no activity in ${STALE_THRESHOLD_DAYS} days`;
      return (
        <span
          role="img"
          aria-label={label}
          className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900"
        >
          <ClockIcon />
          <span aria-hidden="true">{count} stale</span>
        </span>
      );
    }
    return <StubCell srLabel="No stale open pull requests or issues" />;
  }

  return <StubCell srLabel="Stale activity not loaded" />;
}
