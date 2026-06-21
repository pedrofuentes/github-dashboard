import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { STALE_THRESHOLD_DAYS } from '../../../hooks/signals/useStaleSignal';
import type { Repo, StaleSignalSlice } from '../../../types/fleet';
import { StaleTileBody } from './StaleTileBody';

const repo: Repo = {
  nameWithOwner: 'octocat/hello-world',
  owner: 'octocat',
  name: 'hello-world',
  isPrivate: false,
};

function renderBody(
  stale: StaleSignalSlice | undefined,
  size: 'compact' | 'standard' | 'expanded' = 'standard',
) {
  return render(<StaleTileBody repo={repo} data={{ stale }} size={size} />);
}

describe('StaleTileBody — states', () => {
  it('shows a loading state with sr text', () => {
    const { getAllByText } = renderBody({ status: 'loading' });
    expect(getAllByText(/loading stale/i).length).toBeGreaterThan(0);
  });

  it('shows an error state', () => {
    const { getAllByText } = renderBody({ status: 'error' });
    expect(getAllByText(/stale activity unavailable/i).length).toBeGreaterThan(0);
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
    const { getAllByText, container } = renderBody({ status: 'ready', staleCount: 0 });
    expect(getAllByText(/nothing stale/i).length).toBeGreaterThan(0);
    expect(container.querySelector('[data-tone="neutral"]')).not.toBeNull();
  });
});

describe('StaleTileBody — staleness escalation (DESIGN-TILES §4.6)', () => {
  it('escalates to warning when there are stale items', () => {
    const { getByText, container } = renderBody({ status: 'ready', staleCount: 6 });
    expect(getByText('6')).toBeInTheDocument();
    expect(container.querySelector('[data-tone="warning"]')).not.toBeNull();
  });

  it('renders the "N stale" chip when > 0', () => {
    const { getAllByText } = renderBody({ status: 'ready', staleCount: 6 });
    expect(getAllByText(/6 stale/i).length).toBeGreaterThan(0);
  });

  it('spells out the staleness duration using the shared threshold', () => {
    const { getAllByText } = renderBody({ status: 'ready', staleCount: 6 }, 'expanded');
    expect(
      getAllByText(new RegExp(`no activity in ${STALE_THRESHOLD_DAYS} days`, 'i')).length,
    ).toBeGreaterThan(0);
  });

  it('uses singular "item" phrasing for a single stale item', () => {
    const { getAllByText } = renderBody({ status: 'ready', staleCount: 1 }, 'expanded');
    expect(getAllByText(/1 open item with no activity/i).length).toBeGreaterThan(0);
  });
});

describe('StaleTileBody — size tiers', () => {
  const slice: StaleSignalSlice = { status: 'ready', staleCount: 3 };

  it('compact: shows the value with a minimal label', () => {
    const { getByText, container } = renderBody(slice, 'compact');
    expect(getByText('3')).toBeInTheDocument();
    expect(container.querySelector('[data-tier="compact"]')).not.toBeNull();
  });

  it('standard: shows the value and the "stale" chip', () => {
    const { getByText, getAllByText } = renderBody(slice, 'standard');
    expect(getByText('3')).toBeInTheDocument();
    expect(getAllByText(/3 stale/i).length).toBeGreaterThan(0);
  });

  it('expanded: adds the descriptive line', () => {
    const { container } = renderBody(slice, 'expanded');
    expect(container.querySelector('[data-part="detail"]')).not.toBeNull();
  });
});

describe('StaleTileBody — defensive & a11y', () => {
  it('degrades a ready slice with a missing count to the clear state (no throw)', () => {
    expect(() => renderBody({ status: 'ready' })).not.toThrow();
    const { getAllByText } = renderBody({ status: 'ready' });
    expect(getAllByText(/nothing stale/i).length).toBeGreaterThan(0);
  });

  it('degrades an unexpected status to a safe neutral state (no throw)', () => {
    const bogus = { status: 'frobnicated', staleCount: 9 } as unknown as StaleSignalSlice;
    let result!: ReturnType<typeof renderBody>;
    expect(() => {
      result = renderBody(bogus);
    }).not.toThrow();
    expect(result.getAllByText(/n\/a/i).length).toBeGreaterThan(0);
  });

  it('clamps a negative/garbage count to a safe value (no throw)', () => {
    const bogus = { status: 'ready', staleCount: -4 } as StaleSignalSlice;
    expect(() => renderBody(bogus)).not.toThrow();
    const { container } = renderBody(bogus);
    expect(container.querySelector('[data-tone="neutral"]')).not.toBeNull();
  });

  it('contains no hard-coded hex colours', () => {
    const { container } = renderBody({ status: 'ready', staleCount: 8 });
    expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,6}/);
  });
});
