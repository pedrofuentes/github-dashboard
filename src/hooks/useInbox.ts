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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { deriveInboxItems } from '../lib/inbox/derive';
import { parseInboxId } from '../lib/inbox/ids';
import {
  loadInboxTriage,
  pruneTriage,
  saveInboxTriage,
  type InboxTriage,
} from '../lib/inbox/triage-store';
import type { InboxItem, InboxKind } from '../types/inbox';
import type { GetRowData, Repo, RepoSignalData } from '../types/fleet';

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
  /**
   * Marks every given id read in ONE persisted triage update (not one per id),
   * affecting only those ids. Idempotent: already-read ids are skipped and an
   * empty array is a no-op.
   */
  markReadMany: (ids: string[]) => void;
  /**
   * Dismisses every given id in ONE persisted triage update, affecting only
   * those ids. Idempotent; an empty array is a no-op.
   */
  dismissMany: (ids: string[]) => void;
  /**
   * Restores every given dismissed id in ONE persisted triage update. Ids that
   * were not dismissed are ignored; an empty array is a no-op.
   */
  restoreMany: (ids: string[]) => void;
  /** Marks every derived item read and persists. */
  markAllRead: () => void;
  /** Advances the watermark to now (the on-open action) and persists. */
  markAllSeen: () => void;
}

/**
 * The default, unfiltered view-state. Every category is open (no repo/kind
 * narrowing, read items shown), so every **non-dismissed** item is visible —
 * `showDismissed: false` hides dismissed items until the filter is toggled on.
 */
const DEFAULT_FILTERS: InboxFilters = {
  repos: [],
  kinds: [],
  unreadOnly: false,
  showDismissed: false,
};

/**
 * Value-equality for triage so the teardown flush can skip a redundant write
 * when storage already reflects the current state — preserving the "opening the
 * Inbox never writes" property (§3.1). Insertion order is significant (the store
 * caps LRU-style from the front), so the id arrays are compared element-wise.
 */
function triageEquals(a: InboxTriage, b: InboxTriage): boolean {
  return (
    a.lastVisitedAt === b.lastVisitedAt &&
    a.readIds.length === b.readIds.length &&
    a.dismissedIds.length === b.dismissedIds.length &&
    a.readIds.every((id, index) => id === b.readIds[index]) &&
    a.dismissedIds.every((id, index) => id === b.dismissedIds[index])
  );
}

/**
 * The inbox-relevant signal slices paired with the {@link InboxKind} their items
 * carry. `issues` is intentionally absent — a raw issue count never becomes an
 * item (§1), so it has no triage scope to protect.
 */
const SLICE_KINDS: ReadonlyArray<readonly [keyof RepoSignalData, InboxKind]> = [
  ['ci', 'ci'],
  ['reviews', 'review'],
  ['pullRequests', 'new-pr'],
  ['security', 'security'],
  ['stale', 'stale'],
];

/**
 * Keys a triage scope by `(kind, repo)`. The `\u0000` separator cannot occur in
 * either an {@link InboxKind} literal or a `nameWithOwner`, so the join is
 * unambiguous.
 */
function scopeKey(kind: InboxKind, repo: string): string {
  return `${kind}\u0000${repo}`;
}

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

  // Scopes whose signal slice is not `ready` this refresh (loading / error /
  // unknown / absent). An item in such a scope is not derived, so its id drops
  // out of `liveIds` — but the failure is transient, so its triage mark must be
  // protected from GC rather than silently forgotten (#249).
  const unreadyScopes = useMemo(() => {
    const scopes = new Set<string>();
    for (const repo of repos) {
      const data = getRowData(repo);
      for (const [slice, kind] of SLICE_KINDS) {
        if (data[slice]?.status !== 'ready') {
          scopes.add(scopeKey(kind, repo.nameWithOwner));
        }
      }
    }
    return scopes;
  }, [repos, getRowData]);

  // Retains a triage id whose item is currently underived only because its slice
  // is unready (a transient fetch failure), so a momentary error does not lose
  // triage (#249). A resolved item — slice `ready`, id simply gone — is in a
  // ready scope and still GCs normally.
  const isUnreadyScope = useCallback(
    (id: string): boolean => {
      const parsed = parseInboxId(id);
      return parsed !== null && unreadyScopes.has(scopeKey(parsed.kind, parsed.repo));
    },
    [unreadyScopes],
  );

  const baselineInstant = useMemo(
    () => (visitBaseline === null ? null : Date.parse(visitBaseline)),
    [visitBaseline],
  );

  // Apply a pure triage mutation through a functional state update so several
  // actions batched into one React commit compose against the latest state
  // instead of a shared pre-batch closure — no write can clobber another in the
  // same commit. Each result is pruned against the live ids so a resolved run /
  // merged PR / fixed alert forgets its triage mark and storage stays bounded
  // (§3.3). A transiently-failing slice's marks are protected from that GC
  // (#249), and a `lastVisitedAt` past the §3.3 horizon resets (#233). A
  // mutation that returns `prev` unchanged is a no-op: React bails out, so there
  // is no re-render and no persist (preserving the dedupe guards).
  const applyTriage = useCallback(
    (mutate: (prev: InboxTriage) => InboxTriage) => {
      setTriage((prev) => {
        const next = mutate(prev);
        return next === prev
          ? prev
          : pruneTriage(next, liveIds, { protect: isUnreadyScope, now: Date.now() });
      });
    },
    [liveIds, isUnreadyScope],
  );

  // Persist the committed (already-pruned) triage once per change, after render.
  // Keeping the write out of the `setTriage` updater leaves the updater pure, so
  // React StrictMode's double-invocation can't double-write. The mount run is
  // skipped (the ref starts equal to the loaded value), so merely opening the
  // Inbox never writes — only real triage actions persist (§3.1).
  const lastPersisted = useRef(triage);
  useEffect(() => {
    if (triage === lastPersisted.current) {
      return;
    }
    lastPersisted.current = triage;
    saveInboxTriage(triage);
  }, [triage]);

  // Mirror the latest committed triage into a ref so the teardown listeners can
  // flush the newest value without re-subscribing on every render. Assigned
  // during render (not in an effect) so it is current even when the passive
  // persistence effect above has not run yet — exactly the window a hard
  // teardown falls into.
  const triageRef = useRef(triage);
  triageRef.current = triage;

  // Belt-and-suspenders persistence for the teardown window. The un-debounced
  // effect above writes in React's passive phase, after paint; a hard close /
  // navigate / reload tears the page down first, dropping the last write so the
  // item reverts on the next load (#241). Re-persist synchronously when the page
  // is being torn down. Gated on the stored value so merely opening the Inbox
  // (storage already matches the loaded triage) never writes — a no-op flush,
  // mirroring useDashboardLayout's `persist.flush()` (#127/#141).
  const flushTriage = useCallback(() => {
    const current = triageRef.current;
    if (triageEquals(loadInboxTriage(), current)) {
      return;
    }
    lastPersisted.current = current;
    saveInboxTriage(current);
  }, []);

  // A hard page close/navigate/reload does NOT unmount React, so the unmount
  // cleanup never runs. Flush the latest triage on `beforeunload` and on
  // `visibilitychange` -> hidden (tab freeze/discard) so it survives teardown.
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        flushTriage();
      }
    };
    window.addEventListener('beforeunload', flushTriage);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('beforeunload', flushTriage);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [flushTriage]);

  // Flush on React unmount too (e.g. switching views right after a triage
  // action) so the last change is never lost.
  useEffect(() => () => flushTriage(), [flushTriage]);

  const markRead = useCallback(
    (id: string) => {
      applyTriage((prev) =>
        prev.readIds.includes(id) ? prev : { ...prev, readIds: [...prev.readIds, id] },
      );
    },
    [applyTriage],
  );

  const dismiss = useCallback(
    (id: string) => {
      applyTriage((prev) =>
        prev.dismissedIds.includes(id)
          ? prev
          : { ...prev, dismissedIds: [...prev.dismissedIds, id] },
      );
    },
    [applyTriage],
  );

  const restore = useCallback(
    (id: string) => {
      applyTriage((prev) =>
        prev.dismissedIds.includes(id)
          ? { ...prev, dismissedIds: prev.dismissedIds.filter((dismissedId) => dismissedId !== id) }
          : prev,
      );
    },
    [applyTriage],
  );

  const markReadMany = useCallback(
    (ids: string[]) => {
      applyTriage((prev) => {
        const seen = new Set(prev.readIds);
        const toAdd: string[] = [];
        for (const id of ids) {
          if (!seen.has(id)) {
            seen.add(id);
            toAdd.push(id);
          }
        }
        return toAdd.length === 0 ? prev : { ...prev, readIds: [...prev.readIds, ...toAdd] };
      });
    },
    [applyTriage],
  );

  const dismissMany = useCallback(
    (ids: string[]) => {
      applyTriage((prev) => {
        const seen = new Set(prev.dismissedIds);
        const toAdd: string[] = [];
        for (const id of ids) {
          if (!seen.has(id)) {
            seen.add(id);
            toAdd.push(id);
          }
        }
        return toAdd.length === 0
          ? prev
          : { ...prev, dismissedIds: [...prev.dismissedIds, ...toAdd] };
      });
    },
    [applyTriage],
  );

  const restoreMany = useCallback(
    (ids: string[]) => {
      applyTriage((prev) => {
        const removeSet = new Set(ids);
        const next = prev.dismissedIds.filter((id) => !removeSet.has(id));
        return next.length === prev.dismissedIds.length ? prev : { ...prev, dismissedIds: next };
      });
    },
    [applyTriage],
  );

  const markAllRead = useCallback(() => {
    applyTriage((prev) => ({
      ...prev,
      readIds: [...prev.readIds, ...liveIds.filter((id) => !prev.readIds.includes(id))],
    }));
  }, [applyTriage, liveIds]);

  const markAllSeen = useCallback(() => {
    applyTriage((prev) => ({ ...prev, lastVisitedAt: new Date().toISOString() }));
  }, [applyTriage]);

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
    markReadMany,
    dismissMany,
    restoreMany,
    markAllRead,
    markAllSeen,
  };
}
