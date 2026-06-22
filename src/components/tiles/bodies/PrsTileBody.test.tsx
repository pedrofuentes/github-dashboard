import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { formatRelativeTime } from '../../../lib/format';
import type {
  ExternalPullRequest,
  PullRequestsSignalSlice,
  Repo,
  RepoSignalData,
} from '../../../types/fleet';
import type { TileTier } from '../types';

import { PrsTileBody } from './PrsTileBody';

const repo: Repo = {
  nameWithOwner: 'octocat/hello-world',
  owner: 'octocat',
  name: 'hello-world',
  isPrivate: false,
};

function externalPr(overrides: Partial<ExternalPullRequest> = {}): ExternalPullRequest {
  return {
    number: 1,
    title: 'Add feature',
    html_url: 'https://github.com/octocat/hello-world/pull/1',
    created_at: '2024-01-01T00:00:00Z',
    user_login: 'newbie',
    author_association: 'FIRST_TIME_CONTRIBUTOR',
    ...overrides,
  };
}

function data(pullRequests?: PullRequestsSignalSlice): RepoSignalData {
  return { pullRequests };
}

function renderBody(slice: PullRequestsSignalSlice | undefined, size: TileTier = 'standard') {
  return render(<PrsTileBody repo={repo} data={data(slice)} size={size} />);
}

function srText(container: HTMLElement): string {
  return Array.from(container.querySelectorAll('.sr-only'))
    .map((node) => node.textContent)
    .join(' ');
}

describe('PrsTileBody — states (§3.6)', () => {
  it('routes loading through TileMessage (data-state="loading") with sr-only text', () => {
    const { container } = renderBody({ status: 'loading' });
    expect(container.querySelector('[data-state="loading"]')).not.toBeNull();
    expect(srText(container)).toContain('Loading pull requests');
  });

  it('routes errors through TileMessage (data-state="failed-to-load")', () => {
    const { container } = renderBody({ status: 'error' });
    expect(container.querySelector('[data-state="failed-to-load"]')).not.toBeNull();
    expect(screen.getAllByText(/couldn't load/i).length).toBeGreaterThan(0);
    expect(srText(container)).toContain('octocat/hello-world');
  });

  it('shows a neutral n/a when the slice is missing entirely', () => {
    renderBody(undefined);
    expect(screen.getByText('n/a')).toBeInTheDocument();
    expect(screen.getByText(/No pull request data for octocat\/hello-world/)).toBeInTheDocument();
  });

  it('shows a neutral n/a for the unknown status', () => {
    renderBody({ status: 'unknown' });
    expect(screen.getByText('n/a')).toBeInTheDocument();
  });

  it('routes a zero-open ready slice through TileMessage all-clear (data-state="empty")', () => {
    const { container } = renderBody({ status: 'ready', openCount: 0, externalCount: 0 });
    expect(container.querySelector('[data-state="empty"]')).not.toBeNull();
    expect(screen.getByText(/all clear/i, { selector: 'span' })).toBeInTheDocument();
    expect(srText(container)).toContain('No open pull requests in octocat/hello-world');
  });

  it('treats a ready slice with no openCount field as the all-clear state', () => {
    const { container } = renderBody({ status: 'ready' });
    expect(container.querySelector('[data-state="empty"]')).not.toBeNull();
  });

  it('clamps an out-of-contract negative open-count to the all-clear state', () => {
    // A negative count is never valid; it must degrade to all-clear rather than
    // render a misleading "-3" hero (DESIGN-TILES §3.6).
    const { container } = renderBody({ status: 'ready', openCount: -3, externalCount: 0 });
    expect(container.querySelector('[data-state="empty"]')).not.toBeNull();
    expect(container.querySelector('[data-state="ready"]')).toBeNull();
    expect(screen.queryByText('-3')).not.toBeInTheDocument();
  });

  it('HARD RULE: all-clear (empty) is unmistakable from failed-to-load', () => {
    const { container: clear } = renderBody({ status: 'ready', openCount: 0, externalCount: 0 });
    const { container: failed } = renderBody({ status: 'error' });
    expect(clear.querySelector('[data-state="empty"]')).not.toBeNull();
    expect(failed.querySelector('[data-state="failed-to-load"]')).not.toBeNull();
    expect(clear.querySelector('svg[data-status="success"]')).not.toBeNull();
    expect(failed.querySelector('svg[data-status="warning"]')).not.toBeNull();
  });
});

describe('PrsTileBody — hero + state attributes', () => {
  it('renders the open count as the hero with info tone when no new contributors', () => {
    const { container } = renderBody({ status: 'ready', openCount: 12, externalCount: 0 });
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(container.querySelector('.text-accent-info')).toBeTruthy();
    expect(container.querySelector('.text-accent-coral')).toBeNull();
  });

  it('escalates the hero tone to coral when new-contributor PRs exist', () => {
    const { container } = renderBody({ status: 'ready', openCount: 7, externalCount: 3 });
    expect(container.querySelector('.text-accent-coral')).toBeTruthy();
  });

  it('exposes ready state + tone + tier as data attributes for testing/snapshots', () => {
    const { container } = renderBody(
      { status: 'ready', openCount: 7, externalCount: 3 },
      'standard',
    );
    const root = container.querySelector('[data-state="ready"]');
    expect(root).toBeTruthy();
    expect(root?.getAttribute('data-tone')).toBe('coral');
    expect(root?.getAttribute('data-tier')).toBe('standard');
  });

  it('includes the repo name in the open-count sr context', () => {
    const { container } = renderBody({ status: 'ready', openCount: 5, externalCount: 0 });
    expect(srText(container)).toContain('octocat/hello-world');
  });

  it('uses the singular open-PR noun in the sr text when exactly 1 PR is open (#183)', () => {
    // openCount === 1 must read "1 open pull request" (singular) to assistive
    // tech — a regression to the plural ("1 open pull requests") is a WCAG AA
    // natural-language defect, so guard both the singular and against the plural.
    const { container } = renderBody({ status: 'ready', openCount: 1, externalCount: 0 });
    expect(srText(container)).toContain('1 open pull request in octocat/hello-world');
    expect(srText(container)).not.toContain('open pull requests');
  });
});

describe('PrsTileBody — new-contributor signal', () => {
  it('counts new-contributor PRs from author_association membership', () => {
    const { container } = renderBody({
      status: 'ready',
      openCount: 6,
      externalCount: 2,
      externalPullRequests: [
        externalPr({ number: 1, author_association: 'FIRST_TIME_CONTRIBUTOR' }),
        externalPr({ number: 2, author_association: 'NONE' }),
      ],
    });
    expect(screen.getByText('2 new contributors')).toBeInTheDocument();
    expect(srText(container)).toContain('new-contributor');
  });

  it('uses the singular noun for a single new contributor', () => {
    renderBody({
      status: 'ready',
      openCount: 4,
      externalCount: 1,
      externalPullRequests: [externalPr({ author_association: 'FIRST_TIMER' })],
    });
    expect(screen.getByText('1 new contributor')).toBeInTheDocument();
    expect(screen.getByTitle('1 PR from new outside contributors')).toBeInTheDocument();
  });

  it('ignores external PRs whose association is not a new contributor', () => {
    renderBody({
      status: 'ready',
      openCount: 5,
      externalCount: 2,
      externalPullRequests: [
        externalPr({ number: 1, author_association: 'MEMBER' }),
        externalPr({ number: 2, author_association: 'COLLABORATOR' }),
      ],
    });
    expect(screen.queryByText(/new contributor/i)).toBeNull();
  });

  it('falls back to externalCount when the identity array is absent', () => {
    renderBody({ status: 'ready', openCount: 7, externalCount: 3 });
    expect(screen.getByText('3 new contributors')).toBeInTheDocument();
    expect(screen.getByTitle('3 PRs from new outside contributors')).toBeInTheDocument();
  });

  it('renders a redundant chip: icon + text + sr label + title', () => {
    const { container } = renderBody({
      status: 'ready',
      openCount: 7,
      externalCount: 3,
      externalPullRequests: [
        externalPr({ number: 1 }),
        externalPr({ number: 2 }),
        externalPr({ number: 3 }),
      ],
    });
    expect(screen.getByText('3 new contributors')).toBeInTheDocument();
    expect(container.querySelector('svg[aria-hidden="true"]')).toBeTruthy();
    expect(srText(container)).toContain('new-contributor');
    expect(screen.getByTitle('3 PRs from new outside contributors')).toBeInTheDocument();
  });

  it('does not render a new-contributor chip when there are none', () => {
    renderBody({ status: 'ready', openCount: 9, externalCount: 0 });
    expect(screen.queryByText(/new contributor/i)).toBeNull();
  });
});

describe('PrsTileBody — 2-segment external/other bar (micro-viz)', () => {
  it('standard renders a 2-segment bar split into new-contributor and other-open', () => {
    const { container } = renderBody(
      {
        status: 'ready',
        openCount: 7,
        externalCount: 3,
        externalPullRequests: [
          externalPr({ number: 1 }),
          externalPr({ number: 2 }),
          externalPr({ number: 3 }),
        ],
      },
      'standard',
    );
    expect(screen.getByText('New-contributor: 3')).toBeInTheDocument();
    expect(screen.getByText('Other open: 4')).toBeInTheDocument();
    expect(container.querySelector('[data-tone="coral"]')).toBeTruthy();
    expect(container.querySelector('[data-tone="info"]')).toBeTruthy();
  });

  it('compact does not render the bar (hero + flag only)', () => {
    renderBody(
      {
        status: 'ready',
        openCount: 7,
        externalCount: 3,
        externalPullRequests: [externalPr({ number: 1 })],
      },
      'compact',
    );
    expect(screen.queryByText(/Other open:/)).toBeNull();
  });

  it('the bar still distinguishes segments without colour (sr list + width)', () => {
    const { container } = renderBody(
      {
        status: 'ready',
        openCount: 4,
        externalCount: 1,
        externalPullRequests: [externalPr()],
      },
      'standard',
    );
    expect(screen.getByText('New-contributor: 1')).toBeInTheDocument();
    expect(screen.getByText('Other open: 3')).toBeInTheDocument();
    // segment widths derive from the open total, not colour
    const segments = container.querySelectorAll('[data-tone]');
    expect(segments.length).toBeGreaterThanOrEqual(2);
  });
});

describe('PrsTileBody — size tiers (§3.4)', () => {
  it('compact shows the count and a minimal new-contributor indicator (no long label)', () => {
    const { container } = renderBody(
      {
        status: 'ready',
        openCount: 7,
        externalCount: 1,
        externalPullRequests: [externalPr({ number: 1 })],
      },
      'compact',
    );
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.queryByText('1 new contributor')).toBeNull();
    expect(srText(container)).toContain('new-contributor');
    expect(screen.queryByTitle(/from new outside contributors/i)).not.toBeNull();
  });

  it('compact with no new contributors shows just the count', () => {
    renderBody({ status: 'ready', openCount: 4, externalCount: 0 }, 'compact');
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.queryByText(/new contributor/i)).toBeNull();
  });

  it('standard shows the open count plus the full new-contributor chip', () => {
    renderBody(
      {
        status: 'ready',
        openCount: 7,
        externalCount: 3,
        externalPullRequests: [
          externalPr({ number: 1 }),
          externalPr({ number: 2 }),
          externalPr({ number: 3 }),
        ],
      },
      'standard',
    );
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByText('3 new contributors')).toBeInTheDocument();
  });

  it('expanded surfaces the oldest new-contributor PR age (min created_at)', () => {
    const oldest = '2020-02-01T00:00:00Z';
    renderBody(
      {
        status: 'ready',
        openCount: 7,
        externalCount: 2,
        externalPullRequests: [
          externalPr({ number: 1, created_at: '2024-06-01T00:00:00Z' }),
          externalPr({ number: 2, created_at: oldest }),
        ],
      },
      'expanded',
    );
    const expectedAge = formatRelativeTime(oldest);
    expect(screen.getByText(`Oldest new-contributor PR ${expectedAge}`)).toBeInTheDocument();
  });

  it('expanded adds a descriptive breakdown line summarising open and new contributors', () => {
    renderBody(
      {
        status: 'ready',
        openCount: 7,
        externalCount: 3,
        externalPullRequests: [
          externalPr({ number: 1 }),
          externalPr({ number: 2 }),
          externalPr({ number: 3 }),
        ],
      },
      'expanded',
    );
    expect(screen.getByText('7 open · 3 new contributors')).toBeInTheDocument();
  });

  it('expanded with no new contributors shows a simple descriptive line and no age', () => {
    renderBody({ status: 'ready', openCount: 5, externalCount: 0 }, 'expanded');
    expect(screen.getByText('5 open')).toBeInTheDocument();
    expect(screen.queryByText(/Oldest new-contributor PR/)).toBeNull();
  });

  it('expanded omits the age when only externalCount is known (no identity array)', () => {
    renderBody({ status: 'ready', openCount: 7, externalCount: 3 }, 'expanded');
    expect(screen.queryByText(/Oldest new-contributor PR/)).toBeNull();
    expect(screen.getByText('7 open · 3 new contributors')).toBeInTheDocument();
  });
});

describe('PrsTileBody — density-aware standard tier (T15)', () => {
  const slice: PullRequestsSignalSlice = {
    status: 'ready',
    openCount: 7,
    externalCount: 3,
    externalPullRequests: [
      externalPr({ number: 1 }),
      externalPr({ number: 2 }),
      externalPr({ number: 3 }),
    ],
  };

  it('glanceable standard: keeps the hero + flag but drops the 2-segment bar', () => {
    render(<PrsTileBody repo={repo} data={data(slice)} size="standard" density="glanceable" />);
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByText('3 new contributors')).toBeInTheDocument();
    expect(screen.queryByText('New-contributor: 3')).toBeNull();
  });

  it('balanced standard: keeps the 2-segment bar (unchanged)', () => {
    render(<PrsTileBody repo={repo} data={data(slice)} size="standard" density="balanced" />);
    expect(screen.getByText('New-contributor: 3')).toBeInTheDocument();
  });

  it('glanceable expanded: keeps the 2-segment bar (expanded unaffected)', () => {
    render(<PrsTileBody repo={repo} data={data(slice)} size="expanded" density="glanceable" />);
    expect(screen.getByText('New-contributor: 3')).toBeInTheDocument();
  });
});
