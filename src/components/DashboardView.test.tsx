import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_LAYOUT } from '../lib/dashboard-layout';
import type { GetRowData, Repo } from '../types/fleet';
import { DashboardView } from './DashboardView';

const STORAGE_KEY = 'fleet:dashboard-layout';

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
});

describe('DashboardView', () => {
  it('renders an accessible dashboard region', () => {
    render(
      <DashboardView
        repos={[makeRepo('octo/a')]}
        getRowData={emptyData}
        onRepoActivate={vi.fn()}
      />,
    );
    expect(screen.getByRole('region', { name: /dashboard/i })).toBeInTheDocument();
  });

  it('renders one tile per visible signal for each repo', () => {
    render(
      <DashboardView
        repos={[makeRepo('octo/a')]}
        getRowData={emptyData}
        onRepoActivate={vi.fn()}
      />,
    );
    // Six per-repo signals → six tiles for a single repo.
    expect(screen.getAllByRole('button', { name: /view .* details for octo\/a/i })).toHaveLength(6);
  });

  it('passes per-repo signal data through to its tiles', () => {
    const getRowData: GetRowData = (repo) =>
      repo.nameWithOwner === 'octo/a' ? { ci: { status: 'ready', conclusion: 'failure' } } : {};
    render(
      <DashboardView
        repos={[makeRepo('octo/a')]}
        getRowData={getRowData}
        onRepoActivate={vi.fn()}
      />,
    );
    expect(screen.getByText('Failing')).toBeInTheDocument();
  });

  it('calls onRepoActivate when a tile is activated (opens the drill-down)', async () => {
    const onRepoActivate = vi.fn();
    const repo = makeRepo('octo/a');
    const user = userEvent.setup();
    render(<DashboardView repos={[repo]} getRowData={emptyData} onRepoActivate={onRepoActivate} />);
    await user.click(screen.getAllByRole('button', { name: /view .* details for octo\/a/i })[0]);
    expect(onRepoActivate).toHaveBeenCalledWith(repo);
  });

  it('shows an empty state when there are no repos', () => {
    render(<DashboardView repos={[]} getRowData={emptyData} onRepoActivate={vi.fn()} />);
    expect(screen.getByText(/no repositories to display/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /view .* details/i })).toBeNull();
  });

  it('does not render hidden tiles', () => {
    const repos = [makeRepo('octo/a')];
    const hidden = DEFAULT_LAYOUT(repos).map((tile) => ({ ...tile, visible: false }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(hidden));
    render(<DashboardView repos={repos} getRowData={emptyData} onRepoActivate={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /view .* details/i })).toBeNull();
    expect(screen.getByText(/no repositories to display/i)).toBeInTheDocument();
  });

  it('renders a static, non-draggable grid by default (not editing)', () => {
    const { container } = render(
      <DashboardView
        repos={[makeRepo('octo/a')]}
        getRowData={emptyData}
        onRepoActivate={vi.fn()}
      />,
    );
    const item = container.querySelector('.react-grid-item');
    expect(item).not.toBeNull();
    // Without edit mode the grid item is neither draggable nor actively resizable.
    expect(item).not.toHaveClass('react-draggable');
    expect(item).toHaveClass('react-resizable-hide');
  });

  it('enables drag + resize on the grid items when editing', () => {
    const { container } = render(
      <DashboardView
        repos={[makeRepo('octo/a')]}
        getRowData={emptyData}
        onRepoActivate={vi.fn()}
        editing
      />,
    );
    const item = container.querySelector('.react-grid-item');
    expect(item).not.toBeNull();
    expect(item).toHaveClass('react-draggable');
    // The resize handle is no longer hidden, and the editing affordance class is set.
    expect(item).not.toHaveClass('react-resizable-hide');
    expect(container.querySelector('.dashboard-editing')).not.toBeNull();
    expect(container.querySelector('.react-resizable-handle')).not.toBeNull();
  });

  it('keeps tiles keyboard-activatable while editing', async () => {
    const onRepoActivate = vi.fn();
    const repo = makeRepo('octo/a');
    const user = userEvent.setup();
    render(
      <DashboardView
        repos={[repo]}
        getRowData={emptyData}
        onRepoActivate={onRepoActivate}
        editing
      />,
    );
    await user.click(screen.getAllByRole('button', { name: /view .* details for octo\/a/i })[0]);
    expect(onRepoActivate).toHaveBeenCalledWith(repo);
  });

  it('uses CSS transforms for positioning when motion is allowed', () => {
    const { container } = render(
      <DashboardView
        repos={[makeRepo('octo/a')]}
        getRowData={emptyData}
        onRepoActivate={vi.fn()}
      />,
    );
    const item = container.querySelector('.react-grid-item') as HTMLElement | null;
    expect(item?.getAttribute('style')).toContain('transform');
  });

  it('disables CSS transform animation when the user prefers reduced motion', () => {
    const matchMedia = vi.fn().mockReturnValue({
      matches: true,
      media: '(prefers-reduced-motion: reduce)',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal('matchMedia', matchMedia);
    try {
      const { container } = render(
        <DashboardView
          repos={[makeRepo('octo/a')]}
          getRowData={emptyData}
          onRepoActivate={vi.fn()}
        />,
      );
      const item = container.querySelector('.react-grid-item') as HTMLElement | null;
      const style = item?.getAttribute('style') ?? '';
      expect(style).not.toContain('transform');
      // Falls back to top/left positioning instead.
      expect(style).toContain('top');
      expect(style).toContain('left');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('computes each repo signal data once per render (no per-tile recomputation)', () => {
    const getRowData = vi.fn<GetRowData>(() => ({}));
    render(
      <DashboardView
        repos={[makeRepo('octo/a'), makeRepo('octo/b')]}
        getRowData={getRowData}
        onRepoActivate={vi.fn()}
      />,
    );
    // Two repos → six tiles each. Data must be resolved once per repo, not per tile.
    const uniqueRepos = new Set(getRowData.mock.calls.map(([repo]) => repo.nameWithOwner));
    expect(uniqueRepos.size).toBe(2);
    expect(getRowData).toHaveBeenCalledTimes(2);
  });
});
