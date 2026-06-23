/**
 * React state binding for the scalable repo filter (filter v2). Wraps the
 * React-free {@link RepoFilterQueryV2} model: loads + reconciles the persisted
 * query on mount, persists synchronously on every user-driven change (no
 * debounce — mirroring `useRepoFilter`), and re-reconciles whenever the fleet
 * *set* changes. The reconcile path keeps the empty-fleet guard (I2): it drops
 * pins absent from the fleet for DISPLAY but only persists while the fleet is
 * non-empty, so a transiently empty initial fleet never wipes the saved query.
 *
 * There is intentionally NO popover UI here — that is a separate increment. This
 * module owns the state, the granular immutable updaters, the derived selection
 * projection, and the facet-OPTION derivation (`availableOwners`) the UI renders.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { GetRowData, Repo } from '../types/fleet';
import {
  createRepoFilterQueryStore,
  evaluateRepoFilterQuery,
  isQueryActive,
  migrateLegacyRepoFilter,
  type RepoFilterQueryV2,
} from '../lib/repo-filter-query';
import type { VersionedStore } from '../lib/versioned-storage';

type Facets = RepoFilterQueryV2['facets'];

/** A health band facet value (`broken` | `warning` | `healthy`). */
export type HealthBand = Facets['health'][number];
/** A CI conclusion facet value. */
export type CiState = Facets['ci'][number];
/** A security letter-grade facet value (`A`…`F`). */
export type SecurityGrade = Facets['security']['grades'][number];
/** A security severity facet value. */
export type SecuritySeverity = Facets['security']['severities'][number];
/** A pull-requests facet option (`open` | `external`). */
export type PullRequestOption = Facets['pullRequests'][number];
/** An issues facet option (`open` | `over-threshold`). */
export type IssuesOption = Facets['issues'][number];
/** A stale facet option (`any` | `pr` | `issue`). */
export type StaleOption = Facets['stale'][number];
/** A visibility facet option (`private` | `public`). */
export type VisibilityOption = Facets['visibility'][number];
/** The repo pin/selection shape (`mode` + `names`). */
export type RepoSelection = RepoFilterQueryV2['repoSelection'];

/** One owner present in the fleet with its repository count. */
export interface AvailableOwner {
  owner: string;
  count: number;
}

/** Public shape returned by {@link useRepoFilterQuery}. */
export interface UseRepoFilterQueryResult {
  /** The current (loaded + reconciled) query. */
  query: RepoFilterQueryV2;
  /** The set of `nameWithOwner` the query currently selects. */
  derivedSelected: Set<string>;
  /** Whether the query narrows the fleet at all. */
  isActive: boolean;
  /** Replaces the free-text needle. */
  setText: (text: string) => void;
  /** Toggles an owner in the owners facet. */
  toggleOwner: (owner: string) => void;
  /** Toggles a health band in the health facet. */
  toggleHealth: (band: HealthBand) => void;
  /** Toggles a CI conclusion in the CI facet. */
  toggleCi: (state: CiState) => void;
  /** Toggles a security grade in the security grades facet. */
  toggleSecurityGrade: (grade: SecurityGrade) => void;
  /** Sets (or clears, with `undefined`) the security max-grade threshold. */
  setSecurityMaxGrade: (grade: SecurityGrade | undefined) => void;
  /** Toggles a security severity in the security severities facet. */
  toggleSecuritySeverity: (severity: SecuritySeverity) => void;
  /** Toggles a pull-requests option. */
  togglePullRequests: (option: PullRequestOption) => void;
  /** Toggles the "reviews awaiting me" facet. */
  toggleReviewsAwaitingMe: () => void;
  /** Toggles an issues option. */
  toggleIssues: (option: IssuesOption) => void;
  /** Toggles a stale option. */
  toggleStale: (option: StaleOption) => void;
  /** Toggles a visibility option. */
  toggleVisibility: (option: VisibilityOption) => void;
  /** Replaces the repo pin/selection (mode + names). */
  setRepoSelection: (selection: RepoSelection) => void;
  /** Adds/removes a repo name from the current selection's names. */
  toggleRepoPin: (name: string) => void;
  /** Resets the entire query back to {@link EMPTY_QUERY}. */
  clearAll: () => void;
  /** Distinct owners present in the fleet with repo counts, sorted by owner. */
  availableOwners: AvailableOwner[];
}

/** Adds `value` if absent, removes it if present — returning a fresh array. */
function toggleInArray<T>(values: readonly T[], value: T): T[] {
  return values.includes(value) ? values.filter((v) => v !== value) : [...values, value];
}

/** Builds a fresh empty query (never shares mutable state with {@link EMPTY_QUERY}). */
function freshEmptyQuery(): RepoFilterQueryV2 {
  return {
    version: 2,
    text: '',
    repoSelection: { mode: 'all', names: [] },
    facets: {
      owners: [],
      health: [],
      ci: [],
      security: { grades: [], severities: [] },
      pullRequests: [],
      reviews: [],
      issues: [],
      stale: [],
      visibility: [],
    },
  };
}

/**
 * Drops any pinned `names` no longer present in the fleet, returning the same
 * reference when nothing changes (so unrelated re-renders stay stable).
 */
function reconcileQuery(query: RepoFilterQueryV2, repos: Repo[]): RepoFilterQueryV2 {
  const present = new Set(repos.map((repo) => repo.nameWithOwner));
  const names = query.repoSelection.names.filter((name) => present.has(name));
  if (names.length === query.repoSelection.names.length) {
    return query;
  }
  return { ...query, repoSelection: { ...query.repoSelection, names } };
}

/** Updates a single facets field immutably within a query. */
function withFacet<K extends keyof Facets>(
  query: RepoFilterQueryV2,
  key: K,
  value: Facets[K],
): RepoFilterQueryV2 {
  return { ...query, facets: { ...query.facets, [key]: value } };
}

/**
 * Manages the scalable repo-filter query for the given fleet.
 *
 * @param repos - Repositories used to reconcile pins and derive `availableOwners`.
 * @param getRowData - Resolves the per-repo signal data the facets evaluate against.
 */
export function useRepoFilterQuery(
  repos: Repo[],
  getRowData: GetRowData,
): UseRepoFilterQueryResult {
  const storeRef = useRef<VersionedStore<RepoFilterQueryV2> | null>(null);
  if (storeRef.current === null) {
    const store = createRepoFilterQueryStore();
    // Seed v2 from a legacy `string[]` selection (if any) before the first read,
    // so a user's pre-v2 filter survives the upgrade.
    migrateLegacyRepoFilter(store);
    storeRef.current = store;
  }
  const store = storeRef.current;

  const [query, setQueryState] = useState<RepoFilterQueryV2>(() =>
    reconcileQuery(store.load(), repos),
  );

  // A stable identity for the fleet, independent of array reference or order, so
  // we only re-reconcile when the *set* of repos actually changes.
  const fleetKey = useMemo(
    () =>
      repos
        .map((repo) => repo.nameWithOwner)
        .sort()
        .join('\n'),
    [repos],
  );

  // The lazy initializer ran against the fleet present at mount, which is often
  // empty while repos load asynchronously. Re-reconcile when the fleet identity
  // changes so newly present repos survive and absent pins drop.
  const previousFleetKey = useRef(fleetKey);
  useEffect(() => {
    if (previousFleetKey.current === fleetKey) {
      return;
    }
    previousFleetKey.current = fleetKey;
    const reconciled = reconcileQuery(store.load(), repos);
    // Empty-fleet guard (I2): reconcile for DISPLAY but do not persist the
    // narrowed query while the fleet is empty, so a transiently empty fleet
    // never wipes the saved pins.
    if (repos.length > 0) {
      store.save(reconciled);
    }
    setQueryState(reconciled);
  }, [fleetKey, repos, store]);

  const update = useCallback(
    (transform: (current: RepoFilterQueryV2) => RepoFilterQueryV2) => {
      setQueryState((current) => {
        const next = transform(current);
        store.save(next);
        return next;
      });
    },
    [store],
  );

  const setText = useCallback((text: string) => update((q) => ({ ...q, text })), [update]);

  const toggleOwner = useCallback(
    (owner: string) => update((q) => withFacet(q, 'owners', toggleInArray(q.facets.owners, owner))),
    [update],
  );

  const toggleHealth = useCallback(
    (band: HealthBand) =>
      update((q) => withFacet(q, 'health', toggleInArray(q.facets.health, band))),
    [update],
  );

  const toggleCi = useCallback(
    (state: CiState) => update((q) => withFacet(q, 'ci', toggleInArray(q.facets.ci, state))),
    [update],
  );

  const toggleSecurityGrade = useCallback(
    (grade: SecurityGrade) =>
      update((q) =>
        withFacet(q, 'security', {
          ...q.facets.security,
          grades: toggleInArray(q.facets.security.grades, grade),
        }),
      ),
    [update],
  );

  const setSecurityMaxGrade = useCallback(
    (grade: SecurityGrade | undefined) =>
      update((q) => withFacet(q, 'security', { ...q.facets.security, maxGrade: grade })),
    [update],
  );

  const toggleSecuritySeverity = useCallback(
    (severity: SecuritySeverity) =>
      update((q) =>
        withFacet(q, 'security', {
          ...q.facets.security,
          severities: toggleInArray(q.facets.security.severities, severity),
        }),
      ),
    [update],
  );

  const togglePullRequests = useCallback(
    (option: PullRequestOption) =>
      update((q) => withFacet(q, 'pullRequests', toggleInArray(q.facets.pullRequests, option))),
    [update],
  );

  const toggleReviewsAwaitingMe = useCallback(
    () => update((q) => withFacet(q, 'reviews', toggleInArray(q.facets.reviews, 'awaiting-me'))),
    [update],
  );

  const toggleIssues = useCallback(
    (option: IssuesOption) =>
      update((q) => withFacet(q, 'issues', toggleInArray(q.facets.issues, option))),
    [update],
  );

  const toggleStale = useCallback(
    (option: StaleOption) =>
      update((q) => withFacet(q, 'stale', toggleInArray(q.facets.stale, option))),
    [update],
  );

  const toggleVisibility = useCallback(
    (option: VisibilityOption) =>
      update((q) => withFacet(q, 'visibility', toggleInArray(q.facets.visibility, option))),
    [update],
  );

  const setRepoSelection = useCallback(
    (selection: RepoSelection) =>
      update((q) => ({
        ...q,
        repoSelection: { mode: selection.mode, names: [...selection.names] },
      })),
    [update],
  );

  const toggleRepoPin = useCallback(
    (name: string) =>
      update((q) => ({
        ...q,
        repoSelection: { ...q.repoSelection, names: toggleInArray(q.repoSelection.names, name) },
      })),
    [update],
  );

  const clearAll = useCallback(() => update(() => freshEmptyQuery()), [update]);

  const derivedSelected = useMemo(
    () => evaluateRepoFilterQuery(query, repos, getRowData),
    [query, repos, getRowData],
  );

  const isActive = useMemo(() => isQueryActive(query), [query]);

  const availableOwners = useMemo<AvailableOwner[]>(() => {
    const counts = new Map<string, number>();
    for (const repo of repos) {
      counts.set(repo.owner, (counts.get(repo.owner) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([owner, count]) => ({ owner, count }))
      .sort((a, b) => a.owner.localeCompare(b.owner));
  }, [repos]);

  return {
    query,
    derivedSelected,
    isActive,
    setText,
    toggleOwner,
    toggleHealth,
    toggleCi,
    toggleSecurityGrade,
    setSecurityMaxGrade,
    toggleSecuritySeverity,
    togglePullRequests,
    toggleReviewsAwaitingMe,
    toggleIssues,
    toggleStale,
    toggleVisibility,
    setRepoSelection,
    toggleRepoPin,
    clearAll,
    availableOwners,
  };
}
