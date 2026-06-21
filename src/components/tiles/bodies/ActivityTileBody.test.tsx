import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CommitActivityWeek } from '../../../api/github/commit-activity';
import type { Repo } from '../../../types/fleet';
import type { TileTier } from '../types';
import type { CommitActivityState } from '../../../hooks/useCommitActivity';
import { useCommitActivity } from '../../../hooks/useCommitActivity';
import { ActivityTileBody } from './ActivityTileBody';

vi.mock('../../../hooks/useCommitActivity', () => ({ useCommitActivity: vi.fn() }));

const mockUse = vi.mocked(useCommitActivity);

const repo: Repo = { nameWithOwner: 'octo/a', owner: 'octo', name: 'a', isPrivate: false };

function week(total: number, days: number[]): CommitActivityWeek {
  return { total, week: 1700000000, days };
}

function renderBody(state: CommitActivityState, size: TileTier = 'standard') {
  mockUse.mockReturnValue(state);
  return render(<ActivityTileBody repo={repo} size={size} />);
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('ActivityTileBody — non-ok states (§4.7)', () => {
  it('renders a reduced-motion-safe skeleton while loading', () => {
    const { container } = renderBody({ state: 'loading' });
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
    const pulse = container.querySelector('.animate-pulse');
    expect(pulse).toBeTruthy();
    expect(pulse?.className).toContain('motion-reduce:animate-none');
  });

  it('renders a computing message', () => {
    renderBody({ state: 'computing' });
    expect(screen.getByText(/computing/i)).toBeInTheDocument();
  });

  it('renders an empty message for no recent activity', () => {
    renderBody({ state: 'empty' });
    expect(screen.getByText(/no recent commit activity/i)).toBeInTheDocument();
  });

  it('renders an error message and never throws', () => {
    renderBody({ state: 'error', error: new Error('x') });
    expect(screen.getByText(/activity unavailable/i)).toBeInTheDocument();
  });
});

describe('ActivityTileBody — ok state', () => {
  const weeks: CommitActivityWeek[] = [
    week(3, [0, 1, 0, 2, 0, 0, 0]),
    week(5, [1, 1, 1, 1, 1, 0, 0]),
    week(0, [0, 0, 0, 0, 0, 0, 0]),
  ];

  it('renders a sparkline with an accessible summary of total commits over weeks', () => {
    renderBody({ state: 'ok', weeks }, 'standard');
    const sparkline = screen.getByRole('img', { name: /8 commits over 3 weeks/i });
    expect(sparkline).toBeInTheDocument();
  });

  it('shows the total commit count as text', () => {
    renderBody({ state: 'ok', weeks }, 'standard');
    expect(screen.getByText('8')).toBeInTheDocument();
  });

  it('at compact size shows the sparkline + total but NOT the heatmap', () => {
    renderBody({ state: 'ok', weeks }, 'compact');
    expect(screen.getByText('8')).toBeInTheDocument();
    // sparkline present, heatmap (with weekly-total table) absent
    expect(screen.getByRole('img', { name: /commits over/i })).toBeInTheDocument();
    const { container } = renderBody({ state: 'ok', weeks }, 'compact');
    expect(container.querySelector('[data-heatmap-cell]')).toBeNull();
  });

  it('at expanded size also renders the heatmap', () => {
    const { container } = renderBody({ state: 'ok', weeks }, 'expanded');
    expect(container.querySelector('[data-heatmap-cell]')).toBeTruthy();
    // both visuals present: sparkline + heatmap each expose role="img"
    expect(screen.getAllByRole('img').length).toBeGreaterThanOrEqual(2);
  });

  it('passes the repo through to the data hook', () => {
    renderBody({ state: 'ok', weeks });
    expect(mockUse).toHaveBeenCalledWith(repo);
  });
});
