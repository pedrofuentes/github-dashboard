/**
 * `useInbox` — the Notifications Inbox view-model (DESIGN-INBOX §7).
 *
 * Composes the two pure pieces built earlier into the list the Inbox renders:
 * the {@link deriveInboxItems} transform (INBOX-3) over the fleet's already-
 * fetched signal data, and the per-device triage store (INBOX-4) holding the
 * read / dismissed id-sets and the "last visited" watermark. It issues **no**
 * GitHub request — it reads the same `getRowData` seam the grid and dashboard
 * consume — and it never throws on empty or missing triage (the store already
 * degrades to {@link DEFAULT_TRIAGE}).
 *
 * For every derived item it computes:
 * - **read** / **dismissed** — membership in the persisted id-sets (§3.1);
 * - **isNew** ("new since last visit") — `item.timestamp` strictly after the
 *   watermark captured when the Inbox was opened, **independent of read state**;
 *   a `null` watermark (first-ever visit) means nothing is new (§3.1).
 *
 * It also surfaces the fleet-wide **unread count** (the §7 badge, independent of
 * the active filters), keeps items newest-first (derivation already sorts), and
 * applies the four §4.2 filters as **session view-state that is never persisted**.
 * Triage mutations persist through {@link saveInboxTriage}, pruned against the
 * live derived ids so storage cannot grow unbounded (§3.3).
 */
import { useCallback, useMemo, useState } from 'react';

import { deriveInboxItems } from '../lib/inbox/derive';
import {
  loadInboxTriage,
  pruneTriage,
  saveInboxTriage,
  type InboxTriage,
} from '../lib/inbox/triage-store';
import type { InboxItem, InboxKind } from '../types/inbox';
import type { GetRowData, Repo } from '../types/fleet';

/** A derived item decorated with its per-device triage state (§3.1). */
export interface InboxItemView extends InboxItem {
  /** `true` when the item's id is in the persisted read set. */
  read: boolean;
  /** `true` when the item's id is in the persisted dismissed set. */
  dismissed: boolean;
  /** Arrived strictly after the watermark captured on open; never set on a null watermark. */
  isNew: boolean;
}

/**
 * The four client-side filters (§4.2). Compose AND across categories, OR within
 * each. An empty `repos` / `kinds` array means "no narrowing" for that category.
 * Filter state is session UI state and is never persisted.
 */
export interface InboxFilters {
  /** `nameWithOwner`s to keep; empty keeps every repository. */
  repos: string[];
  /** Kinds to keep; empty keeps every kind. */
  kinds: InboxKind[];
  /** Hide read items when `true`. */
  unreadOnly: boolean;
  /** Reveal dismissed items when `true` (hidden by default). */
  showDismissed: boolean;
}

/** Public shape returned by {@link useInbox}. */
export interface UseInboxResult {
  /** Filtered, newest-first items, each decorated with its triage state. */
  items: InboxItemView[];
  /** Non-dismissed unread items across the whole fleet — the §7 badge count, filter-independent. */
  unreadCount: number;
  /** The active (session-only) filter state. */
  filters: InboxFilters;
  /** Merges a partial patch into the filter state; never persisted. */
  setFilters: (patch: Partial<InboxFilters>) => void;
  /** Marks one item read and persists. */
  markRead: (id: string) => void;
  /** Dismisses (archives) one item and persists. */
  dismiss: (id: string) => void;
  /** Restores a previously dismissed item and persists. */
  restore: (id: string) => void;
  /** Marks every derived item read and persists. */
  markAllRead: () => void;
  /** Advances the watermark to now (the on-open action) and persists. */
  markAllSeen: () => void;
}

/** The default, unfiltered view-state — every item visible. */
const DEFAULT_FILTERS: InboxFilters = {
  repos: [],
  kinds: [],
  unreadOnly: false,
  showDismissed: false,
};

/**
 * Builds the Inbox view-model from the fleet and its `getRowData` seam.
 *
 * @param repos - The fleet repositories (same list the grid/dashboard receive).
 * @param getRowData - Resolves each repo's already-fetched signal data; no fetch.
 */
export function useInbox(repos: Repo[], getRowData: GetRowData): UseInboxResult {
  const [triage, setTriage] = useState<InboxTriage>(loadInboxTriage);
  // The watermark as it stood when the Inbox was opened. Captured once so the
  // "new since last visit" highlight is stable for this visit even after the
  // stored watermark advances — it clears only on the next open (§3.1).
  const [visitBaseline] = useState<string | null>(() => triage.lastVisitedAt);
  const [filters, setFiltersState] = useState<InboxFilters>(DEFAULT_FILTERS);

  const derived = useMemo(() => deriveInboxItems(repos, getRowData), [repos, getRowData]);
  const liveIds = useMemo(() => derived.map((item) => item.id), [derived]);

  const baselineInstant = useMemo(
    () => (visitBaseline === null ? null : Date.parse(visitBaseline)),
    [visitBaseline],
  );

  // Prune against the live ids on every write so a resolved run / merged PR /
  // fixed alert forgets its triage mark — storage stays bounded (§3.3).
  const persistTriage = useCallback(
    (next: InboxTriage) => {
      const pruned = pruneTriage(next, liveIds);
      saveInboxTriage(pruned);
      setTriage(pruned);
    },
    [liveIds],
  );

  const markRead = useCallback(
    (id: string) => {
      if (triage.readIds.includes(id)) {
        return;
      }
      persistTriage({ ...triage, readIds: [...triage.readIds, id] });
    },
    [triage, persistTriage],
  );

  const dismiss = useCallback(
    (id: string) => {
      if (triage.dismissedIds.includes(id)) {
        return;
      }
      persistTriage({ ...triage, dismissedIds: [...triage.dismissedIds, id] });
    },
    [triage, persistTriage],
  );

  const restore = useCallback(
    (id: string) => {
      if (!triage.dismissedIds.includes(id)) {
        return;
      }
      persistTriage({
        ...triage,
        dismissedIds: triage.dismissedIds.filter((dismissedId) => dismissedId !== id),
      });
    },
    [triage, persistTriage],
  );

  const markAllRead = useCallback(() => {
    const newlyRead = liveIds.filter((id) => !triage.readIds.includes(id));
    persistTriage({ ...triage, readIds: [...triage.readIds, ...newlyRead] });
  }, [triage, liveIds, persistTriage]);

  const markAllSeen = useCallback(() => {
    persistTriage({ ...triage, lastVisitedAt: new Date().toISOString() });
  }, [triage, persistTriage]);

  const setFilters = useCallback((patch: Partial<InboxFilters>) => {
    setFiltersState((previous) => ({ ...previous, ...patch }));
  }, []);

  const views = useMemo<InboxItemView[]>(() => {
    const readSet = new Set(triage.readIds);
    const dismissedSet = new Set(triage.dismissedIds);
    return derived.map((item) => ({
      ...item,
      read: readSet.has(item.id),
      dismissed: dismissedSet.has(item.id),
      isNew: baselineInstant !== null && Date.parse(item.timestamp) > baselineInstant,
    }));
  }, [derived, triage.readIds, triage.dismissedIds, baselineInstant]);

  const unreadCount = useMemo(
    () => views.reduce((count, item) => (!item.dismissed && !item.read ? count + 1 : count), 0),
    [views],
  );

  const items = useMemo<InboxItemView[]>(() => {
    const repoSet = new Set(filters.repos);
    const kindSet = new Set(filters.kinds);
    return views.filter((item) => {
      if (repoSet.size > 0 && !repoSet.has(item.repo.nameWithOwner)) {
        return false;
      }
      if (kindSet.size > 0 && !kindSet.has(item.kind)) {
        return false;
      }
      if (!filters.showDismissed && item.dismissed) {
        return false;
      }
      if (filters.unreadOnly && item.read) {
        return false;
      }
      return true;
    });
  }, [views, filters]);

  return {
    items,
    unreadCount,
    filters,
    setFilters,
    markRead,
    dismiss,
    restore,
    markAllRead,
    markAllSeen,
  };
}
