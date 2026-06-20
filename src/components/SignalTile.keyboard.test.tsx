import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { DashboardTile, TileSignalType } from '../types/dashboard';
import type { Repo } from '../types/fleet';
import { SignalTile } from './SignalTile';

function makeRepo(nameWithOwner = 'octo/a'): Repo {
  const [owner, name] = nameWithOwner.split('/');
  return { nameWithOwner, owner, name, isPrivate: false };
}

function makeTile(signal: TileSignalType = 'ci', repo = 'octo/a'): DashboardTile {
  return { i: `${repo}:${signal}`, signal, repo, x: 0, y: 0, w: 3, h: 2, visible: true };
}

describe('SignalTile — grid semantics & roving tabindex', () => {
  it('renders the tile as a gridcell', () => {
    render(<SignalTile tile={makeTile()} repo={makeRepo()} data={{}} onActivate={vi.fn()} />);
    expect(screen.getByRole('gridcell')).toBeInTheDocument();
  });

  it('exposes the tile id on the activation control for grid navigation', () => {
    render(<SignalTile tile={makeTile()} repo={makeRepo()} data={{}} onActivate={vi.fn()} />);
    expect(screen.getByRole('button', { name: /view ci details for octo\/a/i })).toHaveAttribute(
      'data-tile-activate',
      'octo/a:ci',
    );
  });

  it('is tabbable when active (the roving tab stop)', () => {
    render(
      <SignalTile tile={makeTile()} repo={makeRepo()} data={{}} onActivate={vi.fn()} active />,
    );
    expect(screen.getByRole('button', { name: /view ci details for octo\/a/i })).toHaveAttribute(
      'tabindex',
      '0',
    );
  });

  it('is removed from the tab order when not active (roving tabindex)', () => {
    render(
      <SignalTile
        tile={makeTile()}
        repo={makeRepo()}
        data={{}}
        onActivate={vi.fn()}
        active={false}
      />,
    );
    expect(screen.getByRole('button', { name: /view ci details for octo\/a/i })).toHaveAttribute(
      'tabindex',
      '-1',
    );
  });

  it('removes the tile and its Move/Resize controls from the tab order when editing but not active', () => {
    render(
      <SignalTile
        tile={makeTile()}
        repo={makeRepo()}
        data={{}}
        onActivate={vi.fn()}
        onMove={vi.fn()}
        onResize={vi.fn()}
        editing
        active={false}
      />,
    );
    // The roving-tabindex invariant: only the grid's active tile is tabbable, so
    // an inactive editing tile must have its activation overlay AND every
    // Move/Resize control out of the tab order.
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

  it('reports focus via onTileFocus so the grid can track the active tile', async () => {
    const onTileFocus = vi.fn();
    const user = userEvent.setup();
    render(
      <SignalTile
        tile={makeTile()}
        repo={makeRepo()}
        data={{}}
        onActivate={vi.fn()}
        onTileFocus={onTileFocus}
      />,
    );
    await user.tab();
    expect(onTileFocus).toHaveBeenCalledWith('octo/a:ci');
  });
});

describe('SignalTile — keyboard reorder & resize controls', () => {
  it('does not render reorder/resize controls outside edit mode', () => {
    render(<SignalTile tile={makeTile()} repo={makeRepo()} data={{}} onActivate={vi.fn()} />);
    expect(screen.queryByRole('group', { name: /reorder/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /move .* left/i })).toBeNull();
  });

  it('renders move and resize controls in edit mode', () => {
    render(
      <SignalTile tile={makeTile()} repo={makeRepo()} data={{}} onActivate={vi.fn()} editing />,
    );
    const group = screen.getByRole('group', { name: /reorder and resize ci · octo\/a/i });
    expect(
      within(group).getByRole('button', { name: /move ci · octo\/a left/i }),
    ).toBeInTheDocument();
    expect(
      within(group).getByRole('button', { name: /move ci · octo\/a right/i }),
    ).toBeInTheDocument();
    expect(
      within(group).getByRole('button', { name: /move ci · octo\/a up/i }),
    ).toBeInTheDocument();
    expect(
      within(group).getByRole('button', { name: /move ci · octo\/a down/i }),
    ).toBeInTheDocument();
    expect(
      within(group).getByRole('button', { name: /grow ci · octo\/a width/i }),
    ).toBeInTheDocument();
    expect(
      within(group).getByRole('button', { name: /shrink ci · octo\/a width/i }),
    ).toBeInTheDocument();
    expect(
      within(group).getByRole('button', { name: /grow ci · octo\/a height/i }),
    ).toBeInTheDocument();
    expect(
      within(group).getByRole('button', { name: /shrink ci · octo\/a height/i }),
    ).toBeInTheDocument();
  });

  it('invokes onMove with the tile id and direction', async () => {
    const onMove = vi.fn();
    const user = userEvent.setup();
    render(
      <SignalTile
        tile={makeTile()}
        repo={makeRepo()}
        data={{}}
        onActivate={vi.fn()}
        onMove={onMove}
        editing
      />,
    );
    await user.click(screen.getByRole('button', { name: /move ci · octo\/a right/i }));
    expect(onMove).toHaveBeenCalledWith('octo/a:ci', 'right');
  });

  it('invokes onResize with the tile id, dimension and delta', async () => {
    const onResize = vi.fn();
    const user = userEvent.setup();
    render(
      <SignalTile
        tile={makeTile()}
        repo={makeRepo()}
        data={{}}
        onActivate={vi.fn()}
        onResize={onResize}
        editing
      />,
    );
    await user.click(screen.getByRole('button', { name: /grow ci · octo\/a width/i }));
    expect(onResize).toHaveBeenCalledWith('octo/a:ci', 'width', 1);
    await user.click(screen.getByRole('button', { name: /shrink ci · octo\/a height/i }));
    expect(onResize).toHaveBeenCalledWith('octo/a:ci', 'height', -1);
  });

  it('keeps the reorder/resize controls out of pointer-drag (draggableCancel hook)', () => {
    render(
      <SignalTile tile={makeTile()} repo={makeRepo()} data={{}} onActivate={vi.fn()} editing />,
    );
    const moveLeft = screen.getByRole('button', { name: /move ci · octo\/a left/i });
    expect(moveLeft).toHaveClass('dashboard-tile-control');
  });

  it('still activates the drill-down from the overlay button while editing', async () => {
    const onActivate = vi.fn();
    const repo = makeRepo();
    const user = userEvent.setup();
    render(<SignalTile tile={makeTile()} repo={repo} data={{}} onActivate={onActivate} editing />);
    await user.click(screen.getByRole('button', { name: /view ci details for octo\/a/i }));
    expect(onActivate).toHaveBeenCalledWith(repo);
  });
});
