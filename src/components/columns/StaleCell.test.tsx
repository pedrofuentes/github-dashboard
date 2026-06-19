import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { StaleSignalSlice } from '../../types/fleet';
import { StaleCell } from './StaleCell';

function renderCell(slice: StaleSignalSlice | undefined) {
  return render(<StaleCell slice={slice} />);
}

describe('StaleCell', () => {
  it('renders an icon + "N stale" badge with an accessible label when items are neglected', () => {
    const { container } = renderCell({ status: 'ready', staleCount: 3, score: 3 });

    const badge = screen.getByRole('img', { name: /3 open items with no activity/i });
    expect(badge).toHaveTextContent('3 stale');
    // Colourblind-safe: meaning is carried by an icon + text, never colour alone.
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('uses the singular form for a single stale item', () => {
    renderCell({ status: 'ready', staleCount: 1, score: 1 });

    const badge = screen.getByRole('img', { name: /1 open item with no activity/i });
    expect(badge).toHaveTextContent('1 stale');
  });

  it('renders a muted dash (not a badge) when nothing is stale', () => {
    renderCell({ status: 'ready', staleCount: 0, score: 0 });

    expect(screen.queryByRole('img')).toBeNull();
    const dash = screen.getByText('—');
    expect(dash).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText(/no stale/i)).toBeInTheDocument();
  });

  it('treats a ready slice with no count as zero (muted dash)', () => {
    renderCell({ status: 'ready' });

    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText('—')).toHaveAttribute('aria-hidden', 'true');
  });

  it('renders an accessible loading skeleton while the search is in flight', () => {
    const { container } = renderCell({ status: 'loading' });

    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText(/loading stale/i)).toBeInTheDocument();
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
  });

  it('renders an accessible dash when the search failed', () => {
    renderCell({ status: 'error' });

    expect(screen.queryByRole('img')).toBeNull();
    const dash = screen.getByText('—');
    expect(dash).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText(/stale activity unavailable/i)).toBeInTheDocument();
  });

  it('renders a neutral placeholder when no slice is available yet', () => {
    renderCell(undefined);

    expect(screen.queryByRole('img')).toBeNull();
    const dash = screen.getByText('—');
    expect(dash).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText(/stale activity not loaded/i)).toBeInTheDocument();
  });
});
