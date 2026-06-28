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
import type { ReactElement, ReactNode } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import {
  SortableContext,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';

import { DECK_SIGNALS, isHidden } from '../../lib/deck-visibility';
import { DECK_TILE_MIN_PX } from '../../lib/deck-tile-size';
import type { DeckTileSize } from '../../lib/deck-tile-size';
import { resolveDeckMove, deckColumnId } from '../../lib/deck-reorder';
import { signalDeepLinkUrl } from '../../lib/github-deep-link';
import { SIGNAL_LABELS } from '../../lib/grid-keyboard';
import type { TileSignalType } from '../../types/dashboard';
import type { GetRowData, Repo } from '../../types/fleet';
import { BoardKey } from './BoardKey';
import { DeckColumnHeader } from './DeckColumnHeader';
import { SortableRepoRow } from './SortableRepoRow';

/**
 * Responsive Stream Deck grid: square keys flow via `auto-fill`, so the column
 * count follows the container width and the chosen {@link DeckTileSize} (its
 * minimum key width — see {@link DECK_TILE_MIN_PX}). `medium` reproduces the
 * legacy two-to-six-column breakpoints; the inline `grid-template-columns`
 * supplies the per-size minimum.
 */
const GRID_CLASS = 'grid gap-3';

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
   * the legacy key retry fallback.
   */
  onRetry?: () => void;
  /**
   * Scoped retry handler for a failed key. When supplied, an errored key retries
   * its own repo/signal instead of invoking the board-level reload.
   */
  onRetrySignal?: (repo: Repo, signal: TileSignalType) => void;
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
  /**
   * How large to render each key. In the repo×signal matrix this is the
   * per-column **target/max** width (see {@link DECK_TILE_MIN_PX}); each repo's
   * signals always stay on one line (columns shrink to fit narrow viewports and
   * cap at the target on wide / full-window displays), so repos never mix.
   */
  size?: DeckTileSize;
  /**
   * Row order — repo `nameWithOwner` ids. Visible repos are rendered in this
   * order (ids not present are appended in their natural order). Omitted ⇒ the
   * incoming `repos` order.
   */
  repoOrder?: readonly string[];
  /**
   * Column order — the signal sequence each repo row renders left-to-right.
   * Omitted ⇒ {@link DECK_SIGNALS}.
   */
  signalOrder?: readonly TileSignalType[];
  /**
   * Reorders the repo row at `from` to `to` (drag/keyboard). When supplied AND
   * `editing` AND no repo filter is active, each row gains a drag grip and the
   * rows become a sortable list. A repo filter renders only a subset, so
   * reordering is disabled then (persisting a partial order would corrupt it);
   * a hint is shown instead.
   */
  onMoveRepo?: (from: number, to: number) => void;
  /**
   * Reorders the signal column at `from` to `to` (drag/keyboard). When supplied
   * AND `editing`, a draggable column-header strip appears and sets a global
   * column order applied across every repo row. Not filter-gated — columns are
   * fleet-wide, independent of which repos are shown.
   */
  onMoveSignal?: (from: number, to: number) => void;
  /**
   * Removes (hides) a whole repo row. When supplied AND `editing` AND the rows
   * are reorderable, each row's grip is joined by a remove (✕) control that calls
   * this with the row's repo. Add the row back via the Customize panel.
   */
  onRemoveRepo?: (repo: Repo) => void;
}

export function BoardView({
  repos,
  getRowData,
  onRepoActivate,
  loading = false,
  error = null,
  onRetry,
  onRetrySignal,
  repoFilter,
  hiddenKeys = EMPTY_HIDDEN,
  editing = false,
  onToggleKey,
  size = 'medium',
  repoOrder,
  signalOrder,
  onMoveRepo,
  onMoveSignal,
  onRemoveRepo,
}: BoardViewProps): ReactElement {
  // Presentational narrowing: `undefined` keeps the whole fleet; any defined Set
  // keeps only the repos it names (an empty Set matches nothing ⇒ 0 repos).
  const visibleRepos = useMemo(
    () =>
      repoFilter === undefined ? repos : repos.filter((repo) => repoFilter.has(repo.nameWithOwner)),
    [repos, repoFilter],
  );

  // The signal columns each repo row renders, left-to-right. Defaults to the
  // canonical DECK_SIGNALS order when no explicit column order is supplied.
  const columns = useMemo<readonly TileSignalType[]>(
    () => signalOrder ?? DECK_SIGNALS,
    [signalOrder],
  );

  // Visible repos ordered by `repoOrder` (ids first, in that order; any visible
  // repo missing from the order appended in its natural position) so the matrix
  // rows follow the user's row order while new/unordered repos still appear.
  const orderedRepos = useMemo(() => {
    if (repoOrder === undefined) {
      return visibleRepos;
    }
    const byId = new Map(visibleRepos.map((repo) => [repo.nameWithOwner, repo]));
    const ordered: Repo[] = [];
    const seen = new Set<string>();
    for (const id of repoOrder) {
      const repo = byId.get(id);
      if (repo !== undefined && !seen.has(id)) {
        seen.add(id);
        ordered.push(repo);
      }
    }
    for (const repo of visibleRepos) {
      if (!seen.has(repo.nameWithOwner)) {
        ordered.push(repo);
      }
    }
    return ordered;
  }, [visibleRepos, repoOrder]);

  // Each repo's visible signal keys, in column order, after removing hidden keys
  // — memoised so the count and the matrix render the same filtered list.
  const visibleKeysByRepo = useMemo(
    () =>
      orderedRepos.map((repo) => ({
        repo,
        signals: columns.filter((signal) => !isHidden(hiddenKeys, repo.nameWithOwner, signal)),
      })),
    [orderedRepos, columns, hiddenKeys],
  );

  const visibleKeyCount = useMemo(
    () => visibleKeysByRepo.reduce((total, { signals }) => total + signals.length, 0),
    [visibleKeysByRepo],
  );

  // Pointer + keyboard drag (the keyboard sensor gives Space-pickup / arrow-move
  // / Space-drop with announcements, satisfying the WAI-ARIA drag contract).
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Reordering rows persists into the full-fleet order, so it is only safe when
  // the rendered set is the whole fleet: gate it off whenever a repo filter is
  // active (the rendered subset's indices wouldn't map to the saved order).
  // Column order is fleet-wide, so it is NOT filter-gated.
  const filterActive = repoFilter !== undefined;
  const rowsReorderable = editing && onMoveRepo !== undefined && !filterActive;
  const columnsReorderable = editing && onMoveSignal !== undefined;
  const dndActive = rowsReorderable || columnsReorderable;
  const showReorderFilterHint = editing && onMoveRepo !== undefined && filterActive;

  const orderedRepoIds = useMemo(
    () => orderedRepos.map((repo) => repo.nameWithOwner),
    [orderedRepos],
  );
  const columnIds = useMemo(() => columns.map((signal) => deckColumnId(signal)), [columns]);

  const handleDeckDragEnd = (event: DragEndEvent): void => {
    const move = resolveDeckMove(orderedRepoIds, columnIds, event.active.id, event.over?.id);
    if (move === null) {
      return;
    }
    if (move.kind === 'column') {
      onMoveSignal?.(move.from, move.to);
    } else {
      onMoveRepo?.(move.from, move.to);
    }
  };

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

  // Model C: each repo row is a grid of fixed signal columns. The size sets the
  // per-column target/max width; columns shrink to fit narrow viewports and cap
  // at the target on wide displays, so a repo's signals always stay on one line
  // (one row per repo) and never reflow into another repo's row.
  const rowStyle = {
    gridTemplateColumns: `repeat(${columns.length}, minmax(0, ${DECK_TILE_MIN_PX[size]}px))`,
  };

  // One repo's signal-key cells, shared by the plain and sortable row variants.
  const renderRepoCells = (repo: Repo, signals: readonly TileSignalType[]): ReactNode => {
    const data = getRowData(repo);
    return signals.map((signal) => {
      const id = `${repo.nameWithOwner}:${signal}`;
      const boardKey = (
        <BoardKey
          repo={repo}
          signal={signal}
          data={data}
          href={signalDeepLinkUrl(repo, signal, data)}
          onActivate={onRepoActivate}
          onRetry={onRetrySignal !== undefined ? () => onRetrySignal(repo, signal) : onRetry}
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
  };

  return (
    <section aria-label="Repository board" className="flex flex-col gap-3">
      <p role="status" aria-live="polite" className="text-sm text-text-muted">
        {statusMessage}
      </p>

      {showSkeleton ? (
        <div aria-busy="true" aria-hidden="true" className="flex flex-col gap-3">
          {Array.from({ length: 2 }, (_, row) => (
            <div key={`skeleton-row-${row}`} className={GRID_CLASS} style={rowStyle}>
              {Array.from({ length: DECK_SIGNALS.length }, (_, index) => (
                <span
                  key={`skeleton-${row}-${index}`}
                  data-part="skeleton"
                  className="block aspect-square w-full animate-pulse rounded-2xl border border-border bg-surface motion-reduce:animate-none"
                />
              ))}
            </div>
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
        <div aria-busy={loading} className="flex flex-col gap-3">
          {showReorderFilterHint ? (
            <p className="rounded-md border border-border bg-surface-raised px-4 py-2 text-sm text-text-muted">
              Clear the filter to reorder repositories.
            </p>
          ) : null}
          {dndActive ? (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDeckDragEnd}
            >
              {columnsReorderable ? (
                <SortableContext items={columnIds} strategy={horizontalListSortingStrategy}>
                  <DeckColumnHeader
                    signals={columns}
                    rowStyle={rowStyle}
                    gutter={rowsReorderable}
                  />
                </SortableContext>
              ) : null}
              {rowsReorderable ? (
                <SortableContext items={orderedRepoIds} strategy={verticalListSortingStrategy}>
                  {visibleKeysByRepo.map(({ repo, signals }) => (
                    <SortableRepoRow
                      key={repo.nameWithOwner}
                      id={repo.nameWithOwner}
                      label={repo.nameWithOwner}
                      rowStyle={rowStyle}
                      onRemove={onRemoveRepo !== undefined ? () => onRemoveRepo(repo) : undefined}
                      removeLabel={`Remove repository ${repo.nameWithOwner}`}
                    >
                      {renderRepoCells(repo, signals)}
                    </SortableRepoRow>
                  ))}
                </SortableContext>
              ) : (
                visibleKeysByRepo.map(({ repo, signals }) => (
                  <div
                    key={repo.nameWithOwner}
                    data-repo-row={repo.nameWithOwner}
                    className={GRID_CLASS}
                    style={rowStyle}
                  >
                    {renderRepoCells(repo, signals)}
                  </div>
                ))
              )}
            </DndContext>
          ) : (
            visibleKeysByRepo.map(({ repo, signals }) => (
              <div
                key={repo.nameWithOwner}
                data-repo-row={repo.nameWithOwner}
                className={GRID_CLASS}
                style={rowStyle}
              >
                {renderRepoCells(repo, signals)}
              </div>
            ))
          )}
        </div>
      )}
    </section>
  );
}
