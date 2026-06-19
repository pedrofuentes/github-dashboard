import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { ReactElement } from 'react';

import type { Repo, RepoSignalData } from '../../types/fleet';
import { issuesColumn } from './IssuesColumn';

const REPO: Repo = { nameWithOwner: 'octo/a', owner: 'octo', name: 'a', isPrivate: false };

function renderCell(data: RepoSignalData) {
  return render(<>{issuesColumn.render(REPO, data) as ReactElement}</>);
}

describe('issuesColumn descriptor', () => {
  it('is a centered, descending-by-default sortable column', () => {
    expect(issuesColumn.id).toBe('issues');
    expect(issuesColumn.header).toBe('Issues');
    expect(issuesColumn.align).toBe('center');
    expect(issuesColumn.sortable).toBe(true);
    expect(issuesColumn.defaultSortDirection).toBe('desc');
    expect(issuesColumn.isRowHeader).toBeFalsy();
  });

  it('sorts by the issues slice score', () => {
    expect(issuesColumn.getSortValue?.(REPO, { issues: { status: 'ready', score: 7 } })).toBe(7);
  });

  it('sorts repos without an issues score last (descending)', () => {
    expect(issuesColumn.getSortValue?.(REPO, {})).toBe(-1);
    expect(issuesColumn.getSortValue?.(REPO, { issues: { status: 'loading' } })).toBe(-1);
  });

  it('renders the issues cell from the row data', () => {
    renderCell({ issues: { status: 'ready', openCount: 5, overThreshold: false, score: 1 } });

    expect(screen.getByLabelText('5 open issues')).toBeInTheDocument();
  });

  it('renders a neutral placeholder when the row has no issues data', () => {
    renderCell({});

    expect(screen.getByText('—')).toHaveAttribute('aria-hidden', 'true');
  });
});
