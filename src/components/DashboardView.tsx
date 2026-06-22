/**
 * DashboardView — the at-a-glance tile arrangement for the fleet (M10 T2/T3).
 *
 * Renders one {@link SignalTile} per *visible* tile from the persisted dashboard
 * layout, positioned on react-grid-layout. By default the grid is static; an
 * opt-in `editing` mode enables pointer drag + resize (T3). Keyboard-accessible
 * reorder/resize (the WCAG-AA gate, T4) is implemented here: a roving-tabindex
 * `role="grid"` with arrow-key navigation, per-tile Move/Resize controls, and a
 * polite live region announcing each change. Each tile carries accurate
 * `aria-rowindex`/`aria-colindex` derived from its grid geometry. Both this view
 * and the table grid open the same drill-down drawer via `onRepoActivate`.
 *
 * Note: `Responsive` + `WidthProvider` (the width-measuring HOC, with the flat
 * v1-style `layouts` / `breakpoints` / `cols` / `isDraggable` / `isResizable`
 * props this view relies on) are imported from `react-grid-layout/legacy`, the
 * subpath that re-exports them in react-grid-layout v2.
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, ReactElement } from 'react';
import { Responsive, WidthProvider } from 'react-grid-layout/legacy';
import type { Layout, ResponsiveLayouts } from 'react-grid-layout/legacy';
import 'react-grid-layout/css/styles.css';

import { useDashboardLayout } from '../hooks/useDashboardLayout';
import { cn } from '../lib/cn';
import { toRglLayout } from '../lib/dashboard-layout';
import { mergeLayoutGeometry } from '../lib/dashboard-layout-merge';
import { perRepoHealth, summarizeFleetHealth } from '../lib/fleet-summary';
import {
  SIGNAL_LABELS,
  arrowDirection,
  findNeighbor,
  formatMoveAnnouncement,
  formatResizeAnnouncement,
  moveCell,
  resizeCell,
} from '../lib/grid-keyboard';
import type { MoveDirection, ResizeDimension } from '../lib/grid-keyboard';
import type { DashboardTile } from '../types/dashboard';
import type { GetRowData, Repo, RepoSignalData } from '../types/fleet';
import { FleetSummaryTile } from './FleetSummaryTile';
import { SignalTile } from './SignalTile';

const ResponsiveGridLayout = WidthProvider(Responsive);

/** Breakpoints with a fixed 12-column grid so tiles keep their 3×2 geometry. */
const BREAKPOINTS = { lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 } as const;
const COLS = { lg: 12, md: 12, sm: 12, xs: 12, xxs: 12 } as const;
const GRID_COLUMNS = 12;
const ROW_HEIGHT = 96;
const MARGIN: [number, number] = [16, 16];

/** Pointer drag must not start from the keyboard Move/Resize controls. */
const DRAG_CANCEL_SELECTOR = '.dashboard-tile-control';

export interface DashboardViewProps {
  /** The fleet repositories (drive the default layout + tile lookup). */
  repos: Repo[];
  /** Resolves the per-repo signal slices for each tile. */
  getRowData: GetRowData;
  /** Opens the drill-down drawer for the activated tile's repo. */
  onRepoActivate: (repo: Repo) => void;
  /** When true, the grid items can be dragged and resized with a pointer. */
  editing?: boolean;
  /** True while the repo fetch is in flight (skeleton on first load). */
  loading?: boolean;
  /** Fetch error message; renders an alert + retry instead of the tiles. */
  error?: string | null;
  /** Retry handler for the error state. */
  onRetry?: () => void;
}

interface ResolvedTile {
  tile: DashboardTile;
  repo: Repo;
}

/** Number of placeholder tiles shown while the fleet loads. */
const SKELETON_TILES = 6;

/** Reads the user's reduced-motion preference, defending against jsdom/SSR. */
function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function DashboardView({
  repos,
  getRowData,
  onRepoActivate,
  editing = false,
  loading = false,
  error = null,
  onRetry,
}: DashboardViewProps): ReactElement {
  const { layout, setLayout } = useDashboardLayout(repos);

  // Honour reduced-motion by skipping react-grid-layout's CSS transform
  // animation. Read once on mount — the preference rarely changes mid-session.
  const [reducedMotion] = useState(prefersReducedMotion);

  const repoIndex = useMemo(
    () => new Map(repos.map((repo) => [repo.nameWithOwner, repo])),
    [repos],
  );

  // Resolve each repo's signal data exactly once per render (not once per tile),
  // keeping `data` referentially stable per repo for a future React.memo (#121).
  const repoData = useMemo(() => {
    const map = new Map<string, RepoSignalData>();
    for (const repo of repos) {
      map.set(repo.nameWithOwner, getRowData(repo));
    }
    return map;
  }, [repos, getRowData]);

  // Visible tiles whose repo is still present, resolved to their Repo up front
  // so the render path never deals with a missing repo.
  const tiles = useMemo<ResolvedTile[]>(() => {
    const resolved: ResolvedTile[] = [];
    for (const tile of layout) {
      if (!tile.visible) {
        continue;
      }
      const repo = repoIndex.get(tile.repo);
      if (repo !== undefined) {
        resolved.push({ tile, repo });
      }
    }
    return resolved;
  }, [layout, repoIndex]);

  const rglLayout = useMemo(() => toRglLayout(tiles.map((entry) => entry.tile)), [tiles]);

  // Fleet-wide rollup for the pinned summary anchor. Reuses the per-repo data
  // resolved above (never re-invokes getRowData) so it stays in sync and cheap.
  const summary = useMemo(() => summarizeFleetHealth(repoData.values()), [repoData]);

  // Per-repo health entries (worst-state strip + worst-child chip), derived from
  // the same resolved data so they stay in sync with the aggregate rollup.
  const fleetEntries = useMemo(() => perRepoHealth(repoData.entries()), [repoData]);

  // Grid extent for SC 1.3.1 context: the grid is a fixed 12 columns wide; the
  // row count is the deepest tile's bottom edge (1-based, in grid-row units).
  const ariaRowCount = useMemo(
    () => tiles.reduce((max, { tile }) => Math.max(max, tile.y + tile.h), 1),
    [tiles],
  );

  const layouts = useMemo<ResponsiveLayouts<string>>(
    () => ({
      lg: rglLayout,
      md: rglLayout,
      sm: rglLayout,
      xs: rglLayout,
      xxs: rglLayout,
    }),
    [rglLayout],
  );

  // Pointer drag/resize edits the layout: update state immediately, persist
  // debounced (in the hook). Skip no-op changes — react-grid-layout also fires
  // onLayoutChange on mount and on responsive breakpoint switches.
  const handleLayoutChange = useCallback(
    (next: Layout) => {
      const merged = mergeLayoutGeometry(layout, next);
      const changed = merged.some((tile, index) => tile !== layout[index]);
      if (changed) {
        setLayout(merged);
      }
    },
    [layout, setLayout],
  );

  // Roving tabindex: exactly one tile is the grid's tab stop. Default to the
  // first tile; fall back if the active tile is no longer rendered.
  const [activeId, setActiveId] = useState<string | null>(null);
  const activeTileId =
    activeId !== null && tiles.some(({ tile }) => tile.i === activeId)
      ? activeId
      : (tiles[0]?.tile.i ?? null);

  // Polite live-region text announcing the result of a keyboard move/resize.
  const [announcement, setAnnouncement] = useState('');

  const gridRef = useRef<HTMLDivElement>(null);

  // Restore roving focus to a tile by querying its activation control, avoiding
  // a ref map that would detach/re-attach (and drop focus) on every re-render.
  const focusTile = useCallback((tileId: string) => {
    const control = gridRef.current?.querySelector<HTMLElement>(
      `[data-tile-activate="${CSS.escape(tileId)}"]`,
    );
    control?.focus();
  }, []);

  const handleTileFocus = useCallback((tileId: string) => setActiveId(tileId), []);

  // Arrow keys move the roving focus between tiles by their grid geometry. Only
  // act when focus is on a tile's activation control, so the Move/Resize buttons
  // keep their own (default) key handling.
  const handleGridKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const fromId = (event.target as HTMLElement).dataset.tileActivate;
      if (fromId === undefined) {
        return;
      }
      const direction = arrowDirection(event.key);
      if (direction === null) {
        return;
      }
      // Claim the arrow key as soon as it's a recognized direction — even when
      // focus can't move (the spatial neighbour is null at a grid edge) — so the
      // page never native-scrolls under the grid.
      event.preventDefault();
      const cells = tiles.map(({ tile }) => ({
        i: tile.i,
        x: tile.x,
        y: tile.y,
        w: tile.w,
        h: tile.h,
      }));
      const nextId = findNeighbor(cells, fromId, direction);
      if (nextId === null) {
        return;
      }
      setActiveId(nextId);
      focusTile(nextId);
    },
    [tiles, focusTile],
  );

  // Writes new geometry for one tile back into the full layout (preserving
  // hidden tiles), persisting via the hook and announcing the change. No-op
  // moves/resizes (blocked by the grid edge) neither persist nor announce.
  const applyGeometry = useCallback(
    (
      tile: DashboardTile,
      geometry: { x: number; y: number; w: number; h: number },
      message: string,
    ) => {
      if (
        geometry.x === tile.x &&
        geometry.y === tile.y &&
        geometry.w === tile.w &&
        geometry.h === tile.h
      ) {
        // Clamped geometry equals current — the tile is already at the grid
        // boundary (or the delta was otherwise absorbed). Silently return: no
        // layout update, no persistence write, no announcement.
        return;
      }
      setLayout(layout.map((entry) => (entry.i === tile.i ? { ...entry, ...geometry } : entry)));
      setAnnouncement(message);
    },
    [layout, setLayout],
  );

  const handleMove = useCallback(
    (tileId: string, direction: MoveDirection) => {
      const tile = layout.find((entry) => entry.i === tileId);
      if (tile === undefined) {
        return;
      }
      const geometry = moveCell(tile, direction, GRID_COLUMNS);
      applyGeometry(
        tile,
        geometry,
        formatMoveAnnouncement(SIGNAL_LABELS[tile.signal], tile.repo, geometry.x, geometry.y),
      );
    },
    [layout, applyGeometry],
  );

  const handleResize = useCallback(
    (tileId: string, dimension: ResizeDimension, delta: number) => {
      const tile = layout.find((entry) => entry.i === tileId);
      if (tile === undefined) {
        return;
      }
      const geometry = resizeCell(tile, dimension, delta, GRID_COLUMNS);
      applyGeometry(
        tile,
        geometry,
        formatResizeAnnouncement(SIGNAL_LABELS[tile.signal], tile.repo, geometry.w, geometry.h),
      );
    },
    [layout, applyGeometry],
  );

  if (error !== null) {
    return (
      <section aria-label="Dashboard" className="flex flex-col gap-3">
        <div
          role="alert"
          className="rounded-md border border-[color-mix(in_srgb,var(--color-failure)_30%,var(--color-surface))] bg-[color-mix(in_srgb,var(--color-failure)_10%,var(--color-surface))] px-4 py-3 text-sm text-accent-failure"
        >
          <p className="font-medium">Couldn’t load your dashboard.</p>
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

  if (loading && tiles.length === 0) {
    return (
      <section aria-label="Dashboard">
        <p role="status" aria-live="polite" className="sr-only">
          Loading dashboard…
        </p>
        <div
          aria-busy="true"
          aria-hidden="true"
          className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
        >
          {Array.from({ length: SKELETON_TILES }, (_, index) => (
            <div
              key={`skeleton-${index}`}
              className="flex h-40 flex-col gap-4 rounded-md border border-border bg-surface p-4"
            >
              <span className="block h-3 w-24 animate-pulse rounded bg-surface-raised motion-reduce:animate-none" />
              <span className="block h-8 w-16 animate-pulse rounded bg-surface-raised motion-reduce:animate-none" />
              <span className="block h-3 w-32 animate-pulse rounded bg-surface-raised motion-reduce:animate-none" />
            </div>
          ))}
        </div>
      </section>
    );
  }

  if (tiles.length === 0) {
    return (
      <section aria-label="Dashboard">
        <FleetSummaryTile summary={summary} entries={fleetEntries} />
        <p className="mt-4 rounded-md border border-border bg-surface px-4 py-10 text-center text-sm text-text-muted">
          No repositories to display.
        </p>
      </section>
    );
  }

  return (
    <section aria-label="Dashboard">
      <FleetSummaryTile summary={summary} entries={fleetEntries} />
      <div
        ref={gridRef}
        role="grid"
        aria-label="Dashboard tiles"
        aria-colcount={GRID_COLUMNS}
        aria-rowcount={ariaRowCount}
        onKeyDown={handleGridKeyDown}
        className="mt-4"
      >
        <ResponsiveGridLayout
          className={cn('layout', editing && 'dashboard-editing')}
          layouts={layouts}
          breakpoints={BREAKPOINTS}
          cols={COLS}
          rowHeight={ROW_HEIGHT}
          margin={MARGIN}
          isDraggable={editing}
          isResizable={editing}
          isDroppable={false}
          draggableCancel={DRAG_CANCEL_SELECTOR}
          compactType="vertical"
          useCSSTransforms={!reducedMotion}
          onLayoutChange={handleLayoutChange}
        >
          {tiles.map(({ tile, repo }) => (
            <div key={tile.i} role="row" aria-rowindex={tile.y + 1}>
              <SignalTile
                tile={tile}
                repo={repo}
                data={repoData.get(repo.nameWithOwner) ?? {}}
                onActivate={onRepoActivate}
                active={tile.i === activeTileId}
                editing={editing}
                onTileFocus={handleTileFocus}
                onMove={handleMove}
                onResize={handleResize}
                rowIndex={tile.y + 1}
                colIndex={tile.x + 1}
              />
            </div>
          ))}
        </ResponsiveGridLayout>
      </div>
      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>
    </section>
  );
}
