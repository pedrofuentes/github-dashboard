import { cn } from '../../lib/cn';
import type { IssuesSignalSlice } from '../../types/fleet';

interface IssuesCellProps {
  /** The repo's issues slice; `undefined` until the signal populates it. */
  slice?: IssuesSignalSlice;
}

function IssueOpenedIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      width="12"
      height="12"
      fill="currentColor"
      className="shrink-0"
    >
      <path d="M8 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z" />
      <path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Z" />
    </svg>
  );
}

function TriageAlertIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      width="12"
      height="12"
      fill="currentColor"
      className="shrink-0"
    >
      <path d="M6.457 1.047c.659-1.234 2.428-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0 1 14.082 15H1.918a1.75 1.75 0 0 1-1.543-2.575Zm1.763.707a.25.25 0 0 0-.44 0L1.698 13.132a.25.25 0 0 0 .22.368h12.164a.25.25 0 0 0 .22-.368Zm.53 3.996v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 11a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z" />
    </svg>
  );
}

/** Neutral em-dash placeholder (icon + screen-reader text, never colour alone). */
function Placeholder({ srLabel }: { srLabel: string }) {
  return (
    <span className="inline-flex items-center justify-center text-text-muted">
      <span aria-hidden="true">—</span>
      <span className="sr-only">{srLabel}</span>
    </span>
  );
}

/**
 * Issues column cell: the repo's open-issue count as `N open`, with an amber,
 * icon-backed (never colour-only) indicator when the backlog is over the triage
 * threshold. Renders an accessible skeleton while loading and a neutral dash on
 * error or when no data is available (WCAG 2.1 AA).
 */
export function IssuesCell({ slice }: IssuesCellProps) {
  if (!slice || slice.status === 'unknown') {
    return <Placeholder srLabel="Issue count not available" />;
  }

  if (slice.status === 'loading') {
    return (
      <span className="inline-flex items-center justify-center">
        <span
          aria-hidden="true"
          className="inline-block h-3 w-10 animate-pulse rounded bg-border motion-reduce:animate-none"
        />
        <span className="sr-only">Loading issue count…</span>
      </span>
    );
  }

  if (slice.status === 'error') {
    return <Placeholder srLabel="Issue count unavailable" />;
  }

  const openCount = slice.openCount ?? 0;
  const overThreshold = slice.overThreshold ?? false;
  const noun = openCount === 1 ? 'issue' : 'issues';
  const label = overThreshold
    ? `${openCount} open ${noun}, over the triage threshold`
    : `${openCount} open ${noun}`;

  return (
    <span
      aria-label={label}
      className={cn(
        'inline-flex items-center justify-center gap-1 tabular-nums',
        overThreshold ? 'font-semibold text-accent-warning' : 'text-text-muted',
      )}
    >
      <IssueOpenedIcon />
      <span aria-hidden="true">{openCount} open</span>
      {overThreshold ? (
        <span
          title="over the triage threshold"
          className="inline-flex items-center text-accent-warning"
        >
          <TriageAlertIcon />
        </span>
      ) : null}
    </span>
  );
}
