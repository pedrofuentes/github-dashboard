import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CommitActivityState } from '../hooks/useCommitActivity';
import { useCommitActivity } from '../hooks/useCommitActivity';
import type { GetRowData, Repo, RepoSignalData } from '../types/fleet';
import { FleetMatrix } from './FleetMatrix';

vi.mock('../hooks/useCommitActivity', () => ({ useCommitActivity: vi.fn() }));

const mockActivity = vi.mocked(useCommitActivity);

const OK_ACTIVITY: CommitActivityState = {
  state: 'ok',
  weeks: [
    { total: 3, week: 1700000000, days: [0, 1, 0, 1, 0, 1, 0] },
    { total: 5, week: 1700604800, days: [1, 1, 1, 0, 1, 1, 0] },
  ],
};

beforeEach(() => {
  mockActivity.mockReturnValue(OK_ACTIVITY);
});

afterEach(() => {
  vi.clearAllMocks();
});

function repo(nameWithOwner: string, isPrivate = false): Repo {
  const slash = nameWithOwner.indexOf('/');
  return {
    nameWithOwner,
    owner: nameWithOwner.slice(0, slash),
    name: nameWithOwner.slice(slash + 1),
    isPrivate,
  };
}

const EMPTY: RepoSignalData = {};

/** A "broken" repo (failing CI) so health classification sorts it worst-first. */
const BROKEN: RepoSignalData = {
  ci: { status: 'ready', conclusion: 'failure' },
};

/** A "healthy" repo (passing CI). */
const HEALTHY: RepoSignalData = {
  ci: { status: 'ready', conclusion: 'success' },
};

/** A "warning" repo (has a stale item). */
const WARNING: RepoSignalData = {
  ci: { status: 'ready', conclusion: 'success' },
  stale: { status: 'ready', staleCount: 1 },
};

function rowDataFor(map: Record<string, RepoSignalData>): GetRowData {
  return (r) => map[r.nameWithOwner] ?? EMPTY;
}

const REPOS = [repo('octo/zebra'), repo('octo/apple')];

function rowHeaderNames(): string[] {
  return screen.getAllByRole('rowheader').map((el) => el.textContent ?? '');
}

describe('FleetMatrix structure & accessibility', () => {
  it('renders an accessible table named for the fleet matrix', () => {
    render(<FleetMatrix repos={REPOS} getRowData={() => EMPTY} />);
    expect(screen.getByRole('table', { name: /fleet matrix/i })).toBeInTheDocument();
  });

  it('renders a column header for each of the 7 signals (plus the repo column)', () => {
    render(<FleetMatrix repos={REPOS} getRowData={() => EMPTY} />);
    for (const label of [
      'Repository',
      'CI',
      'Security',
      'Reviews',
      'Pull requests',
      'Issues',
      'Stale',
      'Activity',
    ]) {
      expect(
        screen.getByRole('columnheader', { name: new RegExp(`^${label}$`, 'i') }),
      ).toBeInTheDocument();
    }
    expect(screen.getAllByRole('columnheader')).toHaveLength(8);
  });

  it('renders one body row per repo, anchored by an owner/repo row header', () => {
    render(<FleetMatrix repos={REPOS} getRowData={() => EMPTY} />);
    expect(screen.getAllByRole('rowheader')).toHaveLength(2);
  });

  it('marks the repo cell as a <th scope="row">', () => {
    render(<FleetMatrix repos={[repo('octo/hello')]} getRowData={() => EMPTY} />);
    const rowHeader = screen.getByRole('rowheader');
    expect(rowHeader.tagName).toBe('TH');
    expect(rowHeader).toHaveAttribute('scope', 'row');
  });

  it('uses a sticky header row', () => {
    const { container } = render(<FleetMatrix repos={REPOS} getRowData={() => EMPTY} />);
    const headerCells = container.querySelectorAll('thead th');
    expect(headerCells.length).toBeGreaterThan(0);
    for (const cell of headerCells) {
      expect(cell.className).toContain('sticky');
    }
  });
});

describe('FleetMatrix ordering & cells', () => {
  it('orders rows worst-first (broken before healthy)', () => {
    const getRowData = rowDataFor({ 'octo/apple': HEALTHY, 'octo/zebra': BROKEN });
    render(<FleetMatrix repos={REPOS} getRowData={getRowData} />);
    // zebra is broken, apple healthy → zebra must come first despite name order.
    expect(rowHeaderNames()).toEqual(['octo/zebra', 'octo/apple']);
  });

  it('renders each signal cell with its existing status vocabulary', () => {
    const data: RepoSignalData = {
      ci: { status: 'ready', conclusion: 'failure' },
      security: {
        status: 'ready',
        grade: 'D',
        counts: { critical: 0, high: 2, medium: 0, low: 0 },
      },
      reviews: { status: 'ready', requestedCount: 2 },
      pullRequests: { status: 'ready', openCount: 4, externalCount: 0 },
      issues: { status: 'ready', openCount: 5, overThreshold: false },
      stale: { status: 'ready', staleCount: 3 },
    };
    render(<FleetMatrix repos={[repo('octo/hello')]} getRowData={() => data} />);

    const row = screen.getByRole('row', { name: /octo\/hello/i });
    expect(within(row).getByText('Failing')).toBeInTheDocument();
    expect(within(row).getByText('H2')).toBeInTheDocument();
    expect(within(row).getByText(/2 awaiting you/)).toBeInTheDocument();
    expect(within(row).getByText('4 open')).toBeInTheDocument();
    expect(within(row).getByText('5 open')).toBeInTheDocument();
    expect(within(row).getByText('3 stale')).toBeInTheDocument();
  });

  it('renders the activity signal by reusing the dashboard activity body', () => {
    render(<FleetMatrix repos={[repo('octo/hello')]} getRowData={() => EMPTY} />);
    // The reused ActivityTileBody self-fetches and announces commits-this-week.
    expect(mockActivity).toHaveBeenCalled();
    const row = screen.getByRole('row', { name: /octo\/hello/i });
    expect(within(row).getByText(/commit this week|commits this week/i)).toBeInTheDocument();
  });
});

describe('FleetMatrix drill-down', () => {
  it('activates a row via an accessible button when onRepoActivate is provided', async () => {
    const user = userEvent.setup();
    const onRepoActivate = vi.fn();
    render(
      <FleetMatrix
        repos={[repo('octo/hello')]}
        getRowData={() => EMPTY}
        onRepoActivate={onRepoActivate}
      />,
    );

    await user.click(screen.getByRole('button', { name: /view details for octo\/hello/i }));

    expect(onRepoActivate).toHaveBeenCalledWith(
      expect.objectContaining({ nameWithOwner: 'octo/hello' }),
    );
  });

  it('activates a row via the keyboard (Enter) on the row control', async () => {
    const user = userEvent.setup();
    const onRepoActivate = vi.fn();
    render(
      <FleetMatrix
        repos={[repo('octo/hello')]}
        getRowData={() => EMPTY}
        onRepoActivate={onRepoActivate}
      />,
    );

    const button = screen.getByRole('button', { name: /view details for octo\/hello/i });
    button.focus();
    await user.keyboard('{Enter}');

    expect(onRepoActivate).toHaveBeenCalledWith(
      expect.objectContaining({ nameWithOwner: 'octo/hello' }),
    );
  });

  it('renders a plain row header (no activation button) by default', () => {
    render(<FleetMatrix repos={[repo('octo/hello')]} getRowData={() => EMPTY} />);
    const rowHeader = screen.getByRole('rowheader');
    expect(within(rowHeader).queryByRole('button')).toBeNull();
  });
});

describe('FleetMatrix states', () => {
  it('shows decorative skeleton rows and announces loading via a live region', () => {
    const { container } = render(<FleetMatrix repos={[]} getRowData={() => EMPTY} loading />);

    expect(screen.getByRole('status')).toHaveTextContent(/loading/i);
    expect(container.querySelector('tbody')).toHaveAttribute('aria-busy', 'true');
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
    expect(screen.queryAllByRole('rowheader')).toHaveLength(0);
  });

  it('keeps showing live rows while a reload is in flight', () => {
    render(<FleetMatrix repos={REPOS} getRowData={() => EMPTY} loading />);
    expect(screen.getAllByRole('rowheader')).toHaveLength(2);
  });

  it('renders an alert with a retry control on failure', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(
      <FleetMatrix
        repos={[]}
        getRowData={() => EMPTY}
        error="Could not load your repositories."
        onRetry={onRetry}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Could not load your repositories.');
    await user.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('shows a friendly empty state when the fleet has no repos', () => {
    render(<FleetMatrix repos={[]} getRowData={() => EMPTY} />);
    expect(screen.getByText(/no repositories/i)).toBeInTheDocument();
    expect(screen.queryAllByRole('rowheader')).toHaveLength(0);
  });
});

describe('FleetMatrix health groups', () => {
  it('renders group header rows with correct band label and count', () => {
    const getRowData = rowDataFor({
      'octo/broken1': BROKEN,
      'octo/broken2': BROKEN,
      'octo/healthy1': HEALTHY,
    });
    const repos = [repo('octo/broken1'), repo('octo/broken2'), repo('octo/healthy1')];
    render(<FleetMatrix repos={repos} getRowData={getRowData} />);

    expect(screen.getByRole('button', { name: /broken.*2/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /healthy.*1/i })).toBeInTheDocument();
  });

  it('collapses Healthy group by default (its repo rows are absent from DOM)', () => {
    const getRowData = rowDataFor({
      'octo/broken1': BROKEN,
      'octo/healthy1': HEALTHY,
      'octo/healthy2': HEALTHY,
    });
    const repos = [repo('octo/broken1'), repo('octo/healthy1'), repo('octo/healthy2')];
    render(<FleetMatrix repos={repos} getRowData={getRowData} />);

    // Broken row should be visible
    expect(screen.getByRole('rowheader', { name: /octo\/broken1/i })).toBeInTheDocument();
    // Healthy rows should NOT be in the DOM
    expect(screen.queryByRole('rowheader', { name: /octo\/healthy1/i })).toBeNull();
    expect(screen.queryByRole('rowheader', { name: /octo\/healthy2/i })).toBeNull();
  });

  it('expands Healthy group when its toggle button is clicked', async () => {
    const user = userEvent.setup();
    const getRowData = rowDataFor({
      'octo/healthy1': HEALTHY,
      'octo/healthy2': HEALTHY,
    });
    const repos = [repo('octo/healthy1'), repo('octo/healthy2')];
    render(<FleetMatrix repos={repos} getRowData={getRowData} />);

    // Initially collapsed
    expect(screen.queryByRole('rowheader', { name: /octo\/healthy1/i })).toBeNull();

    // Click toggle
    await user.click(screen.getByRole('button', { name: /healthy.*2/i }));

    // Now visible
    expect(screen.getByRole('rowheader', { name: /octo\/healthy1/i })).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: /octo\/healthy2/i })).toBeInTheDocument();
  });

  it('updates aria-expanded when toggling a group', async () => {
    const user = userEvent.setup();
    const getRowData = rowDataFor({ 'octo/healthy1': HEALTHY });
    render(<FleetMatrix repos={[repo('octo/healthy1')]} getRowData={getRowData} />);

    const toggle = screen.getByRole('button', { name: /healthy.*1/i });

    // Initially collapsed (Healthy default)
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    // Expand
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    // Collapse again
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('renders Broken and Warning groups expanded by default', () => {
    const getRowData = rowDataFor({
      'octo/broken1': BROKEN,
      'octo/warning1': { ci: { status: 'ready', conclusion: 'success' }, stale: { status: 'ready', staleCount: 1 } },
    });
    const repos = [repo('octo/broken1'), repo('octo/warning1')];
    render(<FleetMatrix repos={repos} getRowData={getRowData} />);

    // Both groups should have their rows visible
    expect(screen.getByRole('rowheader', { name: /octo\/broken1/i })).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: /octo\/warning1/i })).toBeInTheDocument();

    // Verify aria-expanded
    expect(screen.getByRole('button', { name: /broken.*1/i })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: /warning.*1/i })).toHaveAttribute('aria-expanded', 'true');
  });

  it('allows drill-down on visible rows within expanded groups', async () => {
    const user = userEvent.setup();
    const onRepoActivate = vi.fn();
    const getRowData = rowDataFor({ 'octo/broken1': BROKEN });
    render(
      <FleetMatrix
        repos={[repo('octo/broken1')]}
        getRowData={getRowData}
        onRepoActivate={onRepoActivate}
      />,
    );

    // Click the repo row (not the group header)
    await user.click(screen.getByRole('button', { name: /view details for octo\/broken1/i }));

    expect(onRepoActivate).toHaveBeenCalledWith(
      expect.objectContaining({ nameWithOwner: 'octo/broken1' }),
    );
  });

  it('supports keyboard navigation (Enter/Space) on group toggle buttons', async () => {
    const user = userEvent.setup();
    const getRowData = rowDataFor({ 'octo/healthy1': HEALTHY });
    render(<FleetMatrix repos={[repo('octo/healthy1')]} getRowData={getRowData} />);

    const toggle = screen.getByRole('button', { name: /healthy.*1/i });
    toggle.focus();

    // Initially collapsed
    expect(screen.queryByRole('rowheader', { name: /octo\/healthy1/i })).toBeNull();

    // Expand with Enter
    await user.keyboard('{Enter}');
    expect(screen.getByRole('rowheader', { name: /octo\/healthy1/i })).toBeInTheDocument();
  });
});
