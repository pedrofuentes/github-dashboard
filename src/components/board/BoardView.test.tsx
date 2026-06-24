import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { __resetRepoOwnerStoreForTests } from '../../hooks/useRepoOwner';
import type { GetRowData, Repo, RepoSignalData } from '../../types/fleet';
import { BoardView } from './BoardView';

/** The six signals BoardView renders, in their fixed left-to-right order. */
const SIGNAL_ORDER = ['ci', 'security', 'reviews', 'pullRequests', 'issues', 'stale'];

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
  it('fires onRepoActivate with the repo when a key is activated', async () => {
    const user = userEvent.setup();
    const onRepoActivate = vi.fn();
    render(<BoardView repos={[repoA]} getRowData={getRowData} onRepoActivate={onRepoActivate} />);

    await user.click(screen.getByRole('button', { name: /CI:.*octo\/repo-a/ }));

    expect(onRepoActivate).toHaveBeenCalledTimes(1);
    expect(onRepoActivate).toHaveBeenCalledWith(repoA);
  });

  it('renders non-interactive keys when onRepoActivate is omitted', () => {
    render(<BoardView repos={[repoA]} getRowData={getRowData} />);

    expect(screen.queryByRole('button')).toBeNull();
  });
});
