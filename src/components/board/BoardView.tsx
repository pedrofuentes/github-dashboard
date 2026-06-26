/**
 * BoardView — the Stream Deck-style "board" surface for the fleet (T-d4).
 *
 * Where {@link FleetGrid} lays the fleet out as a repo-per-row table, this view
 * paints it as a wall of square keys: one {@link BoardKey} per (repo × signal)
 * pairing, in a responsive CSS grid. Each repo contributes the same six keys in
 * a fixed order (CI · Security · Reviews · Pull requests · Issues · Stale), so a
 * repo's row of keys reads identically across the fleet. The seventh signal,
 * `activity`, is intentionally excluded here — it has no {@link RepoSignalData}
 * slice and needs a separate commit-activity source.
 *
 * It is a drop-in sibling of the other top-level views: it mirrors their shared
 * loading (skeletons), error (alert + retry), and empty states, applies the same
 * `repoFilter` narrowing contract as {@link DashboardView} (`undefined` ⇒ all; a
 * defined Set keeps only repos whose `nameWithOwner` is in it — an empty Set
 * matches nothing), and exposes the same `onRepoActivate(repo)` drill-down hook.
 * The board is a labelled region; each key carries its own accessible name from
 * {@link BoardKey}, so the grid itself stays a plain styled container.
 */
import { Fragment, useMemo } from 'react';
import type { ReactElement } from 'react';

import { DECK_SIGNALS, isHidden } from '../../lib/deck-visibility';
import { SIGNAL_LABELS } from '../../lib/grid-keyboard';
import type { TileSignalType } from '../../types/dashboard';
import type { GetRowData, Repo } from '../../types/fleet';
import { BoardKey } from './BoardKey';

/** Placeholder keys shown while the fleet loads (two board rows of six). */
const SKELETON_KEYS = 12;

/**
 * Responsive Stream Deck grid: square keys that flow from two columns on the
 * narrowest viewport up to six on wide ones, so each repo's six keys settle onto
 * a single row at the widest breakpoint.
 */
const GRID_CLASS = 'grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6';

/** Shared, referentially-stable "nothing hidden" default (keeps memo deps stable). */
const EMPTY_HIDDEN: Set<string> = new Set();

/** Focus-token ring shared with the app's other affordances. */
const FOCUS_RING =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';

/**
 * The customize-mode × that removes (hides) a single key. It sits in the key's
 * top-right corner as an absolute overlay — a real `<button>` with the shared
 * focus ring, deliberately a sibling of the key (never nested inside its button)
 * so the two presses never collide.
 */
const REMOVE_BUTTON_CLASS = `absolute right-1.5 top-1.5 z-10 inline-flex h-6 w-6 items-center justify-center rounded-full border border-border-strong bg-surface-raised text-sm leading-none text-text-muted shadow-sm hover:text-text ${FOCUS_RING}`;

export interface BoardViewProps {
  /** Repositories to render (already adapted by `useRepos`). */
  repos: Repo[];
  /** Resolves the per-repo signal slices for each key. */
  getRowData: GetRowData;
  /** Drill-down hook: when provided, every key becomes an activation button. */
  onRepoActivate?: (repo: Repo) => void;
  /** True while a fetch is in flight (skeletons on first load, busy on reload). */
  loading?: boolean;
  /** Fetch error message; renders an alert + retry instead of the board. */
  error?: string | null;
  /**
   * Retry handler. Powers both the board-level error alert's Retry control and
   * each key's in-place retry: an errored key becomes a retry button that calls
   * this to re-fetch (instead of drilling down).
   */
  onRetry?: () => void;
  /**
   * Active repo-scope selection (`undefined` ⇒ whole fleet). A narrowing filter:
   * when a Set is provided only repos whose `nameWithOwner` is in it are shown
   * (a defined-but-empty Set matches nothing ⇒ the filtered empty state).
   */
  repoFilter?: Set<string>;
  /**
   * The HIDDEN per-key set (`${repo}:${signal}` ids — see `deck-visibility`).
   * A key in this set is not rendered; an empty/omitted set ⇒ every key visible,
   * so brand-new fleet repos appear automatically.
   */
  hiddenKeys?: Set<string>;
  /**
   * Customize mode. When true and paired with {@link BoardViewProps.onToggleKey},
   * every still-visible key gains an accessible × remove overlay; otherwise keys
   * render exactly as normal.
   */
  editing?: boolean;
  /** Toggles one (repo, signal) key's visibility — wired to the × remove overlay. */
  onToggleKey?: (repo: Repo, signal: TileSignalType) => void;
}

export function BoardView({
  repos,
  getRowData,
  onRepoActivate,
  loading = false,
  error = null,
  onRetry,
  repoFilter,
  hiddenKeys = EMPTY_HIDDEN,
  editing = false,
  onToggleKey,
}: BoardViewProps): ReactElement {
  // Presentational narrowing: `undefined` keeps the whole fleet; any defined Set
  // keeps only the repos it names (an empty Set matches nothing ⇒ 0 repos).
  const visibleRepos = useMemo(
    () =>
      repoFilter === undefined ? repos : repos.filter((repo) => repoFilter.has(repo.nameWithOwner)),
    [repos, repoFilter],
  );

  // The signals each visible repo still shows, after removing its hidden keys —
  // memoised so both the key count and the grid render the same filtered list.
  const visibleKeysByRepo = useMemo(
    () =>
      visibleRepos.map((repo) => ({
        repo,
        signals: DECK_SIGNALS.filter((signal) => !isHidden(hiddenKeys, repo.nameWithOwner, signal)),
      })),
    [visibleRepos, hiddenKeys],
  );

  const visibleKeyCount = useMemo(
    () => visibleKeysByRepo.reduce((total, { signals }) => total + signals.length, 0),
    [visibleKeysByRepo],
  );

  if (error !== null) {
    return (
      <section aria-label="Repository board" className="flex flex-col gap-3">
        <div
          role="alert"
          className="rounded-md border border-accent-failure bg-[color-mix(in_srgb,var(--color-failure)_10%,var(--color-surface))] px-4 py-3 text-sm text-accent-failure"
        >
          <p className="font-medium">Couldn’t load your repositories.</p>
          <p className="mt-1 text-accent-failure">{error}</p>
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="mt-3 inline-flex items-center rounded border border-accent-failure px-3 py-1 text-sm font-medium text-accent-failure hover:bg-[color-mix(in_srgb,var(--color-failure)_10%,var(--color-surface))] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-failure"
            >
              Retry
            </button>
          ) : null}
        </div>
      </section>
    );
  }

  const showSkeleton = loading && visibleRepos.length === 0;
  const noRepos = !showSkeleton && visibleRepos.length === 0;
  // Distinct from the no-repos/filtered states: repos exist, but every one of
  // their keys is hidden, so the grid would render empty.
  const allTilesHidden = !showSkeleton && visibleRepos.length > 0 && visibleKeyCount === 0;
  const emptyMessage =
    repos.length === 0
      ? 'No repositories found for this token.'
      : 'No repositories match your filter.';

  const repoCount = visibleRepos.length;
  const repoNoun = repoCount === 1 ? 'repository' : 'repositories';
  const hasHiddenVisible = visibleKeyCount < repoCount * DECK_SIGNALS.length;
  const tileNoun = visibleKeyCount === 1 ? 'tile' : 'tiles';
  const statusMessage = loading
    ? 'Loading repositories…'
    : hasHiddenVisible
      ? `${repoCount} ${repoNoun} · ${visibleKeyCount} ${tileNoun}`
      : `${repoCount} ${repoNoun}`;

  return (
    <section aria-label="Repository board" className="flex flex-col gap-3">
      <p role="status" aria-live="polite" className="text-sm text-text-muted">
        {statusMessage}
      </p>

      {showSkeleton ? (
        <div aria-busy="true" aria-hidden="true" className={GRID_CLASS}>
          {Array.from({ length: SKELETON_KEYS }, (_, index) => (
            <span
              key={`skeleton-${index}`}
              data-part="skeleton"
              className="block aspect-square w-full animate-pulse rounded-2xl border border-border bg-surface motion-reduce:animate-none"
            />
          ))}
        </div>
      ) : noRepos ? (
        <div className="flex flex-col items-center gap-2 rounded-md border border-border bg-surface px-4 py-10 text-center">
          <p className="text-sm text-text-muted">{emptyMessage}</p>
        </div>
      ) : allTilesHidden ? (
        <div className="flex flex-col items-center gap-2 rounded-md border border-border bg-surface px-4 py-10 text-center">
          <p className="text-sm font-medium text-text">All tiles hidden.</p>
          <p className="text-sm text-text-muted">Use Customize to bring tiles back.</p>
        </div>
      ) : (
        <div aria-busy={loading} className={GRID_CLASS}>
          {visibleKeysByRepo.flatMap(({ repo, signals }) => {
            const data = getRowData(repo);
            return signals.map((signal) => {
              const id = `${repo.nameWithOwner}:${signal}`;
              const boardKey = (
                <BoardKey
                  repo={repo}
                  signal={signal}
                  data={data}
                  onActivate={onRepoActivate}
                  onRetry={onRetry}
                />
              );
              return editing && onToggleKey ? (
                <div key={id} className="relative">
                  {boardKey}
                  <button
                    type="button"
                    onClick={() => onToggleKey(repo, signal)}
                    aria-label={`Remove ${SIGNAL_LABELS[signal]} tile for ${repo.nameWithOwner}`}
                    className={REMOVE_BUTTON_CLASS}
                  >
                    <span aria-hidden="true">✕</span>
                  </button>
                </div>
              ) : (
                <Fragment key={id}>{boardKey}</Fragment>
              );
            });
          })}
        </div>
      )}
    </section>
  );
}
