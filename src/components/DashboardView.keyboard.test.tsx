import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { GetRowData, Repo } from '../types/fleet';
import { DashboardView } from './DashboardView';

// Activity tiles self-fetch via `useCommitActivity` (which reads the auth
// context); stub it so the full grid mounts without an AuthProvider or network.
vi.mock('../hooks/useCommitActivity', () => ({
  useCommitActivity: vi.fn(() => ({ state: 'empty' })),
}));

function makeRepo(nameWithOwner: string): Repo {
  const [owner, name] = nameWithOwner.split('/');
  return { nameWithOwner, owner, name, isPrivate: false };
}

const emptyData: GetRowData = () => ({});

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe('DashboardView — grid semantics & roving navigation', () => {
  it('wraps the tiles in an accessible grid', () => {
    render(
      <DashboardView
        repos={[makeRepo('octo/a')]}
        getRowData={emptyData}
        onRepoActivate={vi.fn()}
      />,
    );
    expect(screen.getByRole('grid', { name: /dashboard tiles/i })).toBeInTheDocument();
  });

  it('renders one gridcell per visible tile', () => {
    render(
      <DashboardView
        repos={[makeRepo('octo/a')]}
        getRowData={emptyData}
        onRepoActivate={vi.fn()}
      />,
    );
    // Seven per-repo signals → seven gridcells.
    expect(screen.getAllByRole('gridcell')).toHaveLength(7);
  });

  it('exposes a single roving tab stop (only one tile is tabbable)', () => {
    render(
      <DashboardView
        repos={[makeRepo('octo/a')]}
        getRowData={emptyData}
        onRepoActivate={vi.fn()}
      />,
    );
    const tabbable = screen
      .getAllByRole('button', { name: /: .*octo\/a/i })
      .filter((button) => button.getAttribute('tabindex') === '0');
    expect(tabbable).toHaveLength(1);
  });

  it('moves focus between tiles with the arrow keys (roving tabindex)', async () => {
    const user = userEvent.setup();
    render(
      <DashboardView
        repos={[makeRepo('octo/a')]}
        getRowData={emptyData}
        onRepoActivate={vi.fn()}
      />,
    );
    // Tab lands on the first (CI) tile, the initial roving tab stop.
    await user.tab();
    const ci = screen.getByRole('button', { name: /ci: .*octo\/a/i });
    expect(ci).toHaveFocus();

    // ArrowRight moves to the neighbouring Security tile and updates the tab stop.
    await user.keyboard('{ArrowRight}');
    const security = screen.getByRole('button', { name: /security: .*octo\/a/i });
    expect(security).toHaveFocus();
    expect(security).toHaveAttribute('tabindex', '0');
    expect(ci).toHaveAttribute('tabindex', '-1');
  });

  it('moves roving focus even when a tile id contains characters unsafe for a CSS selector', async () => {
    // Tile ids are `${nameWithOwner}:${signal}`, so a repo name with a double
    // quote yields a selector-breaking id. focusTile must escape it (CSS.escape)
    // rather than throwing a DOMException when restoring roving focus.
    const user = userEvent.setup();
    render(
      <DashboardView
        repos={[makeRepo('octo/a"b')]}
        getRowData={emptyData}
        onRepoActivate={vi.fn()}
      />,
    );
    await user.tab();
    const ci = screen.getByRole('button', { name: /ci: .*octo\/a"b/i });
    expect(ci).toHaveFocus();

    // Without CSS.escape this querySelector throws and focus never moves.
    await user.keyboard('{ArrowRight}');
    const security = screen.getByRole('button', {
      name: /security: .*octo\/a"b/i,
    });
    expect(security).toHaveFocus();
  });

  it('keeps Enter activation working from a tile (no T2 regression)', async () => {
    const onRepoActivate = vi.fn();
    const repo = makeRepo('octo/a');
    const user = userEvent.setup();
    render(<DashboardView repos={[repo]} getRowData={emptyData} onRepoActivate={onRepoActivate} />);
    await user.tab();
    await user.keyboard('{Enter}');
    expect(onRepoActivate).toHaveBeenCalledWith(repo);
  });

  it('prevents the default page scroll for an arrow key at a grid boundary', async () => {
    const user = userEvent.setup();
    render(
      <DashboardView
        repos={[makeRepo('octo/a')]}
        getRowData={emptyData}
        onRepoActivate={vi.fn()}
      />,
    );
    // Focus the first (CI) tile at the top-left corner (x=0, y=0): ArrowLeft and
    // ArrowUp have no spatial neighbour, so focus stays put — but the handler
    // must still call preventDefault() so the page doesn't native-scroll.
    await user.tab();
    const ci = screen.getByRole('button', { name: /ci: .*octo\/a/i });
    expect(ci).toHaveFocus();

    // fireEvent returns false when a handler called event.preventDefault().
    expect(fireEvent.keyDown(ci, { key: 'ArrowLeft' })).toBe(false);
    expect(fireEvent.keyDown(ci, { key: 'ArrowUp' })).toBe(false);
    // Focus is unchanged (the move was blocked), but default was still prevented.
    expect(ci).toHaveFocus();
  });

  it('exposes aria-rowindex/aria-colindex matching each tile geometry (SC 1.3.1)', () => {
    render(
      <DashboardView
        repos={[makeRepo('octo/a')]}
        getRowData={emptyData}
        onRepoActivate={vi.fn()}
      />,
    );
    // The default layout flows 4 tiles per 12-column row (each tile 3 wide, 2
    // tall): CI sits at x=0,y=0 → column 1, row 1; Security at x=3,y=0 → column
    // 4, row 1; Stale at x=3,y=2 → column 4, row 3.
    const cellFor = (name: RegExp): HTMLElement | null =>
      screen.getByRole('button', { name }).closest('[role="gridcell"]');

    const ci = cellFor(/ci: .*octo\/a/i);
    expect(ci).toHaveAttribute('aria-colindex', '1');
    expect(ci).toHaveAttribute('aria-rowindex', '1');

    const security = cellFor(/security: .*octo\/a/i);
    expect(security).toHaveAttribute('aria-colindex', '4');
    expect(security).toHaveAttribute('aria-rowindex', '1');

    const stale = cellFor(/stale: .*octo\/a/i);
    expect(stale).toHaveAttribute('aria-colindex', '4');
    expect(stale).toHaveAttribute('aria-rowindex', '3');
  });
});

describe('DashboardView — keyboard reorder & resize', () => {
  it('announces a keyboard move via a polite live region', async () => {
    const user = userEvent.setup();
    render(
      <DashboardView
        repos={[makeRepo('octo/a')]}
        getRowData={emptyData}
        onRepoActivate={vi.fn()}
        editing
      />,
    );
    // The CI tile starts at column 1 (x=0); moving right lands it at column 2.
    await user.click(screen.getByRole('button', { name: /move ci · octo\/a right/i }));
    expect(await screen.findByText('Moved CI · octo/a to column 2, row 1')).toBeInTheDocument();
  });

  it('announces a keyboard resize via the live region', async () => {
    const user = userEvent.setup();
    render(
      <DashboardView
        repos={[makeRepo('octo/a')]}
        getRowData={emptyData}
        onRepoActivate={vi.fn()}
        editing
      />,
    );
    // CI is 3×2; growing its width makes it 4×2.
    await user.click(screen.getByRole('button', { name: /grow ci · octo\/a width/i }));
    expect(await screen.findByText('Resized CI · octo/a to 4 by 2')).toBeInTheDocument();
  });

  it('does not announce a move that is blocked by the grid edge', async () => {
    const user = userEvent.setup();
    render(
      <DashboardView
        repos={[makeRepo('octo/a')]}
        getRowData={emptyData}
        onRepoActivate={vi.fn()}
        editing
      />,
    );
    // CI is at column 1 already; moving left is a no-op and must not announce.
    await user.click(screen.getByRole('button', { name: /move ci · octo\/a left/i }));
    expect(screen.queryByText(/Moved CI/)).toBeNull();
  });

  it('returns focus to the activated control after a move', async () => {
    const user = userEvent.setup();
    render(
      <DashboardView
        repos={[makeRepo('octo/a')]}
        getRowData={emptyData}
        onRepoActivate={vi.fn()}
        editing
      />,
    );
    const moveRight = screen.getByRole('button', { name: /move ci · octo\/a right/i });
    await user.click(moveRight);
    expect(moveRight).toHaveFocus();
  });

  it('persists a keyboard move to the dashboard layout', async () => {
    const user = userEvent.setup();
    render(
      <DashboardView
        repos={[makeRepo('octo/a')]}
        getRowData={emptyData}
        onRepoActivate={vi.fn()}
        editing
      />,
    );
    await user.click(screen.getByRole('button', { name: /move ci · octo\/a right/i }));

    // setLayout persists (debounced). Assert the stored value, not a spy count,
    // so the assertion is robust under Node 20's localStorage shim (see #122).
    await vi.waitFor(() => {
      const raw = localStorage.getItem('fleet:dashboard-layout');
      expect(raw).not.toBeNull();
      const tiles = JSON.parse(raw ?? '[]') as Array<{ i: string; x: number }>;
      const ci = tiles.find((tile) => tile.i === 'octo/a:ci');
      expect(ci?.x).toBe(1);
    });
  });
});

describe('DashboardView — reduced motion', () => {
  it('does not animate keyboard moves when reduced motion is preferred', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockReturnValue({
        matches: true,
        media: '(prefers-reduced-motion: reduce)',
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    );
    const user = userEvent.setup();
    const { container } = render(
      <DashboardView
        repos={[makeRepo('octo/a')]}
        getRowData={emptyData}
        onRepoActivate={vi.fn()}
        editing
      />,
    );
    await user.click(screen.getByRole('button', { name: /move ci · octo\/a right/i }));
    const item = container.querySelector('.react-grid-item') as HTMLElement | null;
    const style = item?.getAttribute('style') ?? '';
    expect(style).not.toContain('transform');
    expect(style).toContain('top');
    expect(style).toContain('left');
  });
});
