import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { Repo, ReviewsSignalSlice } from '../../../types/fleet';
import { ReviewsTileBody } from './ReviewsTileBody';

const repo: Repo = {
  nameWithOwner: 'octocat/hello-world',
  owner: 'octocat',
  name: 'hello-world',
  isPrivate: false,
};

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
