import type { ReviewsSignalSlice } from '../../types/fleet';
import { StubCell } from './StubCell';

interface ReviewsCellProps {
  /** The repo's reviews slice, or `undefined` before it has been resolved. */
  slice: ReviewsSignalSlice | undefined;
}

function EyeIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      width="12"
      height="12"
      fill="currentColor"
      className="shrink-0"
    >
      <path d="M8 2c1.981 0 3.671.992 4.933 2.078 1.27 1.091 2.187 2.345 2.637 3.023a1.62 1.62 0 0 1 0 1.798c-.45.678-1.367 1.932-2.637 3.023C11.67 12.008 9.981 13 8 13c-1.981 0-3.671-.992-4.933-2.078C1.797 9.83.88 8.576.43 7.898a1.62 1.62 0 0 1 0-1.798c.45-.677 1.367-1.931 2.637-3.022C4.33 2.992 6.019 2 8 2ZM1.679 7.932a.12.12 0 0 0 0 .136c.411.622 1.241 1.75 2.366 2.717C5.176 11.758 6.527 12.5 8 12.5c1.473 0 2.825-.742 3.955-1.715 1.124-.967 1.954-2.096 2.366-2.717a.12.12 0 0 0 0-.136c-.412-.621-1.242-1.75-2.366-2.717C10.824 4.242 9.473 3.5 8 3.5c-1.473 0-2.825.742-3.955 1.715-1.124.967-1.954 2.096-2.366 2.717ZM8 10a2 2 0 1 1-.001-3.999A2 2 0 0 1 8 10Z" />
    </svg>
  );
}

/**
 * Reviews column cell: how many open PRs await the viewer's review.
 *
 * - `> 0` → a prominent rose badge "N awaiting you", labelled for screen
 *   readers and paired with an eye icon so urgency never rests on colour alone
 *   (WCAG 2.1 AA, colourblind-safe).
 * - `0` → a muted dash with an accessible "none awaiting" label.
 * - `loading` → an animated skeleton (with an SR-only "loading" message).
 * - `error` / not-yet-resolved → an accessible dash, like every signal stub.
 */
export function ReviewsCell({ slice }: ReviewsCellProps) {
  if (slice?.status === 'loading') {
    return (
      <span className="inline-flex items-center justify-center">
        <span
          aria-hidden="true"
          className="block h-3 w-16 animate-pulse rounded bg-slate-200 motion-reduce:animate-none"
        />
        <span className="sr-only">Loading review requests…</span>
      </span>
    );
  }

  if (slice?.status === 'error') {
    return <StubCell srLabel="Review queue unavailable" />;
  }

  if (slice?.status === 'ready') {
    const count = slice.requestedCount ?? 0;
    if (count > 0) {
      const label = `${count} pull request${count === 1 ? '' : 's'} awaiting your review`;
      return (
        <span
          role="img"
          aria-label={label}
          className="inline-flex items-center gap-1 rounded-full border border-rose-300 bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-900"
        >
          <EyeIcon />
          <span aria-hidden="true">{count} awaiting you</span>
        </span>
      );
    }
    return <StubCell srLabel="No pull requests awaiting your review" />;
  }

  return <StubCell srLabel="Review queue not loaded" />;
}
