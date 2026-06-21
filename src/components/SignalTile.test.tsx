import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { DashboardTile, TileSignalType } from '../types/dashboard';
import type { Repo } from '../types/fleet';
import { SignalTile } from './SignalTile';

function makeRepo(nameWithOwner = 'octo/a'): Repo {
  const [owner, name] = nameWithOwner.split('/');
  return { nameWithOwner, owner, name, isPrivate: false };
}

function makeTile(signal: TileSignalType, repo = 'octo/a'): DashboardTile {
  return { i: `${repo}:${signal}`, signal, repo, x: 0, y: 0, w: 3, h: 2, visible: true };
}

describe('SignalTile', () => {
  it('renders the repo name and the signal label', () => {
    render(<SignalTile tile={makeTile('ci')} repo={makeRepo()} data={{}} onActivate={vi.fn()} />);
    expect(screen.getByText('octo/a')).toBeInTheDocument();
    expect(screen.getByText('CI')).toBeInTheDocument();
  });

  it('is an activatable button that calls onActivate with the repo on click', async () => {
    const onActivate = vi.fn();
    const repo = makeRepo();
    const user = userEvent.setup();
    render(
      <SignalTile
        tile={makeTile('ci')}
        repo={repo}
        data={{ ci: { status: 'ready', conclusion: 'failure' } }}
        onActivate={onActivate}
      />,
    );
    await user.click(screen.getByRole('button', { name: /view ci details for octo\/a/i }));
    expect(onActivate).toHaveBeenCalledWith(repo);
  });

  it('is keyboard-activatable (Enter) via button semantics', async () => {
    const onActivate = vi.fn();
    const user = userEvent.setup();
    render(
      <SignalTile tile={makeTile('issues')} repo={makeRepo()} data={{}} onActivate={onActivate} />,
    );
    await user.tab();
    expect(screen.getByRole('button', { name: /view issues details for octo\/a/i })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it('exposes the slice status for redundant (non-colour) state encoding', () => {
    const { container, rerender } = render(
      <SignalTile
        tile={makeTile('ci')}
        repo={makeRepo()}
        data={{ ci: { status: 'loading' } }}
        onActivate={vi.fn()}
      />,
    );
    expect(container.querySelector('[data-status="loading"]')).not.toBeNull();

    rerender(
      <SignalTile
        tile={makeTile('ci')}
        repo={makeRepo()}
        data={{ ci: { status: 'error' } }}
        onActivate={vi.fn()}
      />,
    );
    expect(container.querySelector('[data-status="error"]')).not.toBeNull();

    rerender(<SignalTile tile={makeTile('ci')} repo={makeRepo()} data={{}} onActivate={vi.fn()} />);
    expect(container.querySelector('[data-status="unknown"]')).not.toBeNull();

    rerender(
      <SignalTile
        tile={makeTile('ci')}
        repo={makeRepo()}
        data={{ ci: { status: 'ready', conclusion: 'success' } }}
        onActivate={vi.fn()}
      />,
    );
    expect(container.querySelector('[data-status="ready"]')).not.toBeNull();
  });

  it('renders a loading skeleton (no value) for a loading slice', () => {
    render(
      <SignalTile
        tile={makeTile('ci')}
        repo={makeRepo()}
        data={{ ci: { status: 'loading' } }}
        onActivate={vi.fn()}
      />,
    );
    expect(screen.getByText(/loading ci/i)).toBeInTheDocument();
    expect(screen.queryByText(/passing|failing/i)).toBeNull();
  });

  it('renders an error affordance for an error slice', () => {
    render(
      <SignalTile
        tile={makeTile('ci')}
        repo={makeRepo()}
        data={{ ci: { status: 'error' } }}
        onActivate={vi.fn()}
      />,
    );
    expect(screen.getAllByText(/couldn.t load ci/i).length).toBeGreaterThan(0);
  });

  it('renders a neutral empty state for a missing slice', () => {
    render(<SignalTile tile={makeTile('ci')} repo={makeRepo()} data={{}} onActivate={vi.fn()} />);
    expect(screen.getByText(/ci status unavailable for octo\/a/i)).toBeInTheDocument();
  });

  it('renders the glanceable value for a ready slice via the bespoke body', () => {
    render(
      <SignalTile
        tile={makeTile('ci')}
        repo={makeRepo()}
        data={{ ci: { status: 'ready', conclusion: 'failure' } }}
        onActivate={vi.fn()}
      />,
    );
    expect(screen.getAllByText('Failing').length).toBeGreaterThan(0);
  });

  it.each<[TileSignalType, string, RegExp]>([
    ['ci', 'CI', /ci status unavailable for octo\/a/i],
    ['security', 'Security', /security status unavailable/i],
    ['reviews', 'Reviews', /review queue not loaded/i],
    ['pullRequests', 'Pull requests', /no pull request data for octo\/a/i],
    ['issues', 'Issues', /issue count not available/i],
    ['stale', 'Stale', /stale activity not loaded/i],
  ])('renders the %s signal with its label and bespoke body', (signal, label, bodyMarker) => {
    render(<SignalTile tile={makeTile(signal)} repo={makeRepo()} data={{}} onActivate={vi.fn()} />);
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: new RegExp(`details for octo/a`, 'i') }),
    ).toBeInTheDocument();
    // The bespoke per-signal body (DESIGN-TILES §6) renders its own redundant
    // sr-text — proof the tile now dispatches to the bodies, not the `*Cell`
    // atoms (which the table view keeps).
    expect(screen.getAllByText(bodyMarker).length).toBeGreaterThan(0);
  });
});
