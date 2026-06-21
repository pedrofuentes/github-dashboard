/**
 * InboxView — the Notifications Inbox container (DESIGN-INBOX §6, §7).
 *
 * Owns the Inbox presentation. It is driven by a {@link UseInboxResult}
 * view-model passed in as a prop: `App` lifts a single {@link useInbox} instance
 * (over the same fleet `repos` + `getRowData` seam the grid and dashboard use)
 * to the panel level so the toggle's unread badge and this view share one triage
 * state, then hands the result here. The view renders the header (filter-
 * independent unread count + the §4.2 repo/kind/unread-only/show-dismissed
 * filters), and switches the body between the four §6.1 states and the list:
 *
 * - **error** (inherited from the fleet load) → a shared alert + retry;
 * - **loading** (inherited) → a reduced-motion-friendly skeleton + `aria-busy`;
 * - **all caught up** → a positive empty state when nothing matches and no
 *   narrowing filter is active;
 * - **empty filtered** → a distinct "no matches" state + a clear-filters action;
 * - otherwise the {@link InboxList}.
 *
 * Triage intent flows back through the hook; each action also posts to a polite
 * `aria-live` region so screen-reader users hear "Marked as read" / "Dismissed"
 * / "Restored" alongside the re-announced unread count (§6.2). All colour comes
 * from semantic theme tokens, so the view recolours with a single `.dark` flip.
 */
import { useCallback, useId, useState } from 'react';
import type { ChangeEvent, ReactElement } from 'react';

import type { UseInboxResult } from '../../hooks/useInbox';
import type { Repo } from '../../types/fleet';
import type { InboxKind } from '../../types/inbox';
import { InboxList } from './InboxList';
import { KIND_LABELS } from './labels';

/** Placeholder rows shown while the fleet load is in flight. */
const SKELETON_ROWS = 5;

/** Filterable kinds, in display order (§4.2). */
const KIND_OPTIONS: InboxKind[] = ['ci', 'review', 'new-pr', 'security', 'stale'];

const SELECT_CLASS =
  'rounded-md border border-border-strong bg-surface px-2 py-1.5 text-sm text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';
const CHECKBOX_LABEL_CLASS = 'inline-flex items-center gap-1.5 text-sm text-text';
const CHECKBOX_CLASS =
  'h-4 w-4 rounded border-border-strong text-accent-info focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';

/**
 * Zero-width space toggled on alternating triage announcements (§6.2, #245).
 *
 * Two consecutive actions can post the IDENTICAL human-readable string — e.g.
 * dismissing two already-read items, which also leaves the unread `role="status"`
 * count unchanged, so this polite region is the only confirmation channel. React
 * would then leave the region's text node byte-for-byte identical, and many
 * screen readers only re-announce a polite region when its text actually changes,
 * so the second confirmation is silently dropped. Toggling this invisible,
 * non-speaking marker by the per-action nonce keeps the audible text "Dismissed"
 * while guaranteeing the region mutates on every action, forcing a re-announce.
 */
const ANNOUNCE_MARKER = '\u200B';

export interface InboxViewProps {
  /** The lifted inbox view-model (one shared {@link useInbox} instance). */
  inbox: UseInboxResult;
  /** Fleet repositories (drive the repo filter dropdown). */
  repos: Repo[];
  /** True while the fleet fetch is in flight (skeleton on first load). */
  loading?: boolean;
  /** Fleet fetch error message; renders an alert + retry instead of the inbox. */
  error?: string | null;
  /** Retry handler for the error state. */
  onRetry?: () => void;
}

export function InboxView({
  inbox,
  repos,
  loading = false,
  error = null,
  onRetry,
}: InboxViewProps): ReactElement {
  const { items, unreadCount, filters, setFilters, markRead, dismiss, restore } = inbox;

  const repoFilterId = useId();
  const kindFilterId = useId();
  // The nonce makes each announcement mutate the live region even when the
  // human-readable text repeats, so screen readers re-announce it (#245).
  const [announcement, setAnnouncement] = useState<{ text: string; nonce: number }>({
    text: '',
    nonce: 0,
  });

  const announce = useCallback((text: string) => {
    setAnnouncement((prev) => ({ text, nonce: prev.nonce + 1 }));
  }, []);

  const handleMarkRead = useCallback(
    (id: string) => {
      markRead(id);
      announce('Marked as read');
    },
    [markRead, announce],
  );
  const handleDismiss = useCallback(
    (id: string) => {
      dismiss(id);
      announce('Dismissed');
    },
    [dismiss, announce],
  );
  const handleRestore = useCallback(
    (id: string) => {
      restore(id);
      announce('Restored');
    },
    [restore, announce],
  );

  function handleRepoChange(event: ChangeEvent<HTMLSelectElement>): void {
    const value = event.target.value;
    setFilters({ repos: value ? [value] : [] });
  }

  function handleKindChange(event: ChangeEvent<HTMLSelectElement>): void {
    const value = event.target.value as InboxKind | '';
    setFilters({ kinds: value ? [value] : [] });
  }

  function clearFilters(): void {
    setFilters({ repos: [], kinds: [], unreadOnly: false, showDismissed: false });
  }

  // `show dismissed` widens the view, so it never triggers the empty-filtered
  // state — only the narrowing filters do (§4.2).
  const narrowingActive =
    filters.repos.length > 0 || filters.kinds.length > 0 || filters.unreadOnly;

  if (error !== null) {
    return (
      <section aria-label="Notifications inbox" className="flex flex-col gap-3">
        <div
          role="alert"
          className="rounded-md border border-[color-mix(in_srgb,var(--color-failure)_30%,var(--color-surface))] bg-[color-mix(in_srgb,var(--color-failure)_10%,var(--color-surface))] px-4 py-3 text-sm text-accent-failure"
        >
          <p className="font-medium">Couldn’t load your inbox.</p>
          <p className="mt-1 text-accent-failure">{error}</p>
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="mt-3 inline-flex items-center rounded border border-[color-mix(in_srgb,var(--color-failure)_30%,var(--color-surface))] px-3 py-1 text-sm font-medium text-accent-failure hover:bg-[color-mix(in_srgb,var(--color-failure)_18%,var(--color-surface))] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              Retry
            </button>
          ) : null}
        </div>
      </section>
    );
  }

  if (loading && items.length === 0) {
    return (
      <section aria-label="Notifications inbox">
        <p role="status" aria-live="polite" className="sr-only">
          Loading inbox…
        </p>
        <ul aria-busy="true" aria-hidden="true" className="flex flex-col gap-2">
          {Array.from({ length: SKELETON_ROWS }, (_, index) => (
            <li
              key={`skeleton-${index}`}
              className="flex items-stretch gap-3 rounded-md border border-border bg-surface p-3"
            >
              <span className="w-1 shrink-0 self-stretch animate-pulse rounded-full bg-border motion-reduce:animate-none" />
              <div className="flex flex-1 flex-col gap-2">
                <span className="block h-3 w-48 animate-pulse rounded bg-border motion-reduce:animate-none" />
                <span className="block h-3 w-32 animate-pulse rounded bg-border motion-reduce:animate-none" />
              </div>
            </li>
          ))}
        </ul>
      </section>
    );
  }

  return (
    <section aria-label="Notifications inbox" className="flex flex-col gap-3">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h2 className="text-sm font-semibold text-text">Inbox</h2>
        <p role="status" aria-live="polite" className="text-sm font-medium text-text-muted">
          {`${unreadCount} unread`}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <label htmlFor={repoFilterId} className="sr-only">
              Filter by repository
            </label>
            <select
              id={repoFilterId}
              value={filters.repos[0] ?? ''}
              onChange={handleRepoChange}
              className={SELECT_CLASS}
            >
              <option value="">All repositories</option>
              {repos.map((repo) => (
                <option key={repo.nameWithOwner} value={repo.nameWithOwner}>
                  {repo.nameWithOwner}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={kindFilterId} className="sr-only">
              Filter by kind
            </label>
            <select
              id={kindFilterId}
              value={filters.kinds[0] ?? ''}
              onChange={handleKindChange}
              className={SELECT_CLASS}
            >
              <option value="">All kinds</option>
              {KIND_OPTIONS.map((kind) => (
                <option key={kind} value={kind}>
                  {KIND_LABELS[kind]}
                </option>
              ))}
            </select>
          </div>
          <label className={CHECKBOX_LABEL_CLASS}>
            <input
              type="checkbox"
              checked={filters.unreadOnly}
              onChange={(event) => setFilters({ unreadOnly: event.target.checked })}
              className={CHECKBOX_CLASS}
            />
            Unread only
          </label>
          <label className={CHECKBOX_LABEL_CLASS}>
            <input
              type="checkbox"
              checked={filters.showDismissed}
              onChange={(event) => setFilters({ showDismissed: event.target.checked })}
              className={CHECKBOX_CLASS}
            />
            Show dismissed
          </label>
        </div>
      </header>

      {items.length === 0 ? (
        narrowingActive ? (
          <div className="flex flex-col items-center gap-3 rounded-md border border-border bg-surface px-4 py-10 text-center">
            <p className="text-sm text-text-muted">No items match these filters.</p>
            <button
              type="button"
              onClick={clearFilters}
              className="inline-flex items-center rounded border border-border-strong px-3 py-1 text-sm font-medium text-text hover:bg-surface-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              Clear filters
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 rounded-md border border-border bg-surface px-4 py-10 text-center">
            <span aria-hidden="true" className="text-2xl text-accent-success">
              ✓
            </span>
            <p className="text-sm text-text-muted">All caught up — nothing needs your attention.</p>
          </div>
        )
      ) : (
        <InboxList
          items={items}
          onMarkRead={handleMarkRead}
          onDismiss={handleDismiss}
          onRestore={handleRestore}
        />
      )}

      <div aria-live="polite" className="sr-only">
        {announcement.text}
        <span>{ANNOUNCE_MARKER.repeat(announcement.nonce % 2)}</span>
      </div>
    </section>
  );
}
