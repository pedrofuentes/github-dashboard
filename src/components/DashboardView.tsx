/**
 * DashboardView — the at-a-glance tile arrangement for the fleet (M10 T2/T3).
 *
 * Renders one {@link SignalTile} per *visible* tile from the persisted dashboard
 * layout, positioned on react-grid-layout. By default the grid is static; an
 * opt-in `editing` mode enables pointer drag + resize (T3). Keyboard-accessible
 * reorder/resize is the WCAG-AA gate that follows in T4 — until then the
 * arrangement is pointer-only. Both this view and the table grid open the same
 * drill-down drawer via `onRepoActivate`.
 *
 * Note: `Responsive` + `WidthProvider` (the width-measuring HOC, with the flat
 * v1-style `layouts` / `breakpoints` / `cols` / `isDraggable` / `isResizable`
 * props this view relies on) are imported from `react-grid-layout/legacy`, the
 * subpath that re-exports them in react-grid-layout v2.
 */
import { useCallback, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { Responsive, WidthProvider } from 'react-grid-layout/legacy';
import type { Layout, ResponsiveLayouts } from 'react-grid-layout/legacy';
import 'react-grid-layout/css/styles.css';

import { useDashboardLayout } from '../hooks/useDashboardLayout';
import { cn } from '../lib/cn';
import { toRglLayout } from '../lib/dashboard-layout';
import { mergeLayoutGeometry } from '../lib/dashboard-layout-merge';
import type { DashboardTile } from '../types/dashboard';
import type { GetRowData, Repo, RepoSignalData } from '../types/fleet';
import { SignalTile } from './SignalTile';

const ResponsiveGridLayout = WidthProvider(Responsive);

/** Breakpoints with a fixed 12-column grid so tiles keep their 3×2 geometry. */
const BREAKPOINTS = { lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 } as const;
const COLS = { lg: 12, md: 12, sm: 12, xs: 12, xxs: 12 } as const;
const ROW_HEIGHT = 96;
const MARGIN: [number, number] = [16, 16];

export interface DashboardViewProps {
  /** The fleet repositories (drive the default layout + tile lookup). */
  repos: Repo[];
  /** Resolves the per-repo signal slices for each tile. */
  getRowData: GetRowData;
  /** Opens the drill-down drawer for the activated tile's repo. */
  onRepoActivate: (repo: Repo) => void;
  /** When true, the grid items can be dragged and resized with a pointer. */
  editing?: boolean;
}

interface ResolvedTile {
  tile: DashboardTile;
  repo: Repo;
}

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

  if (tiles.length === 0) {
    return (
      <section aria-label="Dashboard">
        <p className="rounded-md border border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-600">
          No repositories to display.
        </p>
      </section>
    );
  }

  return (
    <section aria-label="Dashboard">
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
        compactType="vertical"
        useCSSTransforms={!reducedMotion}
        onLayoutChange={handleLayoutChange}
      >
        {tiles.map(({ tile, repo }) => (
          <div key={tile.i}>
            <SignalTile
              tile={tile}
              repo={repo}
              data={repoData.get(repo.nameWithOwner) ?? {}}
              onActivate={onRepoActivate}
            />
          </div>
        ))}
      </ResponsiveGridLayout>
    </section>
  );
}
