import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { GetRowData, Repo, RepoSignalData } from '../types/fleet';
import { loadInboxTriage, saveInboxTriage } from '../lib/inbox/triage-store';
import { useInbox } from './useInbox';

/** The namespaced key the triage store persists under (§3.2). */
const TRIAGE_KEY = 'fleet:inbox-triage';

function makeRepo(nameWithOwner: string, isPrivate = false): Repo {
  const [owner, name] = nameWithOwner.split('/');
  return { nameWithOwner, owner, name, isPrivate };
}

/** Build a `getRowData` that reads from a fixed map, defaulting to empty data. */
function fixtureGetRowData(rows: Map<string, RepoSignalData>): GetRowData {
  return (repo) => rows.get(repo.nameWithOwner) ?? {};
}

const ALPHA = makeRepo('octocat/alpha');
const BRAVO = makeRepo('octocat/bravo');
const REPOS: Repo[] = [ALPHA, BRAVO];

// Stable ids the derived fixture produces (mirrors the §2.2 grammar / derive).
const ID_SECURITY = 'security:octocat/alpha:dependabot:7'; // 2024-03-13 (newest)
const ID_NEW_PR = 'new-pr:octocat/bravo:#108'; //              2024-03-12
const ID_REVIEW = 'review:octocat/alpha:#42'; //              2024-03-11
const ID_CI = 'ci:octocat/alpha:100'; //                      2024-03-10
const ID_STALE = 'stale:octocat/bravo:issue:#13'; //          2024-01-01 (oldest)

/** Newest-first order `deriveInboxItems` yields for {@link fixtureRows}. */
const NEWEST_FIRST = [ID_SECURITY, ID_NEW_PR, ID_REVIEW, ID_CI, ID_STALE];

/**
 * A two-repo fleet with one item of each kind:
 * - `alpha` → ci, review, security
 * - `bravo` → new-pr, stale
 * Distinct timestamps let a watermark fall between them.
 */
function fixtureRows(): Map<string, RepoSignalData> {
  return new Map<string, RepoSignalData>([
    [
      ALPHA.nameWithOwner,
      {
        ci: {
          status: 'ready',
          conclusion: 'failure',
          failingCount: 1,
          latestRunUrl: 'https://github.com/octocat/alpha/actions/runs/100',
          runId: 100,
          updatedAt: '2024-03-10T10:00:00Z',
        },
        reviews: {
          status: 'ready',
          requestedCount: 1,
          requests: [
            {
              number: 42,
              title: 'Review me',
              html_url: 'https://github.com/octocat/alpha/pull/42',
              created_at: '2024-03-11T09:00:00Z',
              user_login: 'reviewer',
            },
          ],
        },
        security: {
          status: 'ready',
          grade: 'F',
          counts: { critical: 1, high: 0, medium: 0, low: 0 },
          alerts: [
            {
              number: 7,
              type: 'dependabot',
              severity: 'critical',
              html_url: 'https://github.com/octocat/alpha/security/dependabot/7',
              created_at: '2024-03-13T07:00:00Z',
            },
          ],
        },
      },
    ],
    [
      BRAVO.nameWithOwner,
      {
        pullRequests: {
          status: 'ready',
          openCount: 3,
          externalCount: 1,
          externalPullRequests: [
            {
              number: 108,
              title: 'Add a feature',
              html_url: 'https://github.com/octocat/bravo/pull/108',
              created_at: '2024-03-12T08:00:00Z',
              user_login: 'newbie',
              author_association: 'FIRST_TIME_CONTRIBUTOR',
            },
          ],
        },
        stale: {
          status: 'ready',
          staleCount: 1,
          staleItems: [
            {
              number: 13,
              title: 'Ancient issue',
              html_url: 'https://github.com/octocat/bravo/issues/13',
              updated_at: '2024-01-01T00:00:00Z',
              type: 'issue',
            },
          ],
        },
      },
    ],
  ]);
}

function renderInbox(repos: Repo[] = REPOS, rows: Map<string, RepoSignalData> = fixtureRows()) {
  return renderHook(() => useInbox(repos, fixtureGetRowData(rows)));
}

/** Look an item up by id in the hook's current (filtered) view. */
function viewById(items: ReturnType<typeof useInbox>['items'], id: string) {
  return items.find((item) => item.id === id);
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('useInbox — triage state & actions (AC-11)', () => {
  it('derives items newest-first and starts everything unread', () => {
    const { result } = renderInbox();

    expect(result.current.items.map((item) => item.id)).toEqual(NEWEST_FIRST);
    expect(result.current.unreadCount).toBe(5);
    for (const item of result.current.items) {
      expect(item.read).toBe(false);
      expect(item.dismissed).toBe(false);
    }
  });

  it('markRead marks one item read, drops the unread count, and persists', () => {
    const { result } = renderInbox();

    act(() => {
      result.current.markRead(ID_SECURITY);
    });

    expect(viewById(result.current.items, ID_SECURITY)?.read).toBe(true);
    expect(result.current.unreadCount).toBe(4);
    // Assert persistence via the reloaded store value, never a setItem spy (#124).
    expect(loadInboxTriage().readIds).toContain(ID_SECURITY);
  });

  it('dismiss hides the item by default, removes it from unread, and persists', () => {
    const { result } = renderInbox();

    act(() => {
      result.current.dismiss(ID_NEW_PR);
    });

    expect(viewById(result.current.items, ID_NEW_PR)).toBeUndefined();
    expect(result.current.items).toHaveLength(4);
    expect(result.current.unreadCount).toBe(4);
    expect(loadInboxTriage().dismissedIds).toContain(ID_NEW_PR);
  });

  it('restore brings a dismissed item back and persists the removal', () => {
    const { result } = renderInbox();

    act(() => {
      result.current.dismiss(ID_NEW_PR);
    });
    act(() => {
      result.current.restore(ID_NEW_PR);
    });

    const restored = viewById(result.current.items, ID_NEW_PR);
    expect(restored?.dismissed).toBe(false);
    expect(result.current.items).toHaveLength(5);
    expect(result.current.unreadCount).toBe(5);
    expect(loadInboxTriage().dismissedIds).not.toContain(ID_NEW_PR);
  });

  it('markAllRead marks every derived item read, zeros the unread count, and persists', () => {
    const { result } = renderInbox();

    act(() => {
      result.current.markAllRead();
    });

    for (const item of result.current.items) {
      expect(item.read).toBe(true);
    }
    expect(result.current.unreadCount).toBe(0);
    expect(loadInboxTriage().readIds).toEqual(expect.arrayContaining(NEWEST_FIRST));
  });

  it('"new since last visit" is driven by lastVisitedAt and is independent of read state', () => {
    // A watermark between review (03-11) and new-pr (03-12): only items that
    // arrived strictly after it are "new".
    saveInboxTriage({ readIds: [], dismissedIds: [], lastVisitedAt: '2024-03-11T12:00:00Z' });
    const { result } = renderInbox();

    const isNew = Object.fromEntries(result.current.items.map((item) => [item.id, item.isNew]));
    expect(isNew[ID_SECURITY]).toBe(true);
    expect(isNew[ID_NEW_PR]).toBe(true);
    expect(isNew[ID_REVIEW]).toBe(false);
    expect(isNew[ID_CI]).toBe(false);
    expect(isNew[ID_STALE]).toBe(false);

    // Reading a "new" item must not clear its "new since last visit" highlight.
    act(() => {
      result.current.markRead(ID_SECURITY);
    });
    expect(viewById(result.current.items, ID_SECURITY)?.read).toBe(true);
    expect(viewById(result.current.items, ID_SECURITY)?.isNew).toBe(true);
  });

  it('treats a null watermark (first-ever visit) as nothing being new', () => {
    const { result } = renderInbox();

    expect(loadInboxTriage().lastVisitedAt).toBeNull();
    for (const item of result.current.items) {
      expect(item.isNew).toBe(false);
    }
  });

  it('markAllSeen advances + persists the watermark (the on-open action); a later visit clears the highlights', () => {
    saveInboxTriage({ readIds: [], dismissedIds: [], lastVisitedAt: '2024-03-11T12:00:00Z' });
    const { result } = renderInbox();
    expect(viewById(result.current.items, ID_SECURITY)?.isNew).toBe(true);

    const before = Date.now();
    act(() => {
      result.current.markAllSeen();
    });
    const after = Date.now();

    const persisted = loadInboxTriage().lastVisitedAt;
    expect(persisted).not.toBeNull();
    const advanced = Date.parse(persisted as string);
    expect(advanced).toBeGreaterThanOrEqual(before);
    expect(advanced).toBeLessThanOrEqual(after);

    // The highlight is stable for the current visit ("highlighted exactly once").
    expect(viewById(result.current.items, ID_SECURITY)?.isNew).toBe(true);

    // The next visit reads the advanced watermark, so nothing is new anymore.
    const next = renderInbox();
    for (const item of next.result.current.items) {
      expect(item.isNew).toBe(false);
    }
  });

  it('is idempotent: repeated markRead / dismiss never accumulate duplicate ids', () => {
    // The early-return guards keep the id-sets duplicate-free; without them a
    // repeated click would append the same id and grow storage unbounded (§3.3).
    // Each action runs in its own act() so the second call sees the committed
    // state (a stale closure within one render would bypass the guard).
    const { result } = renderInbox();

    act(() => {
      result.current.markRead(ID_CI);
    });
    act(() => {
      result.current.markRead(ID_CI);
    });
    act(() => {
      result.current.dismiss(ID_NEW_PR);
    });
    act(() => {
      result.current.dismiss(ID_NEW_PR);
    });
    // Restoring an item that was never dismissed is a harmless no-op.
    act(() => {
      result.current.restore(ID_STALE);
    });

    const persisted = loadInboxTriage();
    expect(persisted.readIds.filter((id) => id === ID_CI)).toHaveLength(1);
    expect(persisted.dismissedIds.filter((id) => id === ID_NEW_PR)).toHaveLength(1);
    expect(persisted.dismissedIds).not.toContain(ID_STALE);
  });

  it('markAllRead is idempotent: a second call adds no duplicate read ids (#242)', () => {
    // Calling markAllRead twice (each in its own commit, so the second sees the
    // first's committed state) must not re-append already-read ids — the
    // duplicate-free guard keeps storage bounded (§3.3).
    const { result } = renderInbox();

    act(() => {
      result.current.markAllRead();
    });
    act(() => {
      result.current.markAllRead();
    });

    const persisted = loadInboxTriage();
    expect([...persisted.readIds].sort()).toEqual([...NEWEST_FIRST].sort());
    for (const id of NEWEST_FIRST) {
      expect(persisted.readIds.filter((readId) => readId === id)).toHaveLength(1);
    }
    expect(result.current.unreadCount).toBe(0);
  });

  it('prunes triage marks for ids no longer derived when it persists', () => {
    // A stale read mark whose item is no longer in the fleet must be GC'd on the
    // next persist so storage cannot grow unbounded (§3.3).
    saveInboxTriage({
      readIds: ['ci:octocat/ghost:1'],
      dismissedIds: [],
      lastVisitedAt: null,
    });
    const { result } = renderInbox();

    act(() => {
      result.current.markRead(ID_CI);
    });

    const persisted = loadInboxTriage();
    expect(persisted.readIds).toContain(ID_CI);
    expect(persisted.readIds).not.toContain('ci:octocat/ghost:1');
  });

  it('does not throw on an empty fleet or missing/corrupt triage', () => {
    localStorage.setItem(TRIAGE_KEY, '{ not valid json');

    const empty = renderInbox([], new Map());
    expect(empty.result.current.items).toEqual([]);
    expect(empty.result.current.unreadCount).toBe(0);
    expect(() => {
      act(() => {
        empty.result.current.markAllRead();
        empty.result.current.markAllSeen();
      });
    }).not.toThrow();

    // Corrupt storage degrades to the default (everything unread), never throws.
    const corrupt = renderInbox();
    expect(corrupt.result.current.unreadCount).toBe(5);
  });
});

describe('useInbox — batched triage actions in one commit all survive (regression)', () => {
  // Two triage actions dispatched in the SAME React commit must each compose
  // against the latest state — neither the persisted write nor the in-memory
  // update may clobber the other. A render-scoped read-modify-write reads the
  // same pre-batch snapshot twice, so the second action silently drops the
  // first (§3.1 triage persistence). These lock that regression shut.

  it('preserves both marks when two markRead calls share one commit', () => {
    const { result } = renderInbox();

    act(() => {
      result.current.markRead(ID_SECURITY);
      result.current.markRead(ID_NEW_PR);
    });

    // The reloaded store must hold BOTH reads, not just the last writer.
    const persisted = loadInboxTriage();
    expect(persisted.readIds).toContain(ID_SECURITY);
    expect(persisted.readIds).toContain(ID_NEW_PR);

    // The live view agrees and the badge dropped by two (5 → 3).
    expect(viewById(result.current.items, ID_SECURITY)?.read).toBe(true);
    expect(viewById(result.current.items, ID_NEW_PR)?.read).toBe(true);
    expect(result.current.unreadCount).toBe(3);
  });

  it('preserves a read and a dismiss batched into one commit', () => {
    const { result } = renderInbox();

    act(() => {
      result.current.markRead(ID_SECURITY);
      result.current.dismiss(ID_NEW_PR);
    });

    const persisted = loadInboxTriage();
    expect(persisted.readIds).toContain(ID_SECURITY);
    expect(persisted.dismissedIds).toContain(ID_NEW_PR);

    expect(viewById(result.current.items, ID_SECURITY)?.read).toBe(true);
    expect(viewById(result.current.items, ID_NEW_PR)).toBeUndefined();
    // One read + one dismissed removed from the unread badge (5 → 3).
    expect(result.current.unreadCount).toBe(3);
  });

  it('keeps both the read-set and the advanced watermark when markAllRead and markAllSeen share one commit', () => {
    saveInboxTriage({ readIds: [], dismissedIds: [], lastVisitedAt: '2024-03-11T12:00:00Z' });
    const { result } = renderInbox();

    const before = Date.now();
    act(() => {
      result.current.markAllRead();
      result.current.markAllSeen();
    });
    const after = Date.now();

    const persisted = loadInboxTriage();
    // markAllRead survived: every derived id is read and the badge is zeroed.
    expect(persisted.readIds).toEqual(expect.arrayContaining(NEWEST_FIRST));
    expect(result.current.unreadCount).toBe(0);

    // markAllSeen survived: the watermark advanced to ~now and persisted.
    expect(persisted.lastVisitedAt).not.toBeNull();
    const advanced = Date.parse(persisted.lastVisitedAt as string);
    expect(advanced).toBeGreaterThanOrEqual(before);
    expect(advanced).toBeLessThanOrEqual(after);
  });
});

describe('useInbox — filters compose, zero API calls, not persisted (AC-12)', () => {
  it('filters by repository (OR within the category)', () => {
    const { result } = renderInbox();

    act(() => {
      result.current.setFilters({ repos: [ALPHA.nameWithOwner] });
    });
    expect(result.current.items.map((item) => item.id)).toEqual([ID_SECURITY, ID_REVIEW, ID_CI]);

    act(() => {
      result.current.setFilters({ repos: [ALPHA.nameWithOwner, BRAVO.nameWithOwner] });
    });
    expect(result.current.items).toHaveLength(5);
  });

  it('filters by kind (any subset of the five kinds)', () => {
    const { result } = renderInbox();

    act(() => {
      result.current.setFilters({ kinds: ['security', 'stale'] });
    });
    expect(result.current.items.map((item) => item.id)).toEqual([ID_SECURITY, ID_STALE]);
  });

  it('unread-only hides read items without changing the unread badge', () => {
    const { result } = renderInbox();

    act(() => {
      result.current.markRead(ID_SECURITY);
    });
    act(() => {
      result.current.setFilters({ unreadOnly: true });
    });

    expect(viewById(result.current.items, ID_SECURITY)).toBeUndefined();
    expect(result.current.items).toHaveLength(4);
    // The badge counts unread items across the whole fleet, independent of filters.
    expect(result.current.unreadCount).toBe(4);
  });

  it('show-dismissed reveals dismissed items, which are hidden by default', () => {
    const { result } = renderInbox();

    act(() => {
      result.current.dismiss(ID_NEW_PR);
    });
    expect(viewById(result.current.items, ID_NEW_PR)).toBeUndefined();

    act(() => {
      result.current.setFilters({ showDismissed: true });
    });
    expect(viewById(result.current.items, ID_NEW_PR)?.dismissed).toBe(true);
  });

  it('composes filters across categories (AND)', () => {
    const { result } = renderInbox();

    act(() => {
      result.current.setFilters({ repos: [ALPHA.nameWithOwner], kinds: ['review'] });
    });

    expect(result.current.items.map((item) => item.id)).toEqual([ID_REVIEW]);
  });

  it('keeps filters as view-state: never persisted and reset on a fresh mount', () => {
    const { result } = renderInbox();

    act(() => {
      result.current.setFilters({ unreadOnly: true, kinds: ['ci'] });
    });
    expect(result.current.filters.unreadOnly).toBe(true);

    // No triage action ran, so the store was never written — filters are not persisted.
    expect(localStorage.getItem(TRIAGE_KEY)).toBeNull();

    // A fresh mount starts from the default (unfiltered) view-state.
    const next = renderInbox();
    expect(next.result.current.filters).toEqual({
      repos: [],
      kinds: [],
      unreadOnly: false,
      showDismissed: false,
    });
    expect(next.result.current.items).toHaveLength(5);
  });

  it('performs zero network requests for mount, actions, or filtering', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const { result } = renderInbox();
    act(() => {
      result.current.markRead(ID_SECURITY);
      result.current.dismiss(ID_NEW_PR);
      result.current.restore(ID_NEW_PR);
      result.current.markAllRead();
      result.current.markAllSeen();
      result.current.setFilters({ unreadOnly: true });
    });

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('useInbox — triage flush on page teardown (#241)', () => {
  // The triage is persisted by an un-debounced `useEffect([triage])` that runs
  // in React's passive-effect phase, *after* paint. A hard close / navigate /
  // reload inside that window tears the page down before the effect fires, so
  // the last triage write is dropped and the item reverts on the next load.
  //
  // Each test isolates the teardown flush from the passive effect that already
  // ran inside `act`: it removes the just-written value from storage (modelling
  // the write being lost in the teardown window) and then fires the teardown
  // signal. On the CURRENT impl (no teardown listener) nothing re-persists, so
  // the reloaded store does NOT reflect the mutation — the assertion fails.
  // With the flush, the teardown signal synchronously re-saves the latest triage.

  it('flushes the latest triage on beforeunload (hard close/navigate)', () => {
    const { result } = renderInbox();

    act(() => {
      result.current.markRead(ID_SECURITY);
    });

    // Drop the passive-effect write so the assertion proves the flush, not the
    // effect that already ran — the data-loss the teardown window causes.
    localStorage.removeItem(TRIAGE_KEY);

    // A hard page close fires `beforeunload`; React never unmounts, so only an
    // explicit listener can re-persist before the JS context is torn down.
    act(() => {
      window.dispatchEvent(new Event('beforeunload'));
    });

    expect(loadInboxTriage().readIds).toContain(ID_SECURITY);
  });

  it('flushes the latest triage on visibilitychange → hidden (tab freeze/discard)', () => {
    const { result } = renderInbox();

    act(() => {
      result.current.dismiss(ID_NEW_PR);
    });

    localStorage.removeItem(TRIAGE_KEY);

    // Backgrounding the tab fires `visibilitychange` with state `hidden`; React
    // never unmounts, so only this listener can flush before the tab is frozen.
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(loadInboxTriage().dismissedIds).toContain(ID_NEW_PR);
  });

  it('flushes the latest triage on React unmount (view switch)', () => {
    const { result, unmount } = renderInbox();

    act(() => {
      result.current.markRead(ID_CI);
    });

    localStorage.removeItem(TRIAGE_KEY);

    // Switching views unmounts the hook; the cleanup must flush the last change.
    unmount();

    expect(loadInboxTriage().readIds).toContain(ID_CI);
  });

  it('does not flush on visibilitychange → visible (a refocus is not a teardown)', () => {
    const { result } = renderInbox();

    act(() => {
      result.current.markRead(ID_SECURITY);
    });

    localStorage.removeItem(TRIAGE_KEY);

    // Refocusing the tab transitions to `visible`, which is not a teardown — the
    // listener must ignore it and leave the (dropped) write unrecovered.
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(loadInboxTriage().readIds).not.toContain(ID_SECURITY);
  });

  it('writes nothing on teardown when the Inbox was only opened (no pending triage)', () => {
    // Merely opening the Inbox must never write (§3.1) — only real triage
    // actions or an intended watermark advance persist. With no pending change,
    // a teardown flush is a no-op: storage stays empty (never even the default).
    renderInbox();
    expect(localStorage.getItem(TRIAGE_KEY)).toBeNull();

    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    act(() => {
      window.dispatchEvent(new Event('beforeunload'));
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(localStorage.getItem(TRIAGE_KEY)).toBeNull();
  });
});

describe('useInbox — transient fetch failure preserves triage (#249, #233)', () => {
  it('keeps a read mark whose slice is transiently failing but GCs a resolved one', () => {
    const TRANSIENT = 'security:octocat/alpha:dependabot:7'; // security errors → not derived
    const RESOLVED = 'ci:octocat/alpha:999'; //                ci ready, run gone → GC'd
    saveInboxTriage({ readIds: [TRANSIENT, RESOLVED], dismissedIds: [], lastVisitedAt: null });

    const rows = fixtureRows();
    const alpha = rows.get(ALPHA.nameWithOwner) ?? {};
    // This refresh, alpha's security fetch fails: the slice is `error`, so its
    // alert is not derived — but the triage mark must survive the blip (#249).
    rows.set(ALPHA.nameWithOwner, { ...alpha, security: { status: 'error' } });

    const { result } = renderInbox(REPOS, rows);
    act(() => {
      result.current.markRead(ID_CI);
    });

    const persisted = loadInboxTriage().readIds;
    expect(persisted).toContain(TRANSIENT); // protected: the slice merely failed
    expect(persisted).toContain(ID_CI); // the freshly read live item
    expect(persisted).not.toContain(RESOLVED); // ci ready → resolved run forgets its mark
  });

  it('resets a watermark older than the 180-day horizon on the next triage write (#233)', () => {
    // A stale watermark from years ago, far beyond the §3.3 horizon.
    saveInboxTriage({ readIds: [], dismissedIds: [], lastVisitedAt: '2020-01-01T00:00:00Z' });

    const { result } = renderInbox();
    act(() => {
      result.current.markRead(ID_CI);
    });

    expect(loadInboxTriage().lastVisitedAt).toBeNull();
  });
});

describe('useInbox — bulk triage actions (T-f5-inbox-bulk)', () => {
  it('markReadMany marks every given id read, drops the unread count, and survives reload', () => {
    const { result } = renderInbox();

    act(() => {
      result.current.markReadMany([ID_SECURITY, ID_NEW_PR]);
    });

    expect(viewById(result.current.items, ID_SECURITY)?.read).toBe(true);
    expect(viewById(result.current.items, ID_NEW_PR)?.read).toBe(true);
    // Only the explicitly-passed ids are affected; others stay unread.
    expect(viewById(result.current.items, ID_REVIEW)?.read).toBe(false);
    expect(result.current.unreadCount).toBe(3);

    // Round-trip through the store (never a setItem spy, #124): both reads persisted.
    const persisted = loadInboxTriage().readIds;
    expect(persisted).toContain(ID_SECURITY);
    expect(persisted).toContain(ID_NEW_PR);
    expect(persisted).not.toContain(ID_REVIEW);
  });

  it('markReadMany is idempotent and never accumulates duplicate ids', () => {
    const { result } = renderInbox();

    act(() => {
      result.current.markReadMany([ID_CI, ID_CI]);
    });
    act(() => {
      result.current.markReadMany([ID_CI]);
    });

    expect(loadInboxTriage().readIds.filter((id) => id === ID_CI)).toHaveLength(1);
  });

  it('markReadMany([]) is a no-op that never writes (opening the Inbox never persists)', () => {
    const { result } = renderInbox();

    act(() => {
      result.current.markReadMany([]);
    });

    expect(localStorage.getItem(TRIAGE_KEY)).toBeNull();
    expect(result.current.unreadCount).toBe(5);
  });

  it('dismissMany dismisses every given id, hiding them by default, and persists', () => {
    const { result } = renderInbox();

    act(() => {
      result.current.dismissMany([ID_NEW_PR, ID_STALE]);
    });

    expect(viewById(result.current.items, ID_NEW_PR)).toBeUndefined();
    expect(viewById(result.current.items, ID_STALE)).toBeUndefined();
    expect(result.current.items).toHaveLength(3);

    const persisted = loadInboxTriage().dismissedIds;
    expect(persisted).toContain(ID_NEW_PR);
    expect(persisted).toContain(ID_STALE);
  });

  it('dismissMany([]) is a no-op', () => {
    const { result } = renderInbox();

    act(() => {
      result.current.dismissMany([]);
    });

    expect(localStorage.getItem(TRIAGE_KEY)).toBeNull();
    expect(result.current.items).toHaveLength(5);
  });

  it('restoreMany restores every given dismissed id and persists the removal', () => {
    const { result } = renderInbox();

    act(() => {
      result.current.dismissMany([ID_NEW_PR, ID_STALE]);
    });
    act(() => {
      result.current.restoreMany([ID_NEW_PR, ID_STALE]);
    });

    expect(viewById(result.current.items, ID_NEW_PR)?.dismissed).toBe(false);
    expect(viewById(result.current.items, ID_STALE)?.dismissed).toBe(false);
    expect(result.current.items).toHaveLength(5);

    const persisted = loadInboxTriage().dismissedIds;
    expect(persisted).not.toContain(ID_NEW_PR);
    expect(persisted).not.toContain(ID_STALE);
  });

  it('restoreMany ignores ids that were never dismissed', () => {
    const { result } = renderInbox();

    act(() => {
      result.current.dismiss(ID_NEW_PR);
    });
    act(() => {
      // ID_STALE was never dismissed: restoring it is a harmless no-op.
      result.current.restoreMany([ID_NEW_PR, ID_STALE]);
    });

    const persisted = loadInboxTriage().dismissedIds;
    expect(persisted).not.toContain(ID_NEW_PR);
    expect(persisted).not.toContain(ID_STALE);
  });

  it('restoreMany([]) is a no-op', () => {
    const { result } = renderInbox();

    act(() => {
      result.current.dismiss(ID_NEW_PR);
    });
    const before = loadInboxTriage();

    act(() => {
      result.current.restoreMany([]);
    });

    expect(loadInboxTriage()).toEqual(before);
  });

  it('a bulk op affects only the given ids and leaves unrelated live triage marks intact', () => {
    // A pre-existing read mark on a still-live, unrelated item.
    saveInboxTriage({ readIds: [ID_REVIEW], dismissedIds: [], lastVisitedAt: null });
    const { result } = renderInbox();

    act(() => {
      result.current.dismissMany([ID_NEW_PR]);
    });

    // The dismiss batch must not GC or alter the unrelated read mark.
    expect(loadInboxTriage().readIds).toContain(ID_REVIEW);
    expect(loadInboxTriage().dismissedIds).toContain(ID_NEW_PR);
  });
});
