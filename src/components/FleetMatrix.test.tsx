import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CommitActivityState } from '../hooks/useCommitActivity';
import { useCommitActivity } from '../hooks/useCommitActivity';
import type { GetRowData, Repo, RepoSignalData } from '../types/fleet';
import { FleetMatrix } from './FleetMatrix';

vi.mock('../hooks/useCommitActivity', () => ({ useCommitActivity: vi.fn() }));

const mockActivity = vi.mocked(useCommitActivity);

/** Number of skeleton rows shown during loading (mirrors FleetMatrix.tsx). */
const SKELETON_ROWS = 6;

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

function rowDataFor(map: Record<string, RepoSignalData>): GetRowData {
  return (r) => map[r.nameWithOwner] ?? EMPTY;
}

const REPOS = [repo('octo/zebra'), repo('octo/apple')];

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
    // Use broken repos so they appear in an expanded group
    const getRowData = rowDataFor({ 'octo/zebra': BROKEN, 'octo/apple': BROKEN });
    render(<FleetMatrix repos={REPOS} getRowData={getRowData} />);
    expect(screen.getAllByRole('rowheader')).toHaveLength(2);
  });

  it('marks the repo cell as a <th scope="row">', () => {
    // Use broken repo so it appears in an expanded group
    render(<FleetMatrix repos={[repo('octo/hello')]} getRowData={() => BROKEN} />);
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
  it('orders groups worst-first (broken before healthy)', () => {
    const getRowData = rowDataFor({ 'octo/apple': HEALTHY, 'octo/zebra': BROKEN });
    render(<FleetMatrix repos={REPOS} getRowData={getRowData} />);
    // Exactly two group toggle buttons in DOM order: broken first, healthy second
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toHaveTextContent(/^broken.*1/i);
    expect(buttons[0]).toHaveAttribute('aria-expanded', 'true');
    expect(buttons[1]).toHaveTextContent(/^healthy.*1/i);
    expect(buttons[1]).toHaveAttribute('aria-expanded', 'false');
    // Broken group expanded → exactly one rowheader (octo/zebra); healthy collapsed → absent
    const rowheaders = screen.getAllByRole('rowheader');
    expect(rowheaders).toHaveLength(1);
    expect(rowheaders[0]).toHaveTextContent('octo/zebra');
    expect(screen.queryByRole('rowheader', { name: /octo\/apple/i })).toBeNull();
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
    // Use broken repo so it appears in an expanded group
    render(<FleetMatrix repos={[repo('octo/hello')]} getRowData={() => BROKEN} />);
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
    // Use broken repo so it appears in an expanded group
    render(
      <FleetMatrix
        repos={[repo('octo/hello')]}
        getRowData={() => BROKEN}
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
    // Use broken repo so it appears in an expanded group
    render(
      <FleetMatrix
        repos={[repo('octo/hello')]}
        getRowData={() => BROKEN}
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
    // Use broken repo so it appears in an expanded group
    render(<FleetMatrix repos={[repo('octo/hello')]} getRowData={() => BROKEN} />);
    const rowHeader = screen.getByRole('rowheader');
    expect(within(rowHeader).queryByRole('button')).toBeNull();
  });
});

describe('FleetMatrix states', () => {
  it('shows decorative skeleton rows and announces loading via a live region', () => {
    const { container } = render(<FleetMatrix repos={[]} getRowData={() => EMPTY} loading />);

    expect(screen.getByRole('status')).toHaveTextContent(/loading/i);
    expect(container.querySelector('tbody')).toHaveAttribute('aria-busy', 'true');
    expect(container.querySelectorAll('.animate-pulse').length).toBe(SKELETON_ROWS * 8);
    expect(screen.queryAllByRole('rowheader')).toHaveLength(0);
  });

  it('keeps showing live rows while a reload is in flight', () => {
    // Use broken repos so they appear in an expanded group
    const getRowData = rowDataFor({ 'octo/zebra': BROKEN, 'octo/apple': BROKEN });
    render(<FleetMatrix repos={REPOS} getRowData={getRowData} loading />);
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

  it('renders an error alert without retry control when onRetry is absent', () => {
    render(
      <FleetMatrix repos={[]} getRowData={() => EMPTY} error="Could not load your repositories." />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Could not load your repositories.');
    expect(screen.queryByRole('button', { name: /retry/i })).toBeNull();
  });

  it('shows a friendly empty state when the fleet has no repos', () => {
    render(<FleetMatrix repos={[]} getRowData={() => EMPTY} />);
    expect(screen.getByText(/no repositories to display/i)).toBeInTheDocument();
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
      'octo/warning1': {
        ci: { status: 'ready', conclusion: 'success' },
        stale: { status: 'ready', staleCount: 1 },
      },
    });
    const repos = [repo('octo/broken1'), repo('octo/warning1')];
    render(<FleetMatrix repos={repos} getRowData={getRowData} />);

    // Both groups should have their rows visible
    expect(screen.getByRole('rowheader', { name: /octo\/broken1/i })).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: /octo\/warning1/i })).toBeInTheDocument();

    // Verify aria-expanded
    expect(screen.getByRole('button', { name: /broken.*1/i })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByRole('button', { name: /warning.*1/i })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
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

    // Collapse with Space
    await user.keyboard(' ');
    expect(screen.queryByRole('rowheader', { name: /octo\/healthy1/i })).toBeNull();
  });
});

describe('FleetMatrix density modes (T-c4)', () => {
  const DENSITY_KEY = 'fleet:density';

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('applies balanced density spacing by default (current py-2 spacing)', () => {
    render(<FleetMatrix repos={[repo('octo/hello')]} getRowData={() => BROKEN} />);
    const row = screen.getByRole('row', { name: /octo\/hello/i });
    const rowHeader = within(row).getByRole('rowheader');
    // Balanced uses py-2, not the tighter py-1 used by glanceable — both directions
    expect(rowHeader.className).toMatch(/py-2(?:\s|$)/);
    expect(rowHeader.className).not.toMatch(/(?:^|\s)py-1(?:\s|$)/);
    // Signal cells also carry py-2, not py-1
    const cells = within(row).getAllByRole('cell');
    for (const cell of cells) {
      expect(cell.className).toMatch(/py-2(?:\s|$)/);
      expect(cell.className).not.toMatch(/(?:^|\s)py-1(?:\s|$)/);
    }
  });

  it('applies glanceable density spacing when stored (tighter py-1 spacing)', () => {
    localStorage.setItem(DENSITY_KEY, 'glanceable');
    render(<FleetMatrix repos={[repo('octo/hello')]} getRowData={() => BROKEN} />);
    const row = screen.getByRole('row', { name: /octo\/hello/i });
    const rowHeader = within(row).getByRole('rowheader');
    // Glanceable uses py-1 (tighter spacing)
    expect(rowHeader.className).toMatch(/py-1(?:\s|$)/);
  });

  it('applies balanced density spacing to signal cells', () => {
    render(<FleetMatrix repos={[repo('octo/hello')]} getRowData={() => BROKEN} />);
    const row = screen.getByRole('row', { name: /octo\/hello/i });
    const cells = within(row).getAllByRole('cell');
    // All signal cells should have balanced spacing (py-2)
    for (const cell of cells) {
      expect(cell.className).toMatch(/py-2(?:\s|$)/);
    }
  });

  it('applies glanceable density spacing to signal cells', () => {
    localStorage.setItem(DENSITY_KEY, 'glanceable');
    render(<FleetMatrix repos={[repo('octo/hello')]} getRowData={() => BROKEN} />);
    const row = screen.getByRole('row', { name: /octo\/hello/i });
    const cells = within(row).getAllByRole('cell');
    // All signal cells should have glanceable spacing (py-1)
    for (const cell of cells) {
      expect(cell.className).toMatch(/py-1(?:\s|$)/);
    }
  });

  it('preserves all existing behavior at both densities (drill-down still works)', async () => {
    const user = userEvent.setup();
    const onRepoActivate = vi.fn();

    // Test with glanceable
    localStorage.setItem(DENSITY_KEY, 'glanceable');
    const { unmount } = render(
      <FleetMatrix
        repos={[repo('octo/hello')]}
        getRowData={() => BROKEN}
        onRepoActivate={onRepoActivate}
      />,
    );

    await user.click(screen.getByRole('button', { name: /view details for octo\/hello/i }));
    expect(onRepoActivate).toHaveBeenCalledWith(
      expect.objectContaining({ nameWithOwner: 'octo/hello' }),
    );

    unmount();
    onRepoActivate.mockClear();

    // Test with balanced
    localStorage.setItem(DENSITY_KEY, 'balanced');
    render(
      <FleetMatrix
        repos={[repo('octo/hello')]}
        getRowData={() => BROKEN}
        onRepoActivate={onRepoActivate}
      />,
    );

    await user.click(screen.getByRole('button', { name: /view details for octo\/hello/i }));
    expect(onRepoActivate).toHaveBeenCalledWith(
      expect.objectContaining({ nameWithOwner: 'octo/hello' }),
    );
  });

  it('applies density to skeleton rows during loading', () => {
    localStorage.setItem(DENSITY_KEY, 'glanceable');
    const { container } = render(<FleetMatrix repos={[]} getRowData={() => EMPTY} loading />);
    const skeletonCells = container.querySelectorAll('.animate-pulse');
    expect(skeletonCells.length).toBeGreaterThan(0);
    // Parent td should have glanceable spacing
    const firstSkeletonTd = skeletonCells[0].closest('td');
    expect(firstSkeletonTd?.className).toMatch(/py-1\.5(?:\s|$)/);
  });

  it('preserves signal cell content visibility at both densities', () => {
    const data: RepoSignalData = {
      ci: { status: 'ready', conclusion: 'failure' },
    };

    // Glanceable
    localStorage.setItem(DENSITY_KEY, 'glanceable');
    const { unmount: unmount1 } = render(
      <FleetMatrix repos={[repo('octo/hello')]} getRowData={() => data} />,
    );
    expect(screen.getByText('Failing')).toBeInTheDocument();
    unmount1();

    // Balanced
    localStorage.setItem(DENSITY_KEY, 'balanced');
    render(<FleetMatrix repos={[repo('octo/hello')]} getRowData={() => data} />);
    expect(screen.getByText('Failing')).toBeInTheDocument();
  });
});
