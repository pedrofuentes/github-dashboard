/**
 * DashboardView — the at-a-glance tile arrangement for the fleet (M10 T2).
 *
 * Renders one {@link SignalTile} per *visible* tile from the persisted dashboard
 * layout, positioned on react-grid-layout. This increment is read-only: the grid
 * is static (no drag / resize) — interactive arrangement and an edit mode arrive
 * in T3/T4. Both this view and the table grid open the same drill-down drawer via
 * `onRepoActivate`.
 *
 * Note: `Responsive` + `WidthProvider` (the width-measuring HOC, with the flat
 * v1-style `layouts` / `breakpoints` / `cols` / `isDraggable` / `isResizable`
 * props this view relies on) are imported from `react-grid-layout/legacy`, the
 * subpath that re-exports them in react-grid-layout v2.
 */
import { useMemo } from 'react';
import type { ReactElement } from 'react';
import { Responsive, WidthProvider } from 'react-grid-layout/legacy';
import type { ResponsiveLayouts } from 'react-grid-layout/legacy';
import 'react-grid-layout/css/styles.css';

import { useDashboardLayout } from '../hooks/useDashboardLayout';
import { toRglLayout } from '../lib/dashboard-layout';
import type { DashboardTile } from '../types/dashboard';
import type { GetRowData, Repo } from '../types/fleet';
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
}

interface ResolvedTile {
  tile: DashboardTile;
  repo: Repo;
}

export function DashboardView({
  repos,
  getRowData,
  onRepoActivate,
}: DashboardViewProps): ReactElement {
  const { layout } = useDashboardLayout(repos);

  const repoIndex = useMemo(
    () => new Map(repos.map((repo) => [repo.nameWithOwner, repo])),
    [repos],
  );

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
        className="layout"
        layouts={layouts}
        breakpoints={BREAKPOINTS}
        cols={COLS}
        rowHeight={ROW_HEIGHT}
        margin={MARGIN}
        isDraggable={false}
        isResizable={false}
        isDroppable={false}
        compactType="vertical"
      >
        {tiles.map(({ tile, repo }) => (
          <div key={tile.i}>
            <SignalTile
              tile={tile}
              repo={repo}
              data={getRowData(repo)}
              onActivate={onRepoActivate}
            />
          </div>
        ))}
      </ResponsiveGridLayout>
    </section>
  );
}
