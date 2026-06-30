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
import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import type { ChangeEvent, ReactElement } from 'react';

import type { UseInboxResult } from '../../hooks/useInbox';
import type { Repo } from '../../types/fleet';
import type { InboxKind } from '../../types/inbox';
import { InboxBulkBar } from './InboxBulkBar';
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
 * screen readers only re-announce a polite region when its content actually
 * changes, so the second confirmation is silently dropped. Toggling this
 * invisible, non-speaking marker by the per-action nonce keeps the audible text
 * "Dismissed" while guaranteeing the region's content mutates on every action.
 *
 * The mutation is only half the fix: the region must also be `aria-atomic="true"`
 * so screen readers re-read the WHOLE region — the human-readable words plus this
 * marker — rather than only the changed (silent) marker node. Without atomic
 * re-reading the mutation would announce just the zero-width space, dropping the
 * repeated "Dismissed" words and leaving #245 unfixed.
 */
const ANNOUNCE_MARKER = '\u200B';

export interface InboxViewProps {
  /** The lifted inbox view-model (one shared {@link useInbox} instance). */
  inbox: UseInboxResult;
  /**
   * Repositories for the repo filter dropdown. When a global repo scope is
   * active, this is the filtered subset; otherwise it's the full fleet.
   */
  repos: Repo[];
  /**
   * Active GLOBAL repo scope (ADR-027). When provided (non-empty set), only
   * items whose repo is in this set are rendered, scoping the Inbox to match
   * the filtered view. `undefined` means no scope filter (show all fleet items).
   * An empty set would scope to zero repos. Fleet-wide triage state and unread
   * badge are left untouched — this scopes presentation only, so switching scope
   * never mutates read/dismissed marks.
   */
  repoScope?: ReadonlySet<string>;
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
  repoScope,
  loading = false,
  error = null,
  onRetry,
}: InboxViewProps): ReactElement {
  const { items, unreadCount, filters, setFilters, markRead, dismiss, restore } = inbox;
  const { markReadMany, dismissMany, restoreMany } = inbox;
  const availableRepoNames = useMemo(
    () => new Set(repos.map((repo) => repo.nameWithOwner)),
    [repos],
  );
  const selectedRepoFilter = filters.repos.find((repoName) => availableRepoNames.has(repoName));

  useEffect(() => {
    if (filters.repos.length === 0) {
      return;
    }
    // Do not reconcile when the repo list is transiently empty (fleet-load error):
    // clearing every selected repo would wipe the filter before it can reload.
    if (repos.length === 0) {
      return;
    }

    const availableSelection = filters.repos.filter((repoName) => availableRepoNames.has(repoName));
    if (availableSelection.length !== filters.repos.length) {
      setFilters({ repos: availableSelection });
    }
  }, [availableRepoNames, filters.repos, repos.length, setFilters]);

  // Apply the global repo scope on top of the inbox's own session filters: it is
  // a presentation-only narrowing, so the hook's triage GC and fleet-wide unread
  // badge stay computed over the whole fleet (ADR-027).
  const scopedItems = useMemo(
    () =>
      repoScope === undefined
        ? items
        : items.filter((item) => repoScope.has(item.repo.nameWithOwner)),
    [items, repoScope],
  );

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

  // Multi-select state lives here (ADR-027: selection is presentation-only). The
  // ids of every currently-visible row, used to drive Select-all and to prune the
  // selection so a bulk action can never target a hidden (filtered/scoped) item.
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const visibleIds = useMemo(() => scopedItems.map((item) => item.id), [scopedItems]);

  // Drop any selected id that is no longer visible whenever the visible set
  // changes (filter/scope change, or an item hidden after a dismiss) so a bulk
  // action only ever targets currently-visible items.
  useEffect(() => {
    const visible = new Set(visibleIds);
    setSelected((prev) => {
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (visible.has(id)) {
          next.add(id);
        } else {
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [visibleIds]);

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelected(new Set(visibleIds));
  }, [visibleIds]);

  const clearSelection = useCallback(() => {
    setSelected(new Set());
  }, []);

  // The selected items that are still visible drive the bulk-bar enablement: a
  // batch only acts where it can meaningfully apply.
  const selectedVisible = useMemo(
    () => scopedItems.filter((item) => selected.has(item.id)),
    [scopedItems, selected],
  );
  const canMarkRead = selectedVisible.some((item) => !item.read);
  const canDismiss = selectedVisible.some((item) => !item.dismissed);
  const canRestore = selectedVisible.some((item) => item.dismissed);

  const handleBulkMarkRead = useCallback(() => {
    const ids = [...selected];
    const changedCount = selectedVisible.filter((item) => !item.read).length;
    markReadMany(ids);
    announce(`Marked ${changedCount} as read`);
    setSelected(new Set());
  }, [selected, selectedVisible, markReadMany, announce]);

  const handleBulkDismiss = useCallback(() => {
    const ids = [...selected];
    const changedCount = selectedVisible.filter((item) => !item.dismissed).length;
    dismissMany(ids);
    announce(`Dismissed ${changedCount} items`);
    setSelected(new Set());
  }, [selected, selectedVisible, dismissMany, announce]);

  const handleBulkRestore = useCallback(() => {
    const ids = [...selected];
    const changedCount = selectedVisible.filter((item) => item.dismissed).length;
    restoreMany(ids);
    announce(`Restored ${changedCount} items`);
    setSelected(new Set());
  }, [selected, selectedVisible, restoreMany, announce]);

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
    repoScope !== undefined ||
    filters.repos.length > 0 ||
    filters.kinds.length > 0 ||
    filters.unreadOnly;

  // clearFilters() only resets the session filters — it cannot clear the global
  // repoScope (owned by App). Show the button only when there is at least one
  // user-set filter that clearing would actually remove; suppress it when the
  // only narrowing is from the scope alone, where the button would be a no-op.
  const clearableFiltersActive =
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
              value={selectedRepoFilter ?? ''}
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

      {scopedItems.length === 0 ? (
        narrowingActive ? (
          <div className="flex flex-col items-center gap-3 rounded-md border border-border bg-surface px-4 py-10 text-center">
            <p className="text-sm text-text-muted">No items match these filters.</p>
            {clearableFiltersActive ? (
              <button
                type="button"
                onClick={clearFilters}
                className="inline-flex items-center rounded border border-border-strong px-3 py-1 text-sm font-medium text-text hover:bg-surface-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
              >
                Clear filters
              </button>
            ) : null}
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
        <>
          {selected.size > 0 ? (
            <InboxBulkBar
              count={selected.size}
              canMarkRead={canMarkRead}
              canDismiss={canDismiss}
              canRestore={canRestore}
              onMarkRead={handleBulkMarkRead}
              onDismiss={handleBulkDismiss}
              onRestore={handleBulkRestore}
              onSelectAll={selectAll}
              onClear={clearSelection}
            />
          ) : null}
          <InboxList
            items={scopedItems}
            onMarkRead={handleMarkRead}
            onDismiss={handleDismiss}
            onRestore={handleRestore}
            selectedIds={selected}
            onToggleSelect={toggleSelect}
          />
        </>
      )}

      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement.text}
        <span>{ANNOUNCE_MARKER.repeat(announcement.nonce % 2)}</span>
      </div>
    </section>
  );
}
