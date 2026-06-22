import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { TileSalience } from '../../lib/tile-salience';
import type { Repo } from '../../types/fleet';
import { TileFrame } from './TileFrame';

function makeRepo(nameWithOwner = 'octo/a'): Repo {
  const [owner, name] = nameWithOwner.split('/');
  return { nameWithOwner, owner, name, isPrivate: false };
}

function salience(overrides: Partial<TileSalience> = {}): TileSalience {
  return {
    tier: 'calm',
    edgeTone: 'neutral',
    tint: false,
    glow: false,
    actionableTab: false,
    ...overrides,
  };
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

  it('paints the accent bar from the salience edge tone, not the lifecycle tone', () => {
    // The bar is salience-driven now (redesign §3): a calm default leaves it
    // neutral even when the lifecycle tone is `failure`; only an escalated
    // salience colours + thickens it. This keeps the bar a redundant salience
    // channel (colour + 5px/6px thickness) paired with `data-salience`.
    const { container } = renderFrame({ tone: 'failure' });
    const calmBar = container.querySelector('[data-tone="neutral"]');
    expect(calmBar).not.toBeNull();
    expect(calmBar?.className).toContain('bg-accent-neutral');
    expect(calmBar?.className).toContain('h-[5px]');
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

describe('TileFrame — salience treatment', () => {
  it('renders the PROBLEM tier with a 6px edge-toned bar, tint surface and glow', () => {
    const { container } = renderFrame({
      salience: salience({ tier: 'problem', edgeTone: 'failure', tint: true, glow: true }),
    });
    const cell = screen.getByRole('gridcell');
    expect(cell).toHaveAttribute('data-salience', 'problem');
    const bar = container.querySelector('[data-tone="failure"]');
    expect(bar).not.toBeNull();
    expect(bar?.className).toContain('h-[6px]');
    expect(bar?.className).toContain('bg-accent-failure');
    const glow = container.querySelector('[data-part="problem-glow"]');
    expect(glow).not.toBeNull();
    expect(glow).toHaveAttribute('aria-hidden', 'true');
  });

  it('renders the ACTIONABLE tier with a persistent info tab and a calm neutral bar', () => {
    const { container } = renderFrame({
      salience: salience({ tier: 'actionable', edgeTone: 'info', actionableTab: true }),
    });
    const cell = screen.getByRole('gridcell');
    expect(cell).toHaveAttribute('data-salience', 'actionable');
    const tab = container.querySelector('[data-part="actionable-tab"]');
    expect(tab).not.toBeNull();
    expect(tab).toHaveAttribute('aria-hidden', 'true');
    expect(tab?.className).toContain('bg-accent-info');
    const bar = container.querySelector('[data-tone="neutral"]');
    expect(bar?.className).toContain('h-[5px]');
    expect(container.querySelector('[data-part="problem-glow"]')).toBeNull();
  });

  it('renders the CALM tier with a 5px neutral bar and an identity-toned header dot', () => {
    const { container } = renderFrame({
      salience: salience({ tier: 'calm' }),
      identityTone: 'purple',
    });
    const cell = screen.getByRole('gridcell');
    expect(cell).toHaveAttribute('data-salience', 'calm');
    const bar = container.querySelector('[data-tone="neutral"]');
    expect(bar?.className).toContain('h-[5px]');
    expect(bar?.className).toContain('bg-accent-neutral');
    // Identity colour moves to the header dot on calm tiles (redundant with the
    // adjacent signal label + icon shape).
    const header = container.querySelector('header');
    expect(header?.querySelector('[data-tone="purple"]')).not.toBeNull();
    expect(container.querySelector('[data-part="problem-glow"]')).toBeNull();
    expect(container.querySelector('[data-part="actionable-tab"]')).toBeNull();
  });

  it('defaults to the calm tier when no salience is supplied (current callers)', () => {
    renderFrame();
    expect(screen.getByRole('gridcell')).toHaveAttribute('data-salience', 'calm');
  });
});

describe('TileFrame — alias and accessible summary', () => {
  it('shows the alias as visible text with a visually-hidden real repo and a real title', () => {
    renderFrame({ alias: 'api' });
    const heading = screen.getByRole('heading', { level: 3 });
    expect(heading).toHaveTextContent('api');
    expect(heading).toHaveAttribute('title', 'octo/a');
    const aliasNote = within(heading).getByText('(alias for octo/a)');
    expect(aliasNote).toHaveClass('sr-only');
  });

  it('falls back to the real repo name when no alias is set', () => {
    renderFrame();
    const heading = screen.getByRole('heading', { level: 3 });
    expect(heading).toHaveTextContent('octo/a');
    expect(within(heading).queryByText(/alias for/i)).toBeNull();
  });

  it('uses accessibleSummary as the activate-button label when provided', () => {
    renderFrame({ accessibleSummary: 'CI: 2 failing, problem — octo/a' });
    expect(screen.getByRole('button', { name: 'CI: 2 failing, problem — octo/a' })).toHaveAttribute(
      'data-tile-activate',
      'octo/a:ci',
    );
    expect(screen.queryByRole('button', { name: /view ci details for octo\/a/i })).toBeNull();
  });

  it('keeps the legacy activate label when no accessibleSummary is provided', () => {
    renderFrame();
    expect(
      screen.getByRole('button', { name: /view ci details for octo\/a/i }),
    ).toBeInTheDocument();
  });
});

describe('TileFrame — hideRepoHeader (filtered-to-one header drop, AC-10)', () => {
  it('drops the visible repo header line but keeps the real repo in the title and activate label', () => {
    // When the dashboard is filtered to a single repo every tile belongs to that
    // repo, so the per-tile repo header line is redundant and visually dropped.
    // The repo identity must NEVER leave the a11y tree (AC-10): the heading is
    // only visually hidden (sr-only) while its title + the activate control's
    // accessible name still announce the real `nameWithOwner`.
    renderFrame({ hideRepoHeader: true, accessibleSummary: 'CI: 2 failing, problem — octo/a' });
    const heading = screen.getByRole('heading', { level: 3 });
    expect(heading).toHaveClass('sr-only');
    expect(heading).toHaveAttribute('title', 'octo/a');
    expect(
      screen.getByRole('button', { name: 'CI: 2 failing, problem — octo/a' }),
    ).toBeInTheDocument();
  });

  it('keeps the visually-hidden alias note announcing the real repo when header-dropped', () => {
    renderFrame({ hideRepoHeader: true, alias: 'api' });
    const heading = screen.getByRole('heading', { level: 3 });
    expect(heading).toHaveClass('sr-only');
    expect(heading).toHaveAttribute('title', 'octo/a');
    const aliasNote = within(heading).getByText('(alias for octo/a)');
    expect(aliasNote).toHaveClass('sr-only');
  });

  it('renders the visible repo header normally when hideRepoHeader is absent', () => {
    renderFrame();
    const heading = screen.getByRole('heading', { level: 3 });
    expect(heading).not.toHaveClass('sr-only');
    expect(heading).toHaveTextContent('octo/a');
  });
});
