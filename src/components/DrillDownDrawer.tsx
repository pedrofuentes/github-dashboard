/**
 * DrillDownDrawer — a focused, accessible side panel (REC-8) that opens when a
 * fleet row is activated and shows that single repo's signals in one place.
 *
 * It is a pure presentation component: it reads the already-aggregated
 * {@link RepoSignalData} slices (no new network fetches) and renders a per-signal
 * breakdown. Accessibility: it is a `role="dialog"` / `aria-modal` panel labelled
 * by the repo name, moves focus inside on open, traps Tab focus, closes on `Esc`
 * or backdrop click, and returns focus to the element that opened it. Every link
 * it renders is origin-validated to `https://github.com` (security rule).
 */
import { useEffect, useId, useRef } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';

import { safeGitHubHref } from '../lib/github-url';
import type { CiSignalSlice, Repo, RepoSignalData, SignalStatus } from '../types/fleet';

interface DrillDownDrawerProps {
  /** The repo whose signals are shown. */
  repo: Repo;
  /** The aggregated signal slices for {@link repo} (from `getRowData`). */
  data: RepoSignalData;
  /** Closes the drawer (clears the selection in the parent). */
  onClose: () => void;
}

const CONCLUSION_LABEL: Record<NonNullable<CiSignalSlice['conclusion']>, string> = {
  success: 'Passing',
  failure: 'Failing',
  in_progress: 'Running',
  queued: 'Queued',
  none: 'No runs',
};

const FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Maps a non-ready slice status to a safe, human placeholder (null when ready). */
function statusPlaceholder(status: SignalStatus): string | null {
  switch (status) {
    case 'loading':
      return 'Loading…';
    case 'error':
      return 'Couldn’t load this signal';
    case 'unknown':
      return 'No data yet';
    default:
      return null;
  }
}

function getFocusableElements(root: HTMLElement | null): HTMLElement[] {
  if (root === null) {
    return [];
  }
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
}

function pluralize(count: number, singular: string): string {
  return count === 1 ? singular : `${singular}s`;
}

/** One labelled signal section: renders a placeholder unless the slice is ready. */
function SignalDetail({
  title,
  status,
  children,
}: {
  title: string;
  status: SignalStatus;
  children: ReactNode;
}) {
  const placeholder = statusPlaceholder(status);
  return (
    <section className="border-t border-slate-800 py-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</h3>
      <div className="mt-1 space-y-1 text-sm text-slate-200">
        {placeholder === null ? children : <p className="text-slate-400">{placeholder}</p>}
      </div>
    </section>
  );
}

export function DrillDownDrawer({ repo, data, onClose }: DrillDownDrawerProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus();
    return () => {
      previouslyFocused?.focus?.();
    };
  }, []);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== 'Tab') {
      return;
    }
    const focusables = getFocusableElements(dialogRef.current);
    if (focusables.length === 0) {
      event.preventDefault();
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  const repoHref = safeGitHubHref(`https://github.com/${repo.nameWithOwner}`);

  const ci = data.ci;
  const ciRunHref = safeGitHubHref(ci?.latestRunUrl);
  const failingCount = ci?.failingCount ?? 0;

  const security = data.security;
  const securityCounts = security?.counts;

  const reviewsCount = data.reviews?.requestedCount ?? 0;

  const openPrCount = data.pullRequests?.openCount ?? 0;
  const externalPrCount = data.pullRequests?.externalCount ?? 0;

  const openIssueCount = data.issues?.openCount ?? 0;
  const issuesOverThreshold = data.issues?.overThreshold ?? false;

  const staleCount = data.stale?.staleCount ?? 0;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        data-testid="drawer-backdrop"
        aria-hidden="true"
        onClick={onClose}
        className="absolute inset-0 bg-slate-950/60"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={handleKeyDown}
        className="relative ml-auto flex h-full w-full max-w-md flex-col overflow-y-auto border-l border-slate-800 bg-slate-900 p-6 text-slate-100 shadow-xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 id={titleId} className="break-words text-lg font-semibold">
              <a
                href={repoHref}
                target="_blank"
                rel="noreferrer noopener"
                className="rounded text-sky-300 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
              >
                {repo.nameWithOwner}
              </a>
            </h2>
            {repo.isPrivate ? (
              <p className="mt-1 text-xs text-slate-400">Private repository</p>
            ) : null}
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Close details"
            className="shrink-0 rounded p-1 text-slate-400 hover:text-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
          >
            <span aria-hidden="true">✕</span>
          </button>
        </div>

        <div className="mt-4 flex flex-col">
          <SignalDetail title="CI / Actions" status={ci?.status ?? 'unknown'}>
            <p>{`Conclusion: ${CONCLUSION_LABEL[ci?.conclusion ?? 'none']}`}</p>
            <p>{`${failingCount} failing ${pluralize(failingCount, 'workflow')}`}</p>
            {ciRunHref !== undefined ? (
              <a
                href={ciRunHref}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex rounded text-sky-300 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
              >
                View latest run
              </a>
            ) : null}
          </SignalDetail>

          <SignalDetail title="Security" status={security?.status ?? 'unknown'}>
            <p>{`Grade: ${security?.grade ?? '—'}`}</p>
            {securityCounts !== undefined ? (
              <ul className="grid grid-cols-2 gap-x-4 tabular-nums">
                <li>{`Critical: ${securityCounts.critical}`}</li>
                <li>{`High: ${securityCounts.high}`}</li>
                <li>{`Medium: ${securityCounts.medium}`}</li>
                <li>{`Low: ${securityCounts.low}`}</li>
              </ul>
            ) : (
              <p className="text-slate-400">No security-alert access for this repository</p>
            )}
          </SignalDetail>

          <SignalDetail title="Review requests" status={data.reviews?.status ?? 'unknown'}>
            <p>{`${reviewsCount} review ${pluralize(reviewsCount, 'request')}`}</p>
          </SignalDetail>

          <SignalDetail title="Pull requests" status={data.pullRequests?.status ?? 'unknown'}>
            <p>{`${openPrCount} open ${pluralize(openPrCount, 'pull request')}`}</p>
            {externalPrCount > 0 ? (
              <p className="text-amber-300">
                {`${externalPrCount} from new outside ${pluralize(externalPrCount, 'contributor')}`}
              </p>
            ) : null}
          </SignalDetail>

          <SignalDetail title="Issues" status={data.issues?.status ?? 'unknown'}>
            <p>{`${openIssueCount} open ${pluralize(openIssueCount, 'issue')}`}</p>
            {issuesOverThreshold ? (
              <p className="text-amber-300">Over the triage threshold</p>
            ) : null}
          </SignalDetail>

          <SignalDetail title="Stale items" status={data.stale?.status ?? 'unknown'}>
            <p>{`${staleCount} stale ${pluralize(staleCount, 'item')}`}</p>
          </SignalDetail>
        </div>
      </div>
    </div>
  );
}
