import type { SecurityCounts, SecurityGrade } from '../../hooks/signals/securityGrade';
import type { SecuritySignalSlice } from '../../types/fleet';

interface SecurityCellProps {
  /** The repo's security slice, or `undefined` before the signal resolves. */
  slice: SecuritySignalSlice | undefined;
}

/**
 * Per-grade badge styling. Every grade keeps a high-contrast text colour, but
 * the **letter itself** carries the meaning, so the badge is never colour-only
 * (WCAG AA / colour-blind safe). Colours map to the canonical grade→accent
 * tokens (DESIGN-TILES §4.2: A–B success, C warning, D–F failure) so the table
 * stays consistent with the Security tile and flips correctly in dark mode. The
 * tinted fill is the accent composited at a low opacity over the surface (§1.5
 * tinted-chip pattern), with the accent itself carrying text + ring.
 */
const GRADE_BADGE_CLASS: Record<SecurityGrade, string> = {
  A: 'bg-[color-mix(in_srgb,var(--color-success)_10%,var(--color-surface))] text-accent-success ring-accent-success',
  B: 'bg-[color-mix(in_srgb,var(--color-success)_10%,var(--color-surface))] text-accent-success ring-accent-success',
  C: 'bg-[color-mix(in_srgb,var(--color-warning)_10%,var(--color-surface))] text-accent-warning-ink ring-accent-warning',
  D: 'bg-[color-mix(in_srgb,var(--color-failure)_10%,var(--color-surface))] text-accent-failure ring-accent-failure',
  E: 'bg-[color-mix(in_srgb,var(--color-failure)_10%,var(--color-surface))] text-accent-failure ring-accent-failure',
  F: 'bg-[color-mix(in_srgb,var(--color-failure)_10%,var(--color-surface))] text-accent-failure ring-accent-failure',
};

/** [counts key, compact glyph, spoken word] in worst-first order. */
const SEVERITIES: ReadonlyArray<[keyof SecurityCounts, string, string]> = [
  ['critical', 'C', 'critical'],
  ['high', 'H', 'high'],
  ['medium', 'M', 'medium'],
  ['low', 'L', 'low'],
];

function summarise(counts: SecurityCounts): { compact: string; spoken: string } {
  const compact: string[] = [];
  const spoken: string[] = [];
  for (const [key, glyph, word] of SEVERITIES) {
    const n = counts[key];
    if (n > 0) {
      compact.push(`${glyph}${n}`);
      spoken.push(`${n} ${word}`);
    }
  }
  return { compact: compact.join(' '), spoken: spoken.join(', ') };
}

function GradeBadge({ grade }: { grade: SecurityGrade }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded px-1 text-xs font-bold ring-1 ${GRADE_BADGE_CLASS[grade]}`}
    >
      {grade}
    </span>
  );
}

function CheckIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" width="12" height="12" fill="currentColor">
      <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-6.5 6.5a.75.75 0 0 1-1.06 0l-3-3a.75.75 0 1 1 1.06-1.06L6.75 10.19l5.97-5.97a.75.75 0 0 1 1.06 0Z" />
    </svg>
  );
}

/** A trailing-ellipsis glyph hinting "more, not counted" for partial tallies. */
function PartialIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" width="12" height="12" fill="currentColor">
      <path d="M4 8a1 1 0 1 1-2 0 1 1 0 0 1 2 0Zm5 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0Zm5 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z" />
    </svg>
  );
}

/**
 * Renders the Security column cell: a letter grade plus a compact severity
 * summary (e.g. `C2 H1`), with every state conveyed by text/icon and an
 * accessible label — never colour alone. Distinguishes loading, error, a
 * "no access" feed, all-clear, and graded states.
 */
export function SecurityCell({ slice }: SecurityCellProps) {
  if (!slice || slice.status === 'unknown') {
    return (
      <span className="inline-flex items-center justify-center text-text-muted">
        <span aria-hidden="true">—</span>
        <span className="sr-only">Security status unavailable</span>
      </span>
    );
  }

  if (slice.status === 'loading') {
    return (
      <span className="inline-flex items-center justify-center">
        <span
          className="h-4 w-10 animate-pulse rounded bg-border motion-reduce:animate-none"
          aria-hidden="true"
        />
        <span className="sr-only">Loading security alerts…</span>
      </span>
    );
  }

  if (slice.status === 'error') {
    return (
      <span
        className="inline-flex items-center justify-center text-accent-warning"
        title="Couldn’t load security alerts"
      >
        <span aria-hidden="true">—</span>
        <span className="sr-only">Security alerts failed to load</span>
      </span>
    );
  }

  // status === 'ready'
  if (!slice.counts) {
    return (
      <span
        className="inline-flex items-center justify-center text-text-muted"
        title="No security-alert access for this repository (token scope or feature disabled)"
      >
        <span aria-hidden="true">n/a</span>
        <span className="sr-only">Security alerts not available for this repository</span>
      </span>
    );
  }

  const grade = slice.grade ?? 'A';
  const { compact, spoken } = summarise(slice.counts);
  const allClear = compact === '';
  // A truncated tally is a lower bound: the cell says so in words + an icon
  // (never colour alone) so the understated grade is legible to everyone (#77).
  const partial = slice.truncated === true && !allClear;
  const label = allClear
    ? `Security grade ${grade}: no open alerts`
    : partial
      ? `Security grade ${grade}: at least ${spoken} (partial — more alerts not counted)`
      : `Security grade ${grade}: ${spoken}`;

  return (
    <span className="inline-flex items-center justify-center gap-1.5" aria-label={label}>
      <GradeBadge grade={grade} />
      {allClear ? (
        <span
          aria-hidden="true"
          className="inline-flex items-center gap-0.5 text-xs text-accent-success"
        >
          <CheckIcon />
          Clear
        </span>
      ) : (
        <span aria-hidden="true" className="text-xs font-medium tabular-nums text-text-muted">
          {partial ? `≥${compact}` : compact}
        </span>
      )}
      {partial && (
        <span
          aria-hidden="true"
          className="inline-flex items-center gap-0.5 text-xs text-text-muted"
          title="Alert count is partial — pagination cap reached; more alerts were not counted"
        >
          <PartialIcon />
          partial
        </span>
      )}
      <span className="sr-only">{label}</span>
    </span>
  );
}
