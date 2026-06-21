import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { PullRequestsSignalSlice, Repo, RepoSignalData } from '../../../types/fleet';
import type { TileTier } from '../types';

import { PrsTileBody } from './PrsTileBody';

const repo: Repo = {
  nameWithOwner: 'octocat/hello-world',
  owner: 'octocat',
  name: 'hello-world',
  isPrivate: false,
};

function data(pullRequests?: PullRequestsSignalSlice): RepoSignalData {
  return { pullRequests };
}

function renderBody(slice: PullRequestsSignalSlice | undefined, size: TileTier = 'standard') {
  return render(<PrsTileBody repo={repo} data={data(slice)} size={size} />);
}

describe('PrsTileBody — states (§3.6)', () => {
  it('shows a skeleton and sr-only text while loading', () => {
    const { container } = renderBody({ status: 'loading' });
    expect(screen.getByText('Loading pull requests…')).toBeInTheDocument();
    expect(container.querySelector('.animate-pulse')).toBeTruthy();
  });

  it('shows an error message when the slice errored', () => {
    renderBody({ status: 'error' });
    expect(screen.getByText('Couldn’t load pull requests')).toBeInTheDocument();
  });

  it('shows a neutral n/a when the slice is missing entirely', () => {
    renderBody(undefined);
    expect(screen.getByText('n/a')).toBeInTheDocument();
  });

  it('shows a neutral n/a for the unknown status', () => {
    renderBody({ status: 'unknown' });
    expect(screen.getByText('n/a')).toBeInTheDocument();
  });

  it('shows a positive empty state when ready with zero open PRs (never blank)', () => {
    renderBody({ status: 'ready', openCount: 0, externalCount: 0 });
    expect(screen.getByText('No open PRs')).toBeInTheDocument();
  });

  it('treats a ready slice with no openCount field as the empty state', () => {
    renderBody({ status: 'ready' });
    expect(screen.getByText('No open PRs')).toBeInTheDocument();
  });
});

describe('PrsTileBody — ready with open PRs', () => {
  it('renders the open count as the hero with info tone when no external PRs', () => {
    const { container } = renderBody({ status: 'ready', openCount: 12, externalCount: 0 });
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(container.querySelector('.text-accent-info')).toBeTruthy();
    expect(container.querySelector('.text-accent-coral')).toBeNull();
  });

  it('escalates the hero tone to coral when external PRs exist', () => {
    const { container } = renderBody({ status: 'ready', openCount: 7, externalCount: 3 });
    expect(container.querySelector('.text-accent-coral')).toBeTruthy();
  });

  it('renders an external Chip with redundant icon + text + sr label + title', () => {
    const { container } = renderBody({ status: 'ready', openCount: 7, externalCount: 3 });
    expect(screen.getByText('3 external')).toBeInTheDocument();
    const sr = container.querySelector('.sr-only');
    const srText = Array.from(container.querySelectorAll('.sr-only'))
      .map((n) => n.textContent)
      .join(' ');
    expect(sr).toBeTruthy();
    expect(srText).toContain('external-contributor');
    expect(screen.getByTitle('3 PRs from new outside contributors')).toBeInTheDocument();
  });

  it('uses singular nouns for a single external PR', () => {
    renderBody({ status: 'ready', openCount: 4, externalCount: 1 });
    expect(screen.getByText('1 external')).toBeInTheDocument();
    expect(screen.getByTitle('1 PR from new outside contributors')).toBeInTheDocument();
  });

  it('does not render an external Chip when there are no external PRs', () => {
    renderBody({ status: 'ready', openCount: 9, externalCount: 0 });
    expect(screen.queryByText(/external/i)).toBeNull();
  });

  it('includes the repo name in the open-count sr context', () => {
    const { container } = renderBody({ status: 'ready', openCount: 5, externalCount: 0 });
    const srText = Array.from(container.querySelectorAll('.sr-only'))
      .map((n) => n.textContent)
      .join(' ');
    expect(srText).toContain('octocat/hello-world');
  });
});

describe('PrsTileBody — size tiers (§3.4)', () => {
  it('compact shows the count and a small external indicator without the long chip label', () => {
    const { container } = renderBody(
      { status: 'ready', openCount: 7, externalCount: 3 },
      'compact',
    );
    expect(screen.getByText('7')).toBeInTheDocument();
    // compact uses a minimal indicator (number only), not the "N external" label
    expect(screen.queryByText('3 external')).toBeNull();
    const srText = Array.from(container.querySelectorAll('.sr-only'))
      .map((n) => n.textContent)
      .join(' ');
    expect(srText).toContain('external-contributor');
    expect(screen.queryByText(/from external contributors/i)).toBeNull();
  });

  it('compact with no external PRs shows just the count', () => {
    renderBody({ status: 'ready', openCount: 4, externalCount: 0 }, 'compact');
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.queryByText(/external/i)).toBeNull();
  });

  it('standard shows the open count plus the full external Chip', () => {
    renderBody({ status: 'ready', openCount: 7, externalCount: 3 }, 'standard');
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByText('3 external')).toBeInTheDocument();
  });

  it('expanded adds a descriptive line summarising open and external counts', () => {
    renderBody({ status: 'ready', openCount: 7, externalCount: 3 }, 'expanded');
    expect(screen.getByText('7 open · 3 from external contributors')).toBeInTheDocument();
    expect(screen.getByText('3 external')).toBeInTheDocument();
  });

  it('expanded with no external PRs shows a simple descriptive line', () => {
    renderBody({ status: 'ready', openCount: 5, externalCount: 0 }, 'expanded');
    expect(screen.getByText('5 open')).toBeInTheDocument();
  });
});
