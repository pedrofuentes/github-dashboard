import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useDashboardLayout } from '../hooks/useDashboardLayout';
import { DEFAULT_LAYOUT } from '../lib/dashboard-layout';
import type { DashboardTile } from '../types/dashboard';
import type { GetRowData, Repo } from '../types/fleet';

/**
 * Phase 3 Wave C (C1) — the repo-filter projection and its B1 arrange-guard.
 *
 * react-grid-layout never fires `onLayoutChange` from a real pointer drag in
 * jsdom (it reports a 0px container). To exercise the persistence guard we mock
 * the grid with a stub that re-emits a *changed* geometry on demand (one button
 * fires `onLayoutChange` with a moved first tile, as RGL's vertical compaction
 * would on mount / when the filtered `layouts` change). The stub also records
 * its latest props so the pointer-edit gates (`isDraggable`/`isResizable`) can be
 * asserted directly.
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

beforeEach(() => {
  localStorage.clear();
  lastGridProps = null;
});

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('DashboardView — repo-filter projection', () => {
  it('renders only tiles for repos included in the active filter', () => {
    const repos = [makeRepo('octo/a'), makeRepo('octo/b')];
    render(
      <DashboardView
        repos={repos}
        getRowData={emptyData}
        onRepoActivate={vi.fn()}
        layout={DEFAULT_LAYOUT(repos)}
        onLayoutChange={vi.fn()}
        repoFilter={new Set(['octo/a'])}
      />,
    );
    expect(screen.getAllByRole('button', { name: /: .*octo\/a/i }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /: .*octo\/b/i })).toBeNull();
  });

  it('renders the whole fleet when no filter is active (empty selection ⇒ all shown)', () => {
    const repos = [makeRepo('octo/a'), makeRepo('octo/b')];
    render(
      <DashboardView
        repos={repos}
        getRowData={emptyData}
        onRepoActivate={vi.fn()}
        layout={DEFAULT_LAYOUT(repos)}
        onLayoutChange={vi.fn()}
        repoFilter={new Set()}
      />,
    );
    expect(screen.getAllByRole('button', { name: /: .*octo\/a/i }).length).toBe(7);
    expect(screen.getAllByRole('button', { name: /: .*octo\/b/i }).length).toBe(7);
  });

  it('keeps a hidden tile hidden across a filter apply + clear (orthogonal to visibility, AC-7)', () => {
    const repos = [makeRepo('octo/a')];
    const layout = DEFAULT_LAYOUT(repos).map((tile) =>
      tile.signal === 'ci' ? { ...tile, visible: false } : tile,
    );
    // Seed the layout storage key so we can prove the projection never persists a
    // visibility change while filtering.
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
    const onLayoutChange = vi.fn();
    const props = {
      repos,
      getRowData: emptyData,
      onRepoActivate: vi.fn(),
      layout,
      onLayoutChange,
    };

    const { rerender } = render(<DashboardView {...props} repoFilter={new Set()} />);
    expect(screen.queryByRole('button', { name: /ci: .*octo\/a/i })).toBeNull();

    rerender(<DashboardView {...props} repoFilter={new Set(['octo/a'])} />);
    expect(screen.queryByRole('button', { name: /ci: .*octo\/a/i })).toBeNull();

    rerender(<DashboardView {...props} repoFilter={new Set()} />);
    expect(screen.queryByRole('button', { name: /ci: .*octo\/a/i })).toBeNull();

    // The filter is purely presentational: it never called the layout setter, and
    // the persisted `visible: false` is byte-for-byte intact.
    expect(onLayoutChange).not.toHaveBeenCalled();
    const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as DashboardTile[];
    expect(persisted.find((tile) => tile.i === 'octo/a:ci')?.visible).toBe(false);
  });

  it('renders a repo alias as the tile name while still announcing the real repo (I-2)', () => {
    const repos = [makeRepo('octo/a')];
    render(
      <DashboardView
        repos={repos}
        getRowData={emptyData}
        onRepoActivate={vi.fn()}
        layout={DEFAULT_LAYOUT(repos)}
        onLayoutChange={vi.fn()}
        aliases={{ 'octo/a': 'Alpha' }}
      />,
    );

    // The alias is the visible heading text, and the real nameWithOwner is still
    // announced via the visually-hidden "(alias for …)" suffix + the heading title.
    const headings = screen.getAllByRole('heading', {
      level: 3,
      name: /alpha\s*\(alias for octo\/a\)/i,
    });
    expect(headings.length).toBe(7);
    expect(headings[0]).toHaveAttribute('title', 'octo/a');

    // The activate control's accessible name keeps the real repo, not the alias.
    expect(screen.getAllByRole('button', { name: /: .*octo\/a/i }).length).toBe(7);
    expect(screen.queryByRole('button', { name: /alpha/i })).toBeNull();
  });
});

describe('DashboardView — B1 arrange-guard while filtered', () => {
  function GuardHarness({
    repos,
    repoFilter,
  }: {
    repos: Repo[];
    repoFilter: Set<string>;
  }): ReactElement {
    const { layout, setLayout } = useDashboardLayout(repos);
    return (
      <DashboardView
        repos={repos}
        getRowData={emptyData}
        onRepoActivate={vi.fn()}
        layout={layout}
        onLayoutChange={setLayout}
        repoFilter={repoFilter}
      />
    );
  }

  it('does NOT persist a compaction-fired geometry change while a filter is active', () => {
    // Persistence is debounced 300 ms, so a synchronous getItem assertion passes
    // with or without the guard (the write hasn't flushed). Use fake timers and
    // flush past the debounce so the assertion has teeth (red-team I-1).
    vi.useFakeTimers();
    try {
      const repos = [makeRepo('octo/a')];
      const seeded = JSON.stringify(DEFAULT_LAYOUT(repos));
      localStorage.setItem(STORAGE_KEY, seeded);

      render(<GuardHarness repos={repos} repoFilter={new Set(['octo/a'])} />);
      // Simulate react-grid-layout firing onLayoutChange (vertical compaction).
      fireEvent.click(screen.getByText('rgl-emit-change'));
      act(() => {
        vi.advanceTimersByTime(400);
      });

      // Byte-unchanged: the guard prevented the partial/compacted layout from
      // being persisted while filtered.
      expect(localStorage.getItem(STORAGE_KEY)).toBe(seeded);
    } finally {
      vi.useRealTimers();
    }
  });

  it('positive control: persists the SAME change when no filter is active (proves teeth)', () => {
    vi.useFakeTimers();
    try {
      const repos = [makeRepo('octo/a')];
      const seeded = JSON.stringify(DEFAULT_LAYOUT(repos));
      localStorage.setItem(STORAGE_KEY, seeded);

      render(<GuardHarness repos={repos} repoFilter={new Set()} />);
      fireEvent.click(screen.getByText('rgl-emit-change'));
      act(() => {
        vi.advanceTimersByTime(400);
      });

      expect(localStorage.getItem(STORAGE_KEY)).not.toBe(seeded);
    } finally {
      vi.useRealTimers();
    }
  });

  it('disables pointer drag/resize and hides the keyboard rail while filtered', () => {
    const repos = [makeRepo('octo/a')];
    render(
      <DashboardView
        repos={repos}
        getRowData={emptyData}
        onRepoActivate={vi.fn()}
        layout={DEFAULT_LAYOUT(repos)}
        onLayoutChange={vi.fn()}
        repoFilter={new Set(['octo/a'])}
        editing
      />,
    );
    // The keyboard Move/Resize rail is suppressed while filtered.
    expect(screen.queryByRole('button', { name: /move ci · octo\/a right/i })).toBeNull();
    // The pointer drag/resize gates are off while filtered.
    expect(lastGridProps?.isDraggable).toBe(false);
    expect(lastGridProps?.isResizable).toBe(false);
  });

  it('keeps the rail and drag enabled when editing WITHOUT a filter (control)', () => {
    const repos = [makeRepo('octo/a')];
    render(
      <DashboardView
        repos={repos}
        getRowData={emptyData}
        onRepoActivate={vi.fn()}
        layout={DEFAULT_LAYOUT(repos)}
        onLayoutChange={vi.fn()}
        repoFilter={new Set()}
        editing
      />,
    );
    expect(screen.getByRole('button', { name: /move ci · octo\/a right/i })).toBeInTheDocument();
    expect(lastGridProps?.isDraggable).toBe(true);
    expect(lastGridProps?.isResizable).toBe(true);
  });

  it('shows the arrange-blocked hint while editing with an active filter (AC-13)', () => {
    const repos = [makeRepo('octo/a')];
    render(
      <DashboardView
        repos={repos}
        getRowData={emptyData}
        onRepoActivate={vi.fn()}
        layout={DEFAULT_LAYOUT(repos)}
        onLayoutChange={vi.fn()}
        repoFilter={new Set(['octo/a'])}
        editing
      />,
    );
    expect(screen.getByText(/clear the filter to rearrange tiles/i)).toBeInTheDocument();
  });
});

describe('DashboardView — empty-state discrimination (I1)', () => {
  it('shows the empty-fleet copy when there are no repos', () => {
    render(
      <DashboardView
        repos={[]}
        getRowData={emptyData}
        onRepoActivate={vi.fn()}
        layout={[]}
        onLayoutChange={vi.fn()}
      />,
    );
    expect(screen.getByText(/no repositories to display/i)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /fleet summary/i })).toBeInTheDocument();
  });

  it('shows the all-hidden recovery copy when every tile is hidden', () => {
    const repos = [makeRepo('octo/a')];
    const hidden = DEFAULT_LAYOUT(repos).map((tile) => ({ ...tile, visible: false }));
    render(
      <DashboardView
        repos={repos}
        getRowData={emptyData}
        onRepoActivate={vi.fn()}
        layout={hidden}
        onLayoutChange={vi.fn()}
      />,
    );
    expect(screen.getByText(/all tiles hidden/i)).toBeInTheDocument();
    expect(screen.queryByText(/no repositories to display/i)).toBeNull();
  });

  it('shows the filtered-empty copy + a Clear filter action when the filter excludes everything', async () => {
    const onClearFilter = vi.fn();
    const repos = [makeRepo('octo/a')];
    const user = userEvent.setup();
    render(
      <DashboardView
        repos={repos}
        getRowData={emptyData}
        onRepoActivate={vi.fn()}
        layout={DEFAULT_LAYOUT(repos)}
        onLayoutChange={vi.fn()}
        repoFilter={new Set(['octo/not-in-fleet'])}
        onClearFilter={onClearFilter}
      />,
    );
    expect(screen.getByText(/no tiles match the current filter/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /clear filter/i }));
    expect(onClearFilter).toHaveBeenCalledTimes(1);
  });
});

describe('DashboardView — hideRepoHeader derivation reaches the tiles (#335)', () => {
  const repos = [makeRepo('octo/a'), makeRepo('octo/b')];

  function renderFiltered(repoFilter: Set<string> | undefined): void {
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

  it('drops the visible repo header on every tile when the filter narrows to exactly one repo', () => {
    renderFiltered(new Set(['octo/a']));

    // D1 integration: the projection leaves only octo/a's tiles, and the
    // single-repo derivation (`repoFilter.size === 1`) must actually reach each
    // tile as `hideRepoHeader` — so every visible repo header line is dropped to
    // `sr-only`. The TileFrame leaf test (TileFrame.test) only proves the prop is
    // honoured; this asserts DashboardView WIRES it from the filter (#335).
    const headings = screen.getAllByRole('heading', { level: 3, name: 'octo/a' });
    expect(headings.length).toBeGreaterThan(0);
    headings.forEach((heading) => {
      expect(heading).toHaveClass('sr-only');
      // UX-only: repo identity never leaves the a11y tree (AC-10) — the real
      // `nameWithOwner` still rides the heading `title`.
      expect(heading).toHaveAttribute('title', 'octo/a');
    });
    // The excluded repo's tiles are projected out entirely (no stray headers).
    expect(screen.queryByRole('heading', { level: 3, name: 'octo/b' })).toBeNull();
  });

  it('keeps the visible repo header when two or more repos are selected', () => {
    renderFiltered(new Set(['octo/a', 'octo/b']));

    // `size > 1` ⇒ `filteredToOneRepo` false ⇒ `hideRepoHeader` false: each tile
    // keeps its visible repo line so the user can tell the repos apart.
    for (const name of ['octo/a', 'octo/b']) {
      const headings = screen.getAllByRole('heading', { level: 3, name });
      expect(headings.length).toBeGreaterThan(0);
      headings.forEach((heading) => expect(heading).not.toHaveClass('sr-only'));
    }
  });

  it('keeps the visible repo header when no filter is active (empty selection ⇒ all shown)', () => {
    renderFiltered(new Set());

    for (const name of ['octo/a', 'octo/b']) {
      const headings = screen.getAllByRole('heading', { level: 3, name });
      expect(headings.length).toBeGreaterThan(0);
      headings.forEach((heading) => expect(heading).not.toHaveClass('sr-only'));
    }
  });
});
