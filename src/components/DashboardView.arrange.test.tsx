import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { useRef } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useDashboardLayout } from '../hooks/useDashboardLayout';
import { DEFAULT_LAYOUT } from '../lib/dashboard-layout';
import type { DashboardTile } from '../types/dashboard';
import type { GetRowData, Repo } from '../types/fleet';

/**
 * Phase 3 Wave C (C2) — the arrange-while-filtered verification net.
 *
 * This file is a characterization/verification net for the C1 repo-filter
 * projection + B1 arrange-guard: it proves the arrange ↔ filter behaviours hold
 * across the full matrix (a hidden tile's geometry surviving a sibling drag,
 * unfiltered drag/keyboard still persisting, every arrange affordance disabled
 * while filtered, and the keyboard neighbour search ignoring projected-out
 * tiles). The assertions read the persisted VALUES (never spy counts), which is
 * the robust shape under Node 20's localStorage shim (see LEARNINGS.md).
 *
 * react-grid-layout never fires `onLayoutChange` from a real pointer drag in
 * jsdom (it reports a 0px container), so we stub the grid with a mock that
 * re-emits a *changed* geometry on demand (the `rgl-emit-change` button moves the
 * first visible tile, as RGL's vertical compaction would on mount / when the
 * filtered `layouts` change). The mock also records its latest props so the
 * pointer-edit gates (`isDraggable`/`isResizable`) can be asserted directly, and
 * renders `children` so the real tiles (and their keyboard affordances) mount.
 */
interface MockGridProps {
  children: ReactNode;
  layouts: { lg: Array<{ i: string; x: number; y: number; w: number; h: number }> };
  isDraggable?: boolean;
  isResizable?: boolean;
  onLayoutChange?: (
    layout: Array<{ i: string; x: number; y: number; w: number; h: number }>,
    layouts: unknown,
  ) => void;
}

let lastGridProps: MockGridProps | null = null;

vi.mock('react-grid-layout/legacy', () => ({
  Responsive: () => null,
  WidthProvider: () =>
    function MockGrid(props: MockGridProps): ReactElement {
      lastGridProps = props;
      const current = props.layouts.lg;
      const moved = current.map((item, index) =>
        index === 0 ? { ...item, x: 6, y: 4, w: 4, h: 3 } : item,
      );
      return (
        <div>
          <button type="button" onClick={() => props.onLayoutChange?.(moved, props.layouts)}>
            rgl-emit-change
          </button>
          {props.children}
        </div>
      );
    },
}));

// Activity tiles self-fetch via `useCommitActivity` (which reads the auth
// context); stub it so the rendered tiles mount without an AuthProvider.
vi.mock('../hooks/useCommitActivity', () => ({
  useCommitActivity: vi.fn(() => ({ state: 'empty' })),
}));

// Imported after the mock so DashboardView picks up the stubbed grid.
const { DashboardView } = await import('./DashboardView');

const STORAGE_KEY = 'fleet:dashboard-layout';

function makeRepo(nameWithOwner: string): Repo {
  const [owner, name] = nameWithOwner.split('/');
  return { nameWithOwner, owner, name, isPrivate: false };
}

const emptyData: GetRowData = () => ({});

function readPersisted(): DashboardTile[] {
  return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as DashboardTile[];
}

/**
 * Wires DashboardView to the real {@link useDashboardLayout} (so persistence has
 * its production debounce/merge semantics) and exposes two buttons that flip the
 * Security tile's visibility. A ref mirrors the latest layout so the flip closures
 * never go stale across the multi-step round-trip.
 */
function ArrangeHarness({
  repos,
  repoFilter,
  editing,
}: {
  repos: Repo[];
  repoFilter?: Set<string>;
  editing?: boolean;
}): ReactElement {
  const { layout, setLayout } = useDashboardLayout(repos);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const setVisibility = (id: string, visible: boolean): void =>
    setLayout(layoutRef.current.map((tile) => (tile.i === id ? { ...tile, visible } : tile)));
  return (
    <div>
      <button type="button" onClick={() => setVisibility('octo/a:security', false)}>
        hide-security
      </button>
      <button type="button" onClick={() => setVisibility('octo/a:security', true)}>
        show-security
      </button>
      <DashboardView
        repos={repos}
        getRowData={emptyData}
        onRepoActivate={vi.fn()}
        layout={layout}
        onLayoutChange={setLayout}
        repoFilter={repoFilter}
        editing={editing}
      />
    </div>
  );
}

beforeEach(() => {
  localStorage.clear();
  lastGridProps = null;
});

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('DashboardView — AC-12 hidden tile geometry round-trip', () => {
  it("preserves a hidden tile's persisted geometry across a sibling drag + un-hide", () => {
    // Persistence is debounced 300 ms, so flush fake timers before reading the
    // stored value or the assertion false-greens against the pre-flush baseline.
    vi.useFakeTimers();
    try {
      const repos = [makeRepo('octo/a')];
      const original = DEFAULT_LAYOUT(repos).find((tile) => tile.i === 'octo/a:security');
      expect(original).toBeDefined();

      render(<ArrangeHarness repos={repos} editing />);

      // Hide the Security tile (a visibility flip — purely a `visible` change).
      fireEvent.click(screen.getByText('hide-security'));
      expect(screen.queryByRole('button', { name: /security: .*octo\/a/i })).toBeNull();

      // Drag a VISIBLE sibling: the mock re-emits a moved geometry for the first
      // visible tile (CI), as RGL's vertical compaction would.
      fireEvent.click(screen.getByText('rgl-emit-change'));

      // Un-hide the Security tile — it returns to the grid.
      fireEvent.click(screen.getByText('show-security'));
      expect(screen.getByRole('button', { name: /security: .*octo\/a/i })).toBeInTheDocument();

      // Flush the persist debounce so the stored value is the final layout.
      act(() => {
        vi.advanceTimersByTime(400);
      });

      const persisted = readPersisted();
      const security = persisted.find((tile) => tile.i === 'octo/a:security');
      const ci = persisted.find((tile) => tile.i === 'octo/a:ci');
      // The hidden tile carried no RGL grid item, so `mergeLayoutGeometry` left it
      // untouched: its geometry is byte-intact and it is visible again.
      expect(security).toMatchObject({
        x: original?.x,
        y: original?.y,
        w: original?.w,
        h: original?.h,
        visible: true,
      });
      // ...and the dragged sibling's new geometry DID persist (the drag had teeth).
      expect(ci).toMatchObject({ x: 6, y: 4, w: 4, h: 3 });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('DashboardView — AC-11 arrange persists when unfiltered (no regression)', () => {
  it('persists a pointer drag (RGL onLayoutChange) when no filter is active', () => {
    vi.useFakeTimers();
    try {
      const repos = [makeRepo('octo/a')];
      render(<ArrangeHarness repos={repos} editing />);

      fireEvent.click(screen.getByText('rgl-emit-change'));
      act(() => {
        vi.advanceTimersByTime(400);
      });

      expect(readPersisted().find((tile) => tile.i === 'octo/a:ci')).toMatchObject({
        x: 6,
        y: 4,
        w: 4,
        h: 3,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('persists a keyboard Move and Resize when no filter is active', () => {
    vi.useFakeTimers();
    try {
      const repos = [makeRepo('octo/a')];
      render(<ArrangeHarness repos={repos} editing />);

      // Keyboard Move right: CI column 0 → 1. Keyboard Grow width: CI width 3 → 4.
      fireEvent.click(screen.getByRole('button', { name: /move ci · octo\/a right/i }));
      fireEvent.click(screen.getByRole('button', { name: /grow ci · octo\/a width/i }));
      act(() => {
        vi.advanceTimersByTime(400);
      });

      expect(readPersisted().find((tile) => tile.i === 'octo/a:ci')).toMatchObject({
        x: 1,
        w: 4,
      });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('DashboardView — AC-13 arrange disabled while filtered', () => {
  it('suppresses the rail, announces the hint, and never persists a compaction change', () => {
    vi.useFakeTimers();
    try {
      const repos = [makeRepo('octo/a')];
      const seeded = JSON.stringify(DEFAULT_LAYOUT(repos));
      localStorage.setItem(STORAGE_KEY, seeded);

      render(<ArrangeHarness repos={repos} repoFilter={new Set(['octo/a'])} editing />);

      // The keyboard Move/Resize rail is gone — no arrange affordance while filtered.
      expect(screen.queryByRole('button', { name: /move ci · octo\/a right/i })).toBeNull();
      expect(screen.queryByRole('button', { name: /grow ci · octo\/a width/i })).toBeNull();

      // The blocked-arrange hint is announced in the accessibility tree: a
      // `role="status"` node is an implicit polite live region.
      const hint = screen.getByText(/clear the filter to rearrange tiles/i);
      expect(hint).toHaveAttribute('role', 'status');

      // The pointer drag/resize gates are off too.
      expect(lastGridProps?.isDraggable).toBe(false);
      expect(lastGridProps?.isResizable).toBe(false);

      // A compaction-fired onLayoutChange must NOT persist while filtered. Flush
      // the debounce so the byte-unchanged assertion has teeth: were the guard
      // removed, a partial/compacted layout would land within 300 ms.
      fireEvent.click(screen.getByText('rgl-emit-change'));
      act(() => {
        vi.advanceTimersByTime(400);
      });
      expect(localStorage.getItem(STORAGE_KEY)).toBe(seeded);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('DashboardView — keyboard neighbour parity over filtered cells', () => {
  function renderGrid(repoFilter?: Set<string>): void {
    const repos = [makeRepo('octo/a'), makeRepo('octo/b')];
    render(
      <DashboardView
        repos={repos}
        getRowData={emptyData}
        onRepoActivate={vi.fn()}
        layout={DEFAULT_LAYOUT(repos)}
        onLayoutChange={vi.fn()}
        repoFilter={repoFilter}
      />,
    );
  }

  it('unfiltered: ArrowRight from the last first-repo tile crosses into the next repo', () => {
    renderGrid();
    // octo/a Activity sits at x6,y2; its nearest right-neighbour by centre
    // distance is octo/b's CI tile at x9,y2.
    const activity = screen.getByRole('button', { name: /activity: .*octo\/a/i });
    act(() => activity.focus());
    fireEvent.keyDown(activity, { key: 'ArrowRight' });
    expect(screen.getByRole('button', { name: /ci: .*octo\/b/i })).toHaveFocus();
  });

  it('filtered: the SAME ArrowRight skips the projected-out repo (neighbour search ignores it)', () => {
    renderGrid(new Set(['octo/a']));
    // octo/b is projected out of the grid entirely — its tiles never render.
    const grid = screen.getByRole('grid', { name: /dashboard tiles/i });
    expect(within(grid).queryByRole('button', { name: /ci: .*octo\/b/i })).toBeNull();

    const activity = screen.getByRole('button', { name: /activity: .*octo\/a/i });
    act(() => activity.focus());
    fireEvent.keyDown(activity, { key: 'ArrowRight' });
    // octo/b's CI was the unfiltered neighbour; with it absent from `cells`,
    // focus stays within octo/a (its pull-requests tile is now the nearest
    // rendered right-neighbour). The filtered-out tile is never visited.
    expect(screen.getByRole('button', { name: /pull requests: .*octo\/a/i })).toHaveFocus();
  });
});
