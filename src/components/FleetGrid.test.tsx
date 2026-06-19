import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FleetColumn, Repo } from '../types/fleet';
import { repoColumn } from './columns';
import { FleetGrid } from './FleetGrid';

function repo(nameWithOwner: string, isPrivate = false): Repo {
  const slash = nameWithOwner.indexOf('/');
  return {
    nameWithOwner,
    owner: nameWithOwner.slice(0, slash),
    name: nameWithOwner.slice(slash + 1),
    isPrivate,
  };
}

function rowHeaderNames(): string[] {
  return screen.getAllByRole('rowheader').map((el) => el.textContent ?? '');
}

const REPOS = [repo('octo/zebra'), repo('octo/apple'), repo('octo/mango')];

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('FleetGrid structure & accessibility', () => {
  it('renders an accessible table with one column header per registered column', () => {
    render(<FleetGrid repos={REPOS} />);

    expect(screen.getByRole('table')).toBeInTheDocument();
    for (const header of [
      'Repository',
      'CI',
      'Security',
      'Reviews',
      'New PRs',
      'Issues',
      'Stale',
    ]) {
      expect(
        screen.getByRole('columnheader', { name: new RegExp(`^${header}$`, 'i') }),
      ).toBeInTheDocument();
    }
  });

  it('renders one row per repo anchored by an owner/repo row header', () => {
    render(<FleetGrid repos={REPOS} />);
    expect(screen.getAllByRole('rowheader')).toHaveLength(3);
  });

  it('exposes the sortable header as a keyboard-operable button', () => {
    render(<FleetGrid repos={REPOS} />);
    const button = screen.getByRole('button', { name: /repository/i });
    expect(button.tagName).toBe('BUTTON');
  });

  it('does not expose aria-sort on non-sortable columns', () => {
    render(<FleetGrid repos={REPOS} />);
    expect(screen.getByRole('columnheader', { name: /^CI$/i })).not.toHaveAttribute('aria-sort');
  });
});

describe('FleetGrid sorting', () => {
  it('defaults to ascending sort by repo name', () => {
    render(<FleetGrid repos={REPOS} />);
    expect(rowHeaderNames()).toEqual(['octo/apple', 'octo/mango', 'octo/zebra']);
    expect(screen.getByRole('columnheader', { name: /repository/i })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
  });

  it('toggles to descending and updates aria-sort when the header is activated', async () => {
    const user = userEvent.setup();
    render(<FleetGrid repos={REPOS} />);

    await user.click(screen.getByRole('button', { name: /repository/i }));

    expect(rowHeaderNames()).toEqual(['octo/zebra', 'octo/mango', 'octo/apple']);
    expect(screen.getByRole('columnheader', { name: /repository/i })).toHaveAttribute(
      'aria-sort',
      'descending',
    );
  });

  it('persists the chosen sort to localStorage', async () => {
    const user = userEvent.setup();
    render(<FleetGrid repos={REPOS} />);

    await user.click(screen.getByRole('button', { name: /repository/i }));

    expect(JSON.parse(localStorage.getItem('fleet:sort') ?? 'null')).toEqual({
      columnId: 'repo',
      direction: 'desc',
    });
  });

  it('sorts by a contributed signal column using per-repo data', async () => {
    const user = userEvent.setup();
    const scores: Record<string, number> = { 'o/a': 5, 'o/b': 1, 'o/c': 3 };
    const columns: FleetColumn[] = [
      repoColumn,
      {
        id: 'score',
        header: 'Score',
        sortable: true,
        defaultSortDirection: 'desc',
        getSortValue: (_r, data) => data.ci?.score ?? 0,
        render: (_r, data) => <span>{data.ci?.score ?? 0}</span>,
      },
    ];
    render(
      <FleetGrid
        repos={[repo('o/a'), repo('o/b'), repo('o/c')]}
        columns={columns}
        getRowData={(r) => ({ ci: { status: 'ready', score: scores[r.nameWithOwner] } })}
      />,
    );

    await user.click(screen.getByRole('button', { name: /score/i }));

    expect(rowHeaderNames()).toEqual(['o/a', 'o/c', 'o/b']);
  });
});

describe('FleetGrid filtering', () => {
  it('narrows visible rows by a case-insensitive name substring', async () => {
    const user = userEvent.setup();
    render(<FleetGrid repos={REPOS} />);

    await user.type(screen.getByRole('searchbox'), 'app');

    expect(rowHeaderNames()).toEqual(['octo/apple']);
  });

  it('persists the filter to localStorage', async () => {
    const user = userEvent.setup();
    render(<FleetGrid repos={REPOS} />);

    await user.type(screen.getByRole('searchbox'), 'mango');

    expect(localStorage.getItem('fleet:filter')).toBe('mango');
  });

  it('shows a filter-specific empty state when nothing matches', async () => {
    const user = userEvent.setup();
    render(<FleetGrid repos={REPOS} />);

    await user.type(screen.getByRole('searchbox'), 'zzz');

    expect(screen.getByText(/no repositories match/i)).toBeInTheDocument();
    expect(screen.queryAllByRole('rowheader')).toHaveLength(0);
  });
});

describe('FleetGrid states', () => {
  it('shows an empty state when the fleet has no repos', () => {
    render(<FleetGrid repos={[]} />);
    expect(screen.getByText(/no repositories found/i)).toBeInTheDocument();
  });

  it('shows decorative skeleton rows and announces loading via a live region', () => {
    const { container } = render(<FleetGrid repos={[]} loading />);

    expect(screen.getByRole('status')).toHaveTextContent(/loading/i);
    expect(container.querySelector('tbody')).toHaveAttribute('aria-busy', 'true');
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
    // Skeleton rows are aria-hidden, so no real row headers are exposed.
    expect(screen.queryAllByRole('rowheader')).toHaveLength(0);
  });

  it('keeps showing live rows while a reload is in flight', () => {
    render(<FleetGrid repos={REPOS} loading />);
    expect(screen.getAllByRole('rowheader')).toHaveLength(3);
  });

  it('renders an alert with a retry control on failure', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(<FleetGrid repos={[]} error="Could not load your repositories." onRetry={onRetry} />);

    expect(screen.getByRole('alert')).toHaveTextContent('Could not load your repositories.');
    await user.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe('FleetGrid persistence on mount', () => {
  it('restores the sort and filter from localStorage', () => {
    localStorage.setItem('fleet:sort', JSON.stringify({ columnId: 'repo', direction: 'desc' }));
    localStorage.setItem('fleet:filter', 'mango');

    render(<FleetGrid repos={REPOS} />);

    expect(screen.getByRole('searchbox')).toHaveValue('mango');
    expect(screen.getByRole('columnheader', { name: /repository/i })).toHaveAttribute(
      'aria-sort',
      'descending',
    );
    expect(rowHeaderNames()).toEqual(['octo/mango']);
  });
});

describe('FleetGrid drill-down placeholder hook', () => {
  it('activates a row via an accessible button when onRepoActivate is provided', async () => {
    const user = userEvent.setup();
    const onRepoActivate = vi.fn();
    render(<FleetGrid repos={[repo('octo/hello')]} onRepoActivate={onRepoActivate} />);

    await user.click(screen.getByRole('button', { name: /view details for octo\/hello/i }));

    expect(onRepoActivate).toHaveBeenCalledWith(
      expect.objectContaining({ nameWithOwner: 'octo/hello' }),
    );
  });

  it('renders a plain row header (no activation button) by default', () => {
    render(<FleetGrid repos={[repo('octo/hello')]} />);
    const rowHeader = screen.getByRole('rowheader');
    expect(within(rowHeader).queryByRole('button')).toBeNull();
  });
});
