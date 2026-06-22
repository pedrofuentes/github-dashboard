import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { formatRelativeTime } from '../../../lib/format';
import type { Repo, ReviewRequestedPullRequest, ReviewsSignalSlice } from '../../../types/fleet';
import { ReviewsTileBody } from './ReviewsTileBody';

const repo: Repo = {
  nameWithOwner: 'octocat/hello-world',
  owner: 'octocat',
  name: 'hello-world',
  isPrivate: false,
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Build a review-requested PR `created_at` the given number of days in the past. */
function daysAgo(days: number): string {
  return new Date(Date.now() - days * DAY_MS).toISOString();
}

/** Minimal review-requested PR fixture with a controllable `created_at`. */
function request(createdAt: string, number = 1): ReviewRequestedPullRequest {
  return {
    number,
    title: `PR #${String(number)}`,
    html_url: `https://github.com/octocat/hello-world/pull/${String(number)}`,
    created_at: createdAt,
    user_login: 'octocat',
  };
}

function renderBody(
  reviews: ReviewsSignalSlice | undefined,
  size: 'compact' | 'standard' | 'expanded' = 'standard',
) {
  return render(<ReviewsTileBody repo={repo} data={{ reviews }} size={size} />);
}

describe('ReviewsTileBody — states', () => {
  it('shows a loading state with sr text', () => {
    const { getAllByText } = renderBody({ status: 'loading' });
    expect(getAllByText(/loading reviews/i).length).toBeGreaterThan(0);
  });

  it('shows an error state', () => {
    const { getAllByText } = renderBody({ status: 'error' });
    expect(getAllByText(/review queue unavailable/i).length).toBeGreaterThan(0);
  });

  it('shows n/a for an unknown slice', () => {
    const { getByText } = renderBody({ status: 'unknown' });
    expect(getByText(/n\/a/i)).toBeInTheDocument();
  });

  it('shows n/a when there is no slice at all', () => {
    const { getByText } = renderBody(undefined);
    expect(getByText(/n\/a/i)).toBeInTheDocument();
  });

  it('shows a positive clear state at zero (never blank)', () => {
    const { getAllByText, container } = renderBody({ status: 'ready', requestedCount: 0 });
    expect(getAllByText(/none awaiting your review/i).length).toBeGreaterThan(0);
    expect(container.querySelector('[data-tone="neutral"]')).not.toBeNull();
  });
});

describe('ReviewsTileBody — urgency escalation (DESIGN-TILES §4.4)', () => {
  const cases: Array<[number, string]> = [
    [0, 'neutral'],
    [1, 'info'],
    [2, 'info'],
    [3, 'warning'],
    [4, 'warning'],
    [5, 'failure'],
    [12, 'failure'],
  ];

  it.each(cases)('maps %d requests to tone %s', (requestedCount, tone) => {
    const { container } = renderBody({ status: 'ready', requestedCount });
    const root = container.querySelector('[data-tone]');
    expect(root?.getAttribute('data-tone')).toBe(tone);
  });

  it('renders the count and an "awaiting you" chip when > 0', () => {
    const { getByText, getAllByText } = renderBody({ status: 'ready', requestedCount: 3 });
    expect(getByText('3')).toBeInTheDocument();
    expect(getAllByText(/awaiting you/i).length).toBeGreaterThan(0);
  });

  it('uses singular "request" phrasing for a single review', () => {
    const { getAllByText } = renderBody({ status: 'ready', requestedCount: 1 }, 'expanded');
    expect(getAllByText(/1 pull request awaiting your review/i).length).toBeGreaterThan(0);
  });
});

describe('ReviewsTileBody — size tiers', () => {
  const slice: ReviewsSignalSlice = { status: 'ready', requestedCount: 4 };

  it('compact: shows the value with a minimal label', () => {
    const { getByText, container } = renderBody(slice, 'compact');
    expect(getByText('4')).toBeInTheDocument();
    expect(container.querySelector('[data-tier="compact"]')).not.toBeNull();
  });

  it('standard: shows the value and the chip', () => {
    const { getByText, getAllByText } = renderBody(slice, 'standard');
    expect(getByText('4')).toBeInTheDocument();
    expect(getAllByText(/awaiting you/i).length).toBeGreaterThan(0);
  });

  it('expanded: adds the descriptive line', () => {
    const { getAllByText, container } = renderBody(slice, 'expanded');
    expect(getAllByText(/pull requests awaiting your review/i).length).toBeGreaterThan(0);
    expect(container.querySelector('[data-part="detail"]')).not.toBeNull();
  });
});

describe('ReviewsTileBody — oldest-waiting age (urgency driver, T10)', () => {
  it('standard: shows the oldest waiting age from the min request created_at', () => {
    const oldest = daysAgo(5);
    const slice: ReviewsSignalSlice = {
      status: 'ready',
      requestedCount: 2,
      requests: [request(daysAgo(2), 1), request(oldest, 2)],
    };
    const { getByText } = renderBody(slice, 'standard');
    expect(getByText(`oldest ${formatRelativeTime(new Date(oldest))}`)).toBeInTheDocument();
  });

  it('expanded: also shows the oldest waiting age', () => {
    const oldest = daysAgo(9);
    const slice: ReviewsSignalSlice = {
      status: 'ready',
      requestedCount: 3,
      requests: [request(oldest, 1), request(daysAgo(1), 2)],
    };
    const { getByText, container } = renderBody(slice, 'expanded');
    expect(getByText(`oldest ${formatRelativeTime(new Date(oldest))}`)).toBeInTheDocument();
    expect(container.querySelector('[data-part="oldest"]')).not.toBeNull();
  });

  it('compact: omits the oldest waiting age (fixed hero anchor)', () => {
    const slice: ReviewsSignalSlice = {
      status: 'ready',
      requestedCount: 2,
      requests: [request(daysAgo(5), 1)],
    };
    const { container } = renderBody(slice, 'compact');
    expect(container.querySelector('[data-part="oldest"]')).toBeNull();
  });

  it('omits the oldest age when no per-request data is present', () => {
    const { container } = renderBody({ status: 'ready', requestedCount: 4 }, 'standard');
    expect(container.querySelector('[data-part="oldest"]')).toBeNull();
  });

  it('ignores unparseable created_at values when computing the oldest age', () => {
    const good = daysAgo(4);
    const slice: ReviewsSignalSlice = {
      status: 'ready',
      requestedCount: 2,
      requests: [request('not-a-date', 1), request(good, 2)],
    };
    const { getByText } = renderBody(slice, 'standard');
    expect(getByText(`oldest ${formatRelativeTime(new Date(good))}`)).toBeInTheDocument();
  });
});

describe('ReviewsTileBody — actionable hero a11y (R6)', () => {
  it('wraps the hero count in an aria-live region when work awaits the viewer', () => {
    const { container } = renderBody({ status: 'ready', requestedCount: 3 });
    expect(container.querySelector('[aria-live="polite"]')).not.toBeNull();
  });

  it('omits the aria-live hero in the calm zero state', () => {
    const { container } = renderBody({ status: 'ready', requestedCount: 0 });
    expect(container.querySelector('[aria-live="polite"]')).toBeNull();
  });
});

describe('ReviewsTileBody — defensive & a11y', () => {
  it('degrades a ready slice with a missing count to the clear state (no throw)', () => {
    expect(() => renderBody({ status: 'ready' })).not.toThrow();
    const { getAllByText } = renderBody({ status: 'ready' });
    expect(getAllByText(/none awaiting your review/i).length).toBeGreaterThan(0);
  });

  it('degrades an unexpected status to a safe neutral state (no throw)', () => {
    const bogus = { status: 'frobnicated', requestedCount: 9 } as unknown as ReviewsSignalSlice;
    let result!: ReturnType<typeof renderBody>;
    expect(() => {
      result = renderBody(bogus);
    }).not.toThrow();
    expect(result.getAllByText(/n\/a/i).length).toBeGreaterThan(0);
  });

  it('clamps a negative/garbage count to a safe value (no throw)', () => {
    const bogus = { status: 'ready', requestedCount: -3 } as ReviewsSignalSlice;
    expect(() => renderBody(bogus)).not.toThrow();
    const { container } = renderBody(bogus);
    expect(container.querySelector('[data-tone="neutral"]')).not.toBeNull();
  });

  it('contains no hard-coded hex colours', () => {
    const { container } = renderBody({ status: 'ready', requestedCount: 6 });
    expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,6}/);
  });
});

describe('ReviewsTileBody — density-aware standard tier (T15)', () => {
  const oldest = daysAgo(5);
  const slice: ReviewsSignalSlice = {
    status: 'ready',
    requestedCount: 3,
    requests: [request(daysAgo(2), 1), request(oldest, 2)],
  };

  it('glanceable standard: keeps the hero but drops the oldest-age meta', () => {
    const { getByText, queryByText, container } = render(
      <ReviewsTileBody
        repo={repo}
        data={{ reviews: slice }}
        size="standard"
        density="glanceable"
      />,
    );
    expect(getByText('3 awaiting you')).toBeInTheDocument();
    expect(queryByText(`oldest ${formatRelativeTime(new Date(oldest))}`)).toBeNull();
    expect(container.querySelector('[data-part="oldest"]')).toBeNull();
  });

  it('balanced standard: keeps the oldest-age meta (unchanged)', () => {
    const { container } = render(
      <ReviewsTileBody repo={repo} data={{ reviews: slice }} size="standard" density="balanced" />,
    );
    expect(container.querySelector('[data-part="oldest"]')).not.toBeNull();
  });

  it('glanceable expanded: keeps the oldest-age meta (expanded unaffected)', () => {
    const { container } = render(
      <ReviewsTileBody
        repo={repo}
        data={{ reviews: slice }}
        size="expanded"
        density="glanceable"
      />,
    );
    expect(container.querySelector('[data-part="oldest"]')).not.toBeNull();
  });
});
