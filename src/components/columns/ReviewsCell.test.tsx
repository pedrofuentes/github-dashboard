import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { ReviewsSignalSlice } from '../../types/fleet';
import { ReviewsCell } from './ReviewsCell';

function renderCell(slice: ReviewsSignalSlice | undefined) {
  return render(<ReviewsCell slice={slice} />);
}

describe('ReviewsCell', () => {
  it('renders a prominent badge with an accessible label when reviews await the user', () => {
    const { container } = renderCell({ status: 'ready', requestedCount: 3, score: 30 });

    const badge = screen.getByRole('img', { name: '3 pull requests awaiting your review' });
    expect(badge).toHaveTextContent('3 awaiting you');
    // Non-colour-only: the badge pairs an icon with text.
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('uses the singular form for a single awaiting review', () => {
    renderCell({ status: 'ready', requestedCount: 1, score: 10 });

    const badge = screen.getByRole('img', { name: '1 pull request awaiting your review' });
    expect(badge).toHaveTextContent('1 awaiting you');
  });

  it('renders a muted dash (not a badge) when zero reviews await the user', () => {
    renderCell({ status: 'ready', requestedCount: 0, score: 0 });

    expect(screen.queryByRole('img')).toBeNull();
    const dash = screen.getByText('—');
    expect(dash).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText(/no pull requests awaiting your review/i)).toBeInTheDocument();
  });

  it('treats a ready slice with no count as zero (muted dash)', () => {
    renderCell({ status: 'ready' });

    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText('—')).toHaveAttribute('aria-hidden', 'true');
  });

  it('renders an accessible loading skeleton while the queue is loading', () => {
    const { container } = renderCell({ status: 'loading' });

    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText(/loading review requests/i)).toBeInTheDocument();
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
  });

  it('renders an accessible dash when the queue failed to load', () => {
    renderCell({ status: 'error' });

    expect(screen.queryByRole('img')).toBeNull();
    const dash = screen.getByText('—');
    expect(dash).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText(/review queue unavailable/i)).toBeInTheDocument();
  });

  it('renders a neutral placeholder when no slice is available yet', () => {
    renderCell(undefined);

    expect(screen.queryByRole('img')).toBeNull();
    const dash = screen.getByText('—');
    expect(dash).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText(/review queue not loaded/i)).toBeInTheDocument();
  });
});
