import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { DashboardTile, TileSignalType } from '../types/dashboard';
import type { Repo } from '../types/fleet';
import { SignalTile } from './SignalTile';

// The Activity body self-fetches via `useCommitActivity` (which reads the auth
// context); stub it so the tile mounts without an AuthProvider or network.
vi.mock('../hooks/useCommitActivity', () => ({
  useCommitActivity: vi.fn(() => ({ state: 'empty' })),
}));

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
    await user.click(screen.getByRole('button', { name: /ci: .*octo\/a/i }));
    expect(onActivate).toHaveBeenCalledWith(repo);
  });

  it('is keyboard-activatable (Enter) via button semantics', async () => {
    const onActivate = vi.fn();
    const user = userEvent.setup();
    render(
      <SignalTile tile={makeTile('issues')} repo={makeRepo()} data={{}} onActivate={onActivate} />,
    );
    await user.tab();
    expect(screen.getByRole('button', { name: /issues: .*octo\/a/i })).toHaveFocus();
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
    expect(screen.getByRole('button', { name: new RegExp(`octo/a`, 'i') })).toBeInTheDocument();
    // The bespoke per-signal body (DESIGN-TILES §6) renders its own redundant
    // sr-text — proof the tile now dispatches to the bodies, not the `*Cell`
    // atoms (which the table view keeps).
    expect(screen.getAllByText(bodyMarker).length).toBeGreaterThan(0);
  });

  it('renders the ActivityTileBody for the activity signal (label, a11y, identity tone)', () => {
    const { container } = render(
      <SignalTile tile={makeTile('activity')} repo={makeRepo()} data={{}} onActivate={vi.fn()} />,
    );
    // The signal label resolves to "Activity" and the activate affordance names it.
    expect(screen.getByText('Activity')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /activity: .*octo\/a/i })).toBeInTheDocument();
    // Activity has no lifecycle slice in RepoSignalData — the frame shows a stable
    // calm identity: a 'ready'-equivalent status and the purple identity accent
    // on the header dot (spec §5 "purple icon"; redesign R2 — the old success
    // ACTIVITY_TONE is removed).
    expect(container.querySelector('[data-status="ready"]')).not.toBeNull();
    expect(container.querySelector('[data-salience="calm"]')).not.toBeNull();
    const header = container.querySelector('header');
    expect(header?.querySelector('[data-tone="purple"]')).not.toBeNull();
    expect(container.querySelector('[data-tone="success"]')).toBeNull();
    // Proof the bespoke ActivityTileBody rendered (its empty-state copy), not the
    // exhaustive-switch fallback.
    expect(screen.getAllByText(/no recent commit activity/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/unknown signal/i)).toBeNull();
  });

  it('escalates a failing-CI tile to the PROBLEM salience tier', () => {
    const { container } = render(
      <SignalTile
        tile={makeTile('ci')}
        repo={makeRepo()}
        data={{ ci: { status: 'ready', conclusion: 'failure', failingCount: 2 } }}
        onActivate={vi.fn()}
      />,
    );
    expect(container.querySelector('[data-salience="problem"]')).not.toBeNull();
    // The activate label carries the scope + metric + tier + repo (a11y summary).
    expect(
      screen.getByRole('button', { name: 'CI: 2 failing, problem — octo/a' }),
    ).toBeInTheDocument();
  });

  it('escalates a pending-review tile to the ACTIONABLE salience tier', () => {
    const { container } = render(
      <SignalTile
        tile={makeTile('reviews')}
        repo={makeRepo()}
        data={{ reviews: { status: 'ready', requestedCount: 2 } }}
        onActivate={vi.fn()}
      />,
    );
    expect(container.querySelector('[data-salience="actionable"]')).not.toBeNull();
    expect(
      screen.getByRole('button', { name: 'Reviews: 2 awaiting review, actionable — octo/a' }),
    ).toBeInTheDocument();
  });

  it('keeps a calm, informational tile at the CALM salience tier', () => {
    const { container } = render(
      <SignalTile
        tile={makeTile('issues')}
        repo={makeRepo()}
        data={{ issues: { status: 'ready', openCount: 7 } }}
        onActivate={vi.fn()}
      />,
    );
    expect(container.querySelector('[data-salience="calm"]')).not.toBeNull();
    expect(
      screen.getByRole('button', { name: 'Issues: 7 open, calm — octo/a' }),
    ).toBeInTheDocument();
  });

  it('threads a display alias to the frame while still announcing the real repo (a11y)', () => {
    render(
      <SignalTile
        tile={makeTile('issues')}
        repo={makeRepo()}
        data={{ issues: { status: 'ready', openCount: 7 } }}
        onActivate={vi.fn()}
        alias="api"
      />,
    );
    // The alias shows as the visible heading text…
    const heading = screen.getByRole('heading', { level: 3 });
    expect(heading).toHaveTextContent('api');
    expect(heading).toHaveAttribute('title', 'octo/a');
    // …plus a visually-hidden "(alias for octo/a)" so the real repo is reachable.
    expect(within(heading).getByText('(alias for octo/a)')).toHaveClass('sr-only');
    // The activate label still announces the real owner/repo via accessibleSummary.
    expect(
      screen.getByRole('button', { name: 'Issues: 7 open, calm — octo/a' }),
    ).toBeInTheDocument();
  });
});

describe('SignalTile — density threading (T15)', () => {
  const failingCi = { ci: { status: 'ready', conclusion: 'failure' } } as const;

  it('threads glanceable density to the body, dropping the standard-tier micro-viz', () => {
    const { container } = render(
      <SignalTile
        tile={makeTile('ci')}
        repo={makeRepo()}
        data={failingCi}
        onActivate={vi.fn()}
        density="glanceable"
      />,
    );
    expect(container.querySelector('[data-shape]')).toBeNull();
  });

  it('threads balanced density to the body, keeping the standard-tier micro-viz', () => {
    const { container } = render(
      <SignalTile
        tile={makeTile('ci')}
        repo={makeRepo()}
        data={failingCi}
        onActivate={vi.fn()}
        density="balanced"
      />,
    );
    expect(container.querySelector('[data-shape]')).not.toBeNull();
  });

  it('defaults to balanced when density is omitted', () => {
    const { container } = render(
      <SignalTile tile={makeTile('ci')} repo={makeRepo()} data={failingCi} onActivate={vi.fn()} />,
    );
    expect(container.querySelector('[data-shape]')).not.toBeNull();
  });
});
