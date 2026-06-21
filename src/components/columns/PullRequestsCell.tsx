import type { PullRequestsSignalSlice } from '../../types/fleet';

interface PullRequestsCellProps {
  /** The repo's pull-requests slice, or `undefined` before any data arrives. */
  slice: PullRequestsSignalSlice | undefined;
}

function PullRequestIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      width="13"
      height="13"
      fill="currentColor"
      className="shrink-0 text-text-muted"
    >
      <path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z" />
    </svg>
  );
}

function NewContributorIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      width="12"
      height="12"
      fill="currentColor"
      className="shrink-0"
    >
      <path d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.751.751 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25Z" />
    </svg>
  );
}

/** A muted em dash plus a screen-reader label — never colour or glyph alone. */
function MutedDash({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center justify-center text-text-muted">
      <span aria-hidden="true">—</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

/**
 * Pull-requests cell: the open PR count with a prominent, colourblind-safe badge
 * when one or more of those PRs comes from a *new* outside contributor.
 *
 * Every state encodes its meaning with an icon and/or text — never colour alone
 * (WCAG 2.1 AA): loading shows a decorative skeleton, errors and the empty state
 * a labelled dash, and the external highlight pairs an icon, the word "external",
 * a screen-reader sentence, and a hover title with its coral styling.
 */
export function PullRequestsCell({ slice }: PullRequestsCellProps) {
  const status = slice?.status ?? 'unknown';

  if (status === 'loading') {
    return (
      <span className="inline-flex items-center justify-center">
        <span
          className="h-3 w-12 animate-pulse rounded bg-border motion-reduce:animate-none"
          aria-hidden="true"
        />
        <span className="sr-only">Loading pull requests…</span>
      </span>
    );
  }

  if (status === 'error') {
    return <MutedDash label="Pull request data unavailable" />;
  }

  if (status !== 'ready') {
    return <MutedDash label="No pull request data" />;
  }

  const openCount = slice?.openCount ?? 0;
  const externalCount = slice?.externalCount ?? 0;

  if (openCount === 0 && externalCount === 0) {
    return <MutedDash label="No open pull requests" />;
  }

  const openNoun = openCount === 1 ? 'pull request' : 'pull requests';
  const externalNoun = externalCount === 1 ? 'pull request' : 'pull requests';
  const externalAbbrev = externalCount === 1 ? 'PR' : 'PRs';

  return (
    <span className="inline-flex items-center justify-center gap-2">
      <span className="inline-flex items-center gap-1 text-text-muted">
        <PullRequestIcon />
        <span aria-hidden="true">{openCount} open</span>
        <span className="sr-only">
          {openCount} open {openNoun}
        </span>
      </span>
      {externalCount > 0 ? (
        <span
          className="inline-flex items-center gap-1 rounded-full bg-[color-mix(in_srgb,var(--color-coral)_10%,var(--color-surface))] px-2 py-0.5 text-xs font-semibold text-accent-coral-ink ring-1 ring-accent-coral"
          title={`${externalCount} ${externalAbbrev} from new outside contributors`}
        >
          <NewContributorIcon />
          <span aria-hidden="true">{externalCount} external</span>
          <span className="sr-only">
            {externalCount} {externalNoun} from new outside contributors
          </span>
        </span>
      ) : null}
    </span>
  );
}
