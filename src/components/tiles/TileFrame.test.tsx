import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { Repo } from '../../types/fleet';
import { TileFrame } from './TileFrame';

function makeRepo(nameWithOwner = 'octo/a'): Repo {
  const [owner, name] = nameWithOwner.split('/');
  return { nameWithOwner, owner, name, isPrivate: false };
}

function renderFrame(overrides: Partial<React.ComponentProps<typeof TileFrame>> = {}) {
  const props: React.ComponentProps<typeof TileFrame> = {
    repo: makeRepo(),
    signalLabel: 'CI',
    tone: 'info',
    status: 'ready',
    size: 'standard',
    tileId: 'octo/a:ci',
    onActivate: vi.fn(),
    children: <p>body content</p>,
    ...overrides,
  };
  return { props, ...render(<TileFrame {...props} />) };
}

describe('TileFrame — shell anatomy', () => {
  it('renders as a gridcell carrying the data-status attribute', () => {
    const { container } = renderFrame({ status: 'loading' });
    const cell = screen.getByRole('gridcell');
    expect(cell).toBe(container.querySelector('[data-status="loading"]'));
  });

  it('renders the repo name (truncated, with a title) and the signal label', () => {
    renderFrame();
    const heading = screen.getByText('octo/a');
    expect(heading).toHaveAttribute('title', 'octo/a');
    expect(screen.getByText('CI')).toBeInTheDocument();
  });

  it('renders a top accent bar tinted with the resolved tone', () => {
    const { container } = renderFrame({ tone: 'failure' });
    const bar = container.querySelector('[data-tone="failure"]');
    expect(bar).not.toBeNull();
    expect(bar?.className).toContain('bg-accent-failure');
  });

  it('renders the body slot children', () => {
    renderFrame({ children: <span>hello body</span> });
    expect(screen.getByText('hello body')).toBeInTheDocument();
  });

  it('renders an optional footer at standard size', () => {
    renderFrame({ footer: <span>updated 5m ago</span> });
    expect(screen.getByText('updated 5m ago')).toBeInTheDocument();
  });

  it('hides the footer at the compact tier', () => {
    renderFrame({ size: 'compact', footer: <span>updated 5m ago</span> });
    expect(screen.queryByText('updated 5m ago')).toBeNull();
  });
});

describe('TileFrame — activate overlay', () => {
  it('is an activatable button that calls onActivate on click', async () => {
    const onActivate = vi.fn();
    const user = userEvent.setup();
    renderFrame({ onActivate });
    await user.click(screen.getByRole('button', { name: /view ci details for octo\/a/i }));
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it('exposes the tile id on the activation control', () => {
    renderFrame();
    expect(screen.getByRole('button', { name: /view ci details for octo\/a/i })).toHaveAttribute(
      'data-tile-activate',
      'octo/a:ci',
    );
  });

  it('is tabbable when active and removed from the tab order when inactive', () => {
    const { rerender } = renderFrame({ active: true });
    expect(screen.getByRole('button', { name: /view ci details for octo\/a/i })).toHaveAttribute(
      'tabindex',
      '0',
    );
    rerender(
      <TileFrame
        repo={makeRepo()}
        signalLabel="CI"
        tone="info"
        status="ready"
        size="standard"
        tileId="octo/a:ci"
        onActivate={vi.fn()}
        active={false}
      >
        <p>body</p>
      </TileFrame>,
    );
    expect(screen.getByRole('button', { name: /view ci details for octo\/a/i })).toHaveAttribute(
      'tabindex',
      '-1',
    );
  });

  it('reports focus via onTileFocus', async () => {
    const onTileFocus = vi.fn();
    const user = userEvent.setup();
    renderFrame({ onTileFocus });
    await user.tab();
    expect(onTileFocus).toHaveBeenCalledWith('octo/a:ci');
  });

  it('surfaces aria-colindex and aria-rowindex on the cell', () => {
    renderFrame({ colIndex: 2, rowIndex: 3 });
    const cell = screen.getByRole('gridcell');
    expect(cell).toHaveAttribute('aria-colindex', '2');
    expect(cell).toHaveAttribute('aria-rowindex', '3');
  });
});

describe('TileFrame — edit controls', () => {
  it('does not render reorder/resize controls outside edit mode', () => {
    renderFrame();
    expect(screen.queryByRole('group', { name: /reorder/i })).toBeNull();
  });

  it('renders 8 move/resize controls in edit mode', () => {
    renderFrame({ editing: true, onMove: vi.fn(), onResize: vi.fn() });
    const group = screen.getByRole('group', { name: /reorder and resize ci · octo\/a/i });
    expect(within(group).getAllByRole('button')).toHaveLength(8);
  });

  it('removes the overlay and controls from the tab order when editing but inactive', () => {
    renderFrame({ editing: true, active: false, onMove: vi.fn(), onResize: vi.fn() });
    expect(screen.getByRole('button', { name: /view ci details for octo\/a/i })).toHaveAttribute(
      'tabindex',
      '-1',
    );
    const controls = within(
      screen.getByRole('group', { name: /reorder and resize ci · octo\/a/i }),
    ).getAllByRole('button');
    expect(controls).toHaveLength(8);
    for (const control of controls) {
      expect(control).toHaveAttribute('tabindex', '-1');
    }
  });

  it('invokes onMove and onResize with the tile id', async () => {
    const onMove = vi.fn();
    const onResize = vi.fn();
    const user = userEvent.setup();
    renderFrame({ editing: true, onMove, onResize });
    await user.click(screen.getByRole('button', { name: /move ci · octo\/a right/i }));
    expect(onMove).toHaveBeenCalledWith('octo/a:ci', 'right');
    await user.click(screen.getByRole('button', { name: /grow ci · octo\/a width/i }));
    expect(onResize).toHaveBeenCalledWith('octo/a:ci', 'width', 1);
  });

  it('keeps controls out of pointer-drag via the draggableCancel hook class', () => {
    renderFrame({ editing: true, onMove: vi.fn(), onResize: vi.fn() });
    expect(screen.getByRole('button', { name: /move ci · octo\/a left/i })).toHaveClass(
      'dashboard-tile-control',
    );
  });
});
