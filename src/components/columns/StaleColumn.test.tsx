import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { ReactElement } from 'react';

import type { Repo, RepoSignalData } from '../../types/fleet';
import { staleColumn } from './StaleColumn';

const REPO: Repo = { nameWithOwner: 'octo/a', owner: 'octo', name: 'a', isPrivate: false };

function renderCell(data: RepoSignalData) {
  return render(<>{staleColumn.render(REPO, data) as ReactElement}</>);
}

describe('staleColumn descriptor', () => {
  it('is the centred, descending-by-default stale column', () => {
    expect(staleColumn.id).toBe('stale');
    expect(staleColumn.header).toBe('Stale');
    expect(staleColumn.align).toBe('center');
    expect(staleColumn.sortable).toBe(true);
    expect(staleColumn.defaultSortDirection).toBe('desc');
  });

  it('sorts by the stale score, most-neglected first', () => {
    expect(
      staleColumn.getSortValue?.(REPO, { stale: { status: 'ready', staleCount: 4, score: 4 } }),
    ).toBe(4);
    expect(
      staleColumn.getSortValue?.(REPO, { stale: { status: 'ready', staleCount: 0, score: 0 } }),
    ).toBe(0);
  });

  it('sorts repos with no stale slice or score below every scored repo', () => {
    expect(staleColumn.getSortValue?.(REPO, {})).toBe(-1);
    expect(staleColumn.getSortValue?.(REPO, { stale: { status: 'loading' } })).toBe(-1);
  });

  it('renders the stale badge from the stale slice', () => {
    renderCell({ stale: { status: 'ready', staleCount: 2, score: 2 } });
    expect(screen.getByRole('img', { name: /2 open items with no activity/i })).toBeInTheDocument();
  });

  it('renders a neutral placeholder when the row has no stale data', () => {
    renderCell({});
    expect(screen.getByText('—')).toHaveAttribute('aria-hidden', 'true');
  });
});
