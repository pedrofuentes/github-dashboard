import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { PullRequestsSignalSlice } from '../../types/fleet';
import { PullRequestsCell } from './PullRequestsCell';

function ready(openCount: number, externalCount: number): PullRequestsSignalSlice {
  return {
    status: 'ready',
    openCount,
    externalCount,
    score: externalCount * 5 + openCount,
  };
}

describe('PullRequestsCell', () => {
  it('shows the open PR count with an accessible label', () => {
    render(<PullRequestsCell slice={ready(3, 0)} />);

    expect(screen.getByText('3 open')).toBeInTheDocument();
    expect(screen.getByText('3 open pull requests')).toHaveClass('sr-only');
  });

  it('uses the singular noun for a single open PR', () => {
    render(<PullRequestsCell slice={ready(1, 0)} />);
    expect(screen.getByText('1 open pull request')).toBeInTheDocument();
  });

  it('omits the external badge when there are no outside-contributor PRs', () => {
    render(<PullRequestsCell slice={ready(4, 0)} />);

    expect(screen.queryByText(/external/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/outside contributors/i)).not.toBeInTheDocument();
  });

  it('highlights new outside-contributor PRs with a non-colour-only badge', () => {
    render(<PullRequestsCell slice={ready(5, 2)} />);

    // Visible, colourblind-safe text (not colour alone)…
    expect(screen.getByText('2 external')).toBeInTheDocument();
    // …backed by a screen-reader label and a hover title.
    expect(screen.getByText('2 pull requests from new outside contributors')).toHaveClass(
      'sr-only',
    );
    expect(screen.getByTitle('2 PRs from new outside contributors')).toBeInTheDocument();
  });

  it('uses singular wording for a single external PR', () => {
    render(<PullRequestsCell slice={ready(2, 1)} />);

    expect(screen.getByText('1 external')).toBeInTheDocument();
    expect(screen.getByText('1 pull request from new outside contributors')).toBeInTheDocument();
    expect(screen.getByTitle('1 PR from new outside contributors')).toBeInTheDocument();
  });

  it('renders a muted dash with a label when no PRs are open', () => {
    render(<PullRequestsCell slice={ready(0, 0)} />);

    expect(screen.getByText('—')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText(/no open pull requests/i)).toHaveClass('sr-only');
  });

  it('renders a labelled dash when the slice is missing', () => {
    render(<PullRequestsCell slice={undefined} />);

    expect(screen.getByText('—')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText(/no pull request data/i)).toHaveClass('sr-only');
  });

  it('shows a decorative skeleton while loading', () => {
    const { container } = render(<PullRequestsCell slice={{ status: 'loading' }} />);

    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
    expect(screen.getByText(/loading pull requests/i)).toHaveClass('sr-only');
  });

  it('renders an accessible dash on error', () => {
    render(<PullRequestsCell slice={{ status: 'error' }} />);

    expect(screen.getByText('—')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText(/pull request data unavailable/i)).toHaveClass('sr-only');
  });
});
