import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { ReactElement } from 'react';

import type { Repo, RepoSignalData } from '../../types/fleet';
import { reviewsColumn } from './ReviewsColumn';

const REPO: Repo = { nameWithOwner: 'octo/a', owner: 'octo', name: 'a', isPrivate: false };

function renderCell(data: RepoSignalData) {
  return render(<>{reviewsColumn.render(REPO, data) as ReactElement}</>);
}

describe('reviewsColumn descriptor', () => {
  it('is the centred, descending-by-default reviews column', () => {
    expect(reviewsColumn.id).toBe('reviews');
    expect(reviewsColumn.header).toBe('Reviews');
    expect(reviewsColumn.align).toBe('center');
    expect(reviewsColumn.sortable).toBe(true);
    expect(reviewsColumn.defaultSortDirection).toBe('desc');
  });

  it('sorts by the reviews score, highest urgency first', () => {
    expect(
      reviewsColumn.getSortValue?.(REPO, {
        reviews: { status: 'ready', requestedCount: 3, score: 30 },
      }),
    ).toBe(30);
    expect(
      reviewsColumn.getSortValue?.(REPO, {
        reviews: { status: 'ready', requestedCount: 0, score: 0 },
      }),
    ).toBe(0);
  });

  it('sorts repos with no reviews slice or score below every scored repo', () => {
    expect(reviewsColumn.getSortValue?.(REPO, {})).toBe(-1);
    expect(reviewsColumn.getSortValue?.(REPO, { reviews: { status: 'loading' } })).toBe(-1);
  });

  it('renders the awaiting-you badge from the reviews slice', () => {
    renderCell({ reviews: { status: 'ready', requestedCount: 2, score: 20 } });
    expect(
      screen.getByRole('img', { name: '2 pull requests awaiting your review' }),
    ).toBeInTheDocument();
  });

  it('renders a neutral placeholder when the row has no reviews data', () => {
    renderCell({});
    expect(screen.getByText('—')).toHaveAttribute('aria-hidden', 'true');
  });
});
