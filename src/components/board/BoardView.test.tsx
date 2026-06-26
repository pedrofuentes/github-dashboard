import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { __resetRepoOwnerStoreForTests } from '../../hooks/useRepoOwner';
import { deckKeyId } from '../../lib/deck-visibility';
import type { TileSignalType } from '../../types/dashboard';
import type { GetRowData, Repo, RepoSignalData } from '../../types/fleet';
import { BoardView } from './BoardView';

/** The six signals BoardView renders, in their fixed left-to-right order. */
const SIGNAL_ORDER: TileSignalType[] = [
  'ci',
  'security',
  'reviews',
  'pullRequests',
  'issues',
  'stale',
];

/** Builds the hidden-set ids for the given signals of `repo` (deck-visibility lib). */
function hidden(repo: Repo, signals: TileSignalType[]): Set<string> {
  return new Set(signals.map((signal) => deckKeyId(repo.nameWithOwner, signal)));
}

function makeRepo(nameWithOwner: string): Repo {
  const [owner, name] = nameWithOwner.split('/');
  return { nameWithOwner, owner, name, isPrivate: false };
}

const repoA = makeRepo('octo/repo-a');
const repoB = makeRepo('octo/repo-b');

/** Ready data for every signal so each key resolves to a deterministic value. */
const READY_DATA: RepoSignalData = {
  ci: { status: 'ready', conclusion: 'success' },
  security: { status: 'ready', grade: 'A' },
  reviews: { status: 'ready', requestedCount: 2 },
  pullRequests: { status: 'ready', openCount: 4 },
  issues: { status: 'ready', openCount: 7 },
  stale: { status: 'ready', staleCount: 1 },
};

const getRowData: GetRowData = () => READY_DATA;

/** Every rendered board key exposes the `data-signal` seam (from BoardKey). */
function keys(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-signal]'));
}

beforeEach(() => {
  localStorage.clear();
  __resetRepoOwnerStoreForTests();
});

afterEach(() => {
  localStorage.clear();
});

describe('BoardView — grid composition', () => {
  it('renders one key per (repo × signal) — six keys per repo', () => {
    const { container } = render(<BoardView repos={[repoA, repoB]} getRowData={getRowData} />);

    expect(keys(container)).toHaveLength(2 * 6);
  });

  it('renders the six signal keys in the fixed order and omits activity', () => {
    const { container } = render(<BoardView repos={[repoA]} getRowData={getRowData} />);

    const signals = keys(container).map((key) => key.getAttribute('data-signal'));
    expect(signals).toEqual(SIGNAL_ORDER);
    expect(signals).not.toContain('activity');
  });

  it('exposes an accessible, labelled board region', () => {
    render(<BoardView repos={[repoA]} getRowData={getRowData} />);

    expect(screen.getByRole('region', { name: /board/i })).toBeInTheDocument();
  });

  it('announces the visible repository count (plural)', () => {
    render(<BoardView repos={[repoA, repoB]} getRowData={getRowData} />);

    expect(screen.getByRole('status')).toHaveTextContent('2 repositories');
  });

  it('announces the visible repository count (singular)', () => {
    render(<BoardView repos={[repoA]} getRowData={getRowData} />);

    expect(screen.getByRole('status')).toHaveTextContent('1 repository');
  });
});

describe('BoardView — repo filter', () => {
  it('shows all repos when no filter is provided', () => {
    const { container } = render(<BoardView repos={[repoA, repoB]} getRowData={getRowData} />);

    expect(keys(container)).toHaveLength(2 * 6);
  });

  it('narrows to the repos in a non-empty filter set', () => {
    const { container } = render(
      <BoardView
        repos={[repoA, repoB]}
        getRowData={getRowData}
        repoFilter={new Set([repoA.nameWithOwner])}
      />,
    );

    expect(keys(container)).toHaveLength(6);
    expect(screen.queryByText('octo/repo-b')).toBeNull();
    expect(screen.getAllByText('octo/repo-a')).toHaveLength(6);
  });
});

describe('BoardView — loading / error / empty states', () => {
  it('shows skeleton placeholders on first load and no real keys', () => {
    const { container } = render(<BoardView repos={[]} getRowData={getRowData} loading />);

    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-part="skeleton"]').length).toBeGreaterThan(0);
    expect(keys(container)).toHaveLength(0);
    expect(screen.getByRole('status')).toHaveTextContent(/loading/i);
  });

  it('renders an error alert with a Retry that calls onRetry', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(<BoardView repos={[repoA]} getRowData={getRowData} error="Boom" onRetry={onRetry} />);

    expect(screen.getByRole('alert')).toHaveTextContent('Boom');

    await user.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('renders the error alert without a Retry button when no onRetry is given', () => {
    render(<BoardView repos={[repoA]} getRowData={getRowData} error="Boom" />);

    expect(screen.getByRole('alert')).toHaveTextContent('Boom');
    expect(screen.queryByRole('button', { name: /retry/i })).toBeNull();
  });

  it('shows the no-repos empty state when there are no repositories', () => {
    render(<BoardView repos={[]} getRowData={getRowData} />);

    expect(screen.getByText(/No repositories found for this token\./i)).toBeInTheDocument();
  });

  it('shows the filtered empty state when the filter excludes every repo', () => {
    render(
      <BoardView
        repos={[repoA]}
        getRowData={getRowData}
        repoFilter={new Set(['octo/does-not-exist'])}
      />,
    );

    expect(screen.getByText(/No repositories match your filter\./i)).toBeInTheDocument();
  });
});

describe('BoardView — drill-down', () => {
  it('links a ready key to its signal’s GitHub page instead of drilling down', async () => {
    const user = userEvent.setup();
    const onRepoActivate = vi.fn();
    render(<BoardView repos={[repoA]} getRowData={getRowData} onRepoActivate={onRepoActivate} />);

    const ci = screen.getByRole('link', { name: /CI:.*octo\/repo-a/ });
    expect(ci.getAttribute('href')).toMatch(/^https:\/\/github\.com\/octo\/repo-a\//);
    expect(ci).toHaveAttribute('target', '_blank');
    await user.click(ci);
    // The key navigates to GitHub, so the in-app drill-down is never invoked.
    expect(onRepoActivate).not.toHaveBeenCalled();
  });

  it('renders interactive deep-link keys even when onRepoActivate is omitted', () => {
    render(<BoardView repos={[repoA]} getRowData={getRowData} />);

    // Each key is a GitHub link (its href is intrinsic to the repo + signal), so
    // the deck is interactive even without a drill-down handler.
    const links = screen.getAllByRole('link', { name: /octo\/repo-a/ });
    expect(links).toHaveLength(6);
    links.forEach((link) =>
      expect(link.getAttribute('href')).toMatch(/^https:\/\/github\.com\/octo\/repo-a\//),
    );
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('BoardView — per-key retry threading', () => {
  /** Every signal slice errored, so each key resolves to an error (retry) state. */
  const ERRORED_DATA: RepoSignalData = {
    ci: { status: 'error' },
    security: { status: 'error' },
    reviews: { status: 'error' },
    pullRequests: { status: 'error' },
    issues: { status: 'error' },
    stale: { status: 'error' },
  };

  it('threads onRetry down so an errored key re-fetches (not drills down) on press', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    const onRepoActivate = vi.fn();
    render(
      <BoardView
        repos={[repoA]}
        getRowData={() => ERRORED_DATA}
        onRepoActivate={onRepoActivate}
        onRetry={onRetry}
      />,
    );

    const retryButtons = screen.getAllByRole('button', { name: /retry/i });
    expect(retryButtons).toHaveLength(SIGNAL_ORDER.length);

    await user.click(retryButtons[0]);

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRepoActivate).not.toHaveBeenCalled();
  });

  it('uses the scoped retry seam for the failed repo and signal instead of board reload', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    const onRetrySignal = vi.fn();
    render(
      <BoardView
        repos={[repoA]}
        getRowData={() => ERRORED_DATA}
        onRetry={onRetry}
        onRetrySignal={onRetrySignal}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Retry CI for octo/repo-a' }));

    expect(onRetrySignal).toHaveBeenCalledTimes(1);
    expect(onRetrySignal).toHaveBeenCalledWith(repoA, 'ci');
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('links a ready key to GitHub even when onRetry is also provided', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    const onRepoActivate = vi.fn();
    render(
      <BoardView
        repos={[repoA]}
        getRowData={getRowData}
        onRepoActivate={onRepoActivate}
        onRetry={onRetry}
      />,
    );

    const ci = screen.getByRole('link', { name: /CI:.*octo\/repo-a/ });
    expect(ci.getAttribute('href')).toMatch(/^https:\/\/github\.com\/octo\/repo-a\//);
    await user.click(ci);
    // Retry only applies to errored keys; a ready key navigates to GitHub.
    expect(onRepoActivate).not.toHaveBeenCalled();
    expect(onRetry).not.toHaveBeenCalled();
  });
});

describe('BoardView — per-tile hide (hiddenKeys)', () => {
  it('treats an absent hiddenKeys set as "all visible"', () => {
    const { container } = render(<BoardView repos={[repoA, repoB]} getRowData={getRowData} />);

    expect(keys(container)).toHaveLength(2 * 6);
  });

  it('omits only the hidden signals for a repo, keeping the rest in fixed order', () => {
    const { container } = render(
      <BoardView
        repos={[repoA]}
        getRowData={getRowData}
        hiddenKeys={hidden(repoA, ['ci', 'issues'])}
      />,
    );

    const signals = keys(container).map((key) => key.getAttribute('data-signal'));
    expect(signals).toEqual(['security', 'reviews', 'pullRequests', 'stale']);
  });

  it('renders repos×6 minus the hidden keys across multiple repos', () => {
    const hiddenKeys = new Set([...hidden(repoA, ['ci']), ...hidden(repoB, ['stale', 'issues'])]);
    const { container } = render(
      <BoardView repos={[repoA, repoB]} getRowData={getRowData} hiddenKeys={hiddenKeys} />,
    );

    expect(keys(container)).toHaveLength(2 * 6 - 3);
  });

  it('applies repoFilter and hiddenKeys together', () => {
    const { container } = render(
      <BoardView
        repos={[repoA, repoB]}
        getRowData={getRowData}
        repoFilter={new Set([repoA.nameWithOwner])}
        hiddenKeys={hidden(repoA, ['ci'])}
      />,
    );

    expect(keys(container)).toHaveLength(5);
    expect(screen.queryByText('octo/repo-b')).toBeNull();
  });

  it('announces the visible tile count when some tiles are hidden (plural)', () => {
    render(
      <BoardView repos={[repoA]} getRowData={getRowData} hiddenKeys={hidden(repoA, ['ci'])} />,
    );

    expect(screen.getByRole('status')).toHaveTextContent('5 tiles');
  });

  it('uses the singular noun when exactly one tile is visible', () => {
    render(
      <BoardView
        repos={[repoA]}
        getRowData={getRowData}
        hiddenKeys={hidden(repoA, ['ci', 'security', 'reviews', 'pullRequests', 'issues'])}
      />,
    );

    expect(screen.getByRole('status')).toHaveTextContent(/\b1 tile\b/);
  });

  it('does not annotate the tile count when no tiles are hidden', () => {
    render(<BoardView repos={[repoA, repoB]} getRowData={getRowData} />);

    expect(screen.getByRole('status')).toHaveTextContent('2 repositories');
    expect(screen.getByRole('status').textContent).not.toMatch(/tile/i);
  });

  it('shows the all-tiles-hidden empty state, distinct from no-repos/filtered', () => {
    const { container } = render(
      <BoardView
        repos={[repoA]}
        getRowData={getRowData}
        hiddenKeys={hidden(repoA, SIGNAL_ORDER)}
      />,
    );

    expect(keys(container)).toHaveLength(0);
    expect(screen.getByText(/all tiles hidden/i)).toBeInTheDocument();
    expect(screen.getByText(/customize/i)).toBeInTheDocument();
    expect(screen.queryByText(/No repositories/i)).toBeNull();
  });
});

describe('BoardView — edit mode (× remove overlay)', () => {
  it('renders no remove overlay when not editing', () => {
    render(<BoardView repos={[repoA]} getRowData={getRowData} onToggleKey={vi.fn()} />);

    expect(screen.queryByRole('button', { name: /remove .* tile for/i })).toBeNull();
  });

  it('overlays a remove button on every visible key when editing', () => {
    render(<BoardView repos={[repoA]} getRowData={getRowData} editing onToggleKey={vi.fn()} />);

    expect(
      screen.getAllByRole('button', { name: /remove .* tile for octo\/repo-a/i }),
    ).toHaveLength(6);
  });

  it('renders no remove overlay when editing without a toggle handler', () => {
    render(<BoardView repos={[repoA]} getRowData={getRowData} editing />);

    expect(screen.queryByRole('button', { name: /remove .* tile for/i })).toBeNull();
  });

  it('labels each remove button and toggles that (repo, signal) on click', async () => {
    const user = userEvent.setup();
    const onToggleKey = vi.fn();
    render(<BoardView repos={[repoA]} getRowData={getRowData} editing onToggleKey={onToggleKey} />);

    await user.click(screen.getByRole('button', { name: 'Remove CI tile for octo/repo-a' }));

    expect(onToggleKey).toHaveBeenCalledTimes(1);
    expect(onToggleKey).toHaveBeenCalledWith(repoA, 'ci');
  });

  it('uses the multi-word signal label in the remove aria-label', () => {
    render(<BoardView repos={[repoA]} getRowData={getRowData} editing onToggleKey={vi.fn()} />);

    expect(
      screen.getByRole('button', { name: 'Remove Pull requests tile for octo/repo-a' }),
    ).toBeInTheDocument();
  });

  it('renders the remove button as a sibling overlay, not nested in the key button', () => {
    render(
      <BoardView
        repos={[repoA]}
        getRowData={getRowData}
        editing
        onRepoActivate={vi.fn()}
        onToggleKey={vi.fn()}
      />,
    );

    const removeCi = screen.getByRole('button', { name: 'Remove CI tile for octo/repo-a' });
    expect(removeCi.closest('[data-signal]')).toBeNull();
  });

  it('overlays a remove button only on the visible keys', () => {
    render(
      <BoardView
        repos={[repoA]}
        getRowData={getRowData}
        editing
        hiddenKeys={hidden(repoA, ['ci', 'security'])}
        onToggleKey={vi.fn()}
      />,
    );

    expect(screen.getAllByRole('button', { name: /remove .* tile for/i })).toHaveLength(4);
    expect(screen.queryByRole('button', { name: 'Remove CI tile for octo/repo-a' })).toBeNull();
  });
});
