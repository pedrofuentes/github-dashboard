import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { ReactElement } from 'react';

import type { FleetColumn, Repo, RepoSignalData } from '../../types/fleet';
import { fleetColumns, repoColumn } from './index';

const EMPTY: RepoSignalData = {};

function repo(nameWithOwner: string, isPrivate = false): Repo {
  const slash = nameWithOwner.indexOf('/');
  return {
    nameWithOwner,
    owner: nameWithOwner.slice(0, slash),
    name: nameWithOwner.slice(slash + 1),
    isPrivate,
  };
}

function renderCell(column: FleetColumn, target: Repo, data: RepoSignalData = EMPTY) {
  return render(<>{column.render(target, data) as ReactElement}</>);
}

describe('fleet column registry', () => {
  it('lists the seven MVP columns left-to-right in PRD order', () => {
    expect(fleetColumns.map((c) => c.id)).toEqual([
      'repo',
      'ci',
      'security',
      'reviews',
      'pullRequests',
      'issues',
      'stale',
    ]);
  });

  it('gives every column a unique id, a header, and a renderer', () => {
    const ids = fleetColumns.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const column of fleetColumns) {
      expect(column.header.length).toBeGreaterThan(0);
      expect(typeof column.render).toBe('function');
    }
  });

  it('marks exactly one row-header column, and it is the repo column', () => {
    const rowHeaders = fleetColumns.filter((c) => c.isRowHeader);
    expect(rowHeaders).toHaveLength(1);
    expect(rowHeaders[0].id).toBe('repo');
    expect(rowHeaders[0]).toBe(repoColumn);
  });
});

describe('repo column', () => {
  it('is sortable and sorts by the lowercased full name', () => {
    expect(repoColumn.sortable).toBe(true);
    expect(repoColumn.getSortValue?.(repo('Octo/Hello'), EMPTY)).toBe('octo/hello');
  });

  it('renders the owner/repo with a full-name title tooltip', () => {
    renderCell(repoColumn, repo('octocat/hello-world'));
    const nameEl = screen.getByTitle('octocat/hello-world');
    expect(nameEl).toHaveTextContent('octocat/hello-world');
  });

  it('signals private repos with a screen-reader label, not color alone', () => {
    renderCell(repoColumn, repo('octocat/secret', true));
    expect(screen.getByText(/private repository/i)).toBeInTheDocument();
  });

  it('omits the private label for public repos', () => {
    renderCell(repoColumn, repo('octocat/public', false));
    expect(screen.queryByText(/private repository/i)).toBeNull();
  });
});

describe('signal columns', () => {
  // Every signal feature (#12-18) has now shipped, so no column is a stub: each
  // non-repo column exposes a sortable descriptor backed by a getSortValue
  // accessor — each covered by its own *Column/*Cell test file. The `!sortable`
  // stub set is therefore empty, which this suite asserts directly. `repo` is
  // excluded as the row-header column (its sortability is covered above).
  const signalColumns = fleetColumns.filter((c) => c.id !== 'repo');

  it('cover CI, Security, Reviews, PRs, Issues, and Stale', () => {
    expect(signalColumns.map((c) => c.id)).toEqual([
      'ci',
      'security',
      'reviews',
      'pullRequests',
      'issues',
      'stale',
    ]);
  });

  it('are all sortable with a getSortValue accessor — no stubs remain', () => {
    expect(signalColumns.filter((c) => !c.sortable)).toHaveLength(0);
    for (const column of signalColumns) {
      expect(column.sortable).toBe(true);
      expect(typeof column.getSortValue).toBe('function');
    }
  });

  it('render a neutral placeholder with an accessible label (icon/text + sr-only)', () => {
    for (const column of signalColumns) {
      const { container, unmount } = renderCell(column, repo('octo/any'));
      const dash = screen.getByText('—');
      expect(dash).toHaveAttribute('aria-hidden', 'true');
      expect(container.querySelector('.sr-only')?.textContent ?? '').not.toBe('');
      unmount();
    }
  });
});
