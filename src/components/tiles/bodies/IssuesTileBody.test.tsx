import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { IssuesSignalSlice, Repo } from '../../../types/fleet';
import { IssuesTileBody } from './IssuesTileBody';

const repo: Repo = {
  nameWithOwner: 'octocat/hello-world',
  owner: 'octocat',
  name: 'hello-world',
  isPrivate: false,
};

function renderBody(
  issues: IssuesSignalSlice | undefined,
  size: 'compact' | 'standard' | 'expanded' = 'standard',
) {
  return render(<IssuesTileBody repo={repo} data={{ issues }} size={size} />);
}

describe('IssuesTileBody — states', () => {
  it('shows a loading state with sr text', () => {
    const { getAllByText } = renderBody({ status: 'loading' });
    expect(getAllByText(/loading issues/i).length).toBeGreaterThan(0);
  });

  it('shows an error state', () => {
    const { getAllByText } = renderBody({ status: 'error' });
    expect(getAllByText(/issue count unavailable/i).length).toBeGreaterThan(0);
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
    const { getAllByText, container } = renderBody({ status: 'ready', openCount: 0 });
    expect(getAllByText(/no open issues/i).length).toBeGreaterThan(0);
    expect(container.querySelector('[data-tone="neutral"]')).not.toBeNull();
  });
});

describe('IssuesTileBody — triage escalation (DESIGN-TILES §4.5)', () => {
  it('renders an open count with the neutral tone by default', () => {
    const { getByText, container } = renderBody({ status: 'ready', openCount: 7 });
    expect(getByText('7')).toBeInTheDocument();
    expect(container.querySelector('[data-tone="neutral"]')).not.toBeNull();
  });

  it('escalates to warning with a triage glyph + text when over threshold', () => {
    const { getByText, getAllByText, container } = renderBody({
      status: 'ready',
      openCount: 42,
      overThreshold: true,
    });
    expect(getByText('42')).toBeInTheDocument();
    expect(container.querySelector('[data-tone="warning"]')).not.toBeNull();
    expect(getAllByText(/over triage threshold/i).length).toBeGreaterThan(0);
  });

  it('reports the over-threshold sr label from the cell vocabulary', () => {
    const { getAllByText } = renderBody(
      { status: 'ready', openCount: 9, overThreshold: true },
      'expanded',
    );
    expect(getAllByText(/9 open issues, over the triage threshold/i).length).toBeGreaterThan(0);
  });

  it('uses singular "issue" phrasing for a single open issue', () => {
    const { getAllByText } = renderBody({ status: 'ready', openCount: 1 }, 'expanded');
    expect(getAllByText(/1 open issue\b/i).length).toBeGreaterThan(0);
  });
});

describe('IssuesTileBody — size tiers', () => {
  const slice: IssuesSignalSlice = { status: 'ready', openCount: 5 };

  it('compact: shows the value with a minimal label', () => {
    const { getByText, container } = renderBody(slice, 'compact');
    expect(getByText('5')).toBeInTheDocument();
    expect(container.querySelector('[data-tier="compact"]')).not.toBeNull();
  });

  it('standard: shows the value and the "open" word', () => {
    const { getByText, getAllByText } = renderBody(slice, 'standard');
    expect(getByText('5')).toBeInTheDocument();
    expect(getAllByText(/open/i).length).toBeGreaterThan(0);
  });

  it('expanded: adds the descriptive line', () => {
    const { container } = renderBody(slice, 'expanded');
    expect(container.querySelector('[data-part="detail"]')).not.toBeNull();
  });
});

describe('IssuesTileBody — defensive & a11y', () => {
  it('degrades a ready slice with a missing count to the clear state (no throw)', () => {
    expect(() => renderBody({ status: 'ready' })).not.toThrow();
    const { getAllByText } = renderBody({ status: 'ready' });
    expect(getAllByText(/no open issues/i).length).toBeGreaterThan(0);
  });

  it('degrades an unexpected status to a safe neutral state (no throw)', () => {
    const bogus = { status: 'frobnicated', openCount: 9 } as unknown as IssuesSignalSlice;
    let result!: ReturnType<typeof renderBody>;
    expect(() => {
      result = renderBody(bogus);
    }).not.toThrow();
    expect(result.getAllByText(/n\/a/i).length).toBeGreaterThan(0);
  });

  it('clamps a negative/garbage count to a safe value (no throw)', () => {
    const bogus = { status: 'ready', openCount: -8 } as IssuesSignalSlice;
    expect(() => renderBody(bogus)).not.toThrow();
    const { container } = renderBody(bogus);
    expect(container.querySelector('[data-tone="neutral"]')).not.toBeNull();
  });

  it('contains no hard-coded hex colours', () => {
    const { container } = renderBody({ status: 'ready', openCount: 11, overThreshold: true });
    expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,6}/);
  });
});
