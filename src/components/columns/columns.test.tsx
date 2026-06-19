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

describe('stub signal columns', () => {
  // A column is a stub until its signal feature (#12-18) ships a sort model;
  // filtering on `!sortable` keeps this suite correct as each real column lands.
  // `ci` and `reviews` (from main) and `pullRequests` (this branch) have shipped
  // sortable descriptors — each covered by its own *Column/*Cell test file — so
  // the filter excludes them and only the genuine stubs remain here.
  const stubs = fleetColumns.filter((c) => c.id !== 'repo' && !c.sortable);

  it('cover the signals still awaiting their feature (ci, reviews & PRs have shipped)', () => {
    expect(stubs.map((c) => c.id)).toEqual(['security', 'issues', 'stale']);
  });

  it('stay non-sortable until their signal feature lands (sorting lands per #12-18)', () => {
    // Each remaining stub gains `sortable` + `getSortValue` only once its own
    // signal feature ships; until then it stays non-sortable with no sort value.
    for (const column of stubs) {
      expect(column.sortable).toBeFalsy();
      expect(column.getSortValue).toBeUndefined();
    }
  });

  it('render a neutral placeholder with an accessible label (icon/text + sr-only)', () => {
    for (const column of stubs) {
      const { container, unmount } = renderCell(column, repo('octo/any'));
      const dash = screen.getByText('—');
      expect(dash).toHaveAttribute('aria-hidden', 'true');
      expect(container.querySelector('.sr-only')?.textContent ?? '').not.toBe('');
      unmount();
    }
  });
});
