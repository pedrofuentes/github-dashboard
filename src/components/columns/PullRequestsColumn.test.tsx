import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { ReactElement } from 'react';

import type { Repo, RepoSignalData } from '../../types/fleet';
import { pullRequestsColumn } from './PullRequestsColumn';

const REPO: Repo = { nameWithOwner: 'octo/a', owner: 'octo', name: 'a', isPrivate: false };

function renderCell(data: RepoSignalData) {
  return render(<>{pullRequestsColumn.render(REPO, data) as ReactElement}</>);
}

describe('pullRequestsColumn descriptor', () => {
  it('keeps a stable id and the short "PRs" header', () => {
    expect(pullRequestsColumn.id).toBe('pullRequests');
    expect(pullRequestsColumn.header).toBe('PRs');
  });

  it('is a centre-aligned, descending-by-default sortable column', () => {
    expect(pullRequestsColumn.align).toBe('center');
    expect(pullRequestsColumn.sortable).toBe(true);
    expect(pullRequestsColumn.defaultSortDirection).toBe('desc');
  });

  it('sorts by the slice score', () => {
    expect(
      pullRequestsColumn.getSortValue?.(REPO, {
        pullRequests: { status: 'ready', openCount: 1, externalCount: 2, score: 11 },
      }),
    ).toBe(11);
  });

  it('sorts a scoreless or missing slice below every real score', () => {
    expect(pullRequestsColumn.getSortValue?.(REPO, { pullRequests: { status: 'ready' } })).toBe(-1);
    expect(pullRequestsColumn.getSortValue?.(REPO, {})).toBe(-1);
  });

  it('renders the pull-requests cell for the row', () => {
    renderCell({ pullRequests: { status: 'ready', openCount: 2, externalCount: 1, score: 7 } });

    expect(screen.getByText('2 open')).toBeInTheDocument();
    expect(screen.getByText('1 external')).toBeInTheDocument();
  });
});
