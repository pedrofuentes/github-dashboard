import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { Repo, SecuritySignalSlice } from '../../../types/fleet';
import { SecurityTileBody } from './SecurityTileBody';

const repo: Repo = {
  nameWithOwner: 'octocat/hello-world',
  owner: 'octocat',
  name: 'hello-world',
  isPrivate: false,
};

function renderBody(
  security: SecuritySignalSlice | undefined,
  size: 'compact' | 'standard' | 'expanded' = 'standard',
) {
  return render(<SecurityTileBody repo={repo} data={{ security }} size={size} />);
}

describe('SecurityTileBody — states', () => {
  it('shows a loading state with sr text', () => {
    const { getByText } = renderBody({ status: 'loading' });
    expect(getByText(/loading security/i)).toBeInTheDocument();
  });

  it('shows an error state', () => {
    const { getByText } = renderBody({ status: 'error' });
    expect(getByText(/couldn.t load security/i)).toBeInTheDocument();
  });

  it('shows n/a for an unknown slice', () => {
    const { getByText } = renderBody({ status: 'unknown' });
    expect(getByText(/n\/a/i)).toBeInTheDocument();
  });

  it('shows n/a when there is no slice at all', () => {
    const { getByText } = renderBody(undefined);
    expect(getByText(/n\/a/i)).toBeInTheDocument();
  });

  it('shows n/a — no access when ready but counts are absent', () => {
    const { getByText } = renderBody({ status: 'ready', grade: 'A' });
    expect(getByText(/n\/a/i)).toBeInTheDocument();
  });

  it('shows an all-clear positive state at grade A with no alerts (never blank)', () => {
    const { getByText } = renderBody({
      status: 'ready',
      grade: 'A',
      counts: { critical: 0, high: 0, medium: 0, low: 0 },
    });
    expect(getByText(/no open alerts/i)).toBeInTheDocument();
    expect(getByText('A')).toBeInTheDocument();
  });
});

describe('SecurityTileBody — grade → tone mapping', () => {
  const cases: Array<[NonNullable<SecuritySignalSlice['grade']>, string]> = [
    ['A', 'success'],
    ['B', 'success'],
    ['C', 'warning'],
    ['D', 'failure'],
    ['E', 'failure'],
    ['F', 'failure'],
  ];

  it.each(cases)('maps grade %s to tone %s', (grade, tone) => {
    const counts = {
      critical: grade === 'F' ? 1 : 0,
      high: 0,
      medium: 0,
      low: grade === 'B' ? 2 : 0,
    };
    const { container, getByText } = renderBody({ status: 'ready', grade, counts });
    const root = container.querySelector('[data-tone]');
    expect(root?.getAttribute('data-tone')).toBe(tone);
    // Redundant encoding: the grade letter is always present as text.
    expect(getByText(grade)).toBeInTheDocument();
  });
});

describe('SecurityTileBody — severity breakdown & truncation', () => {
  const counts = { critical: 2, high: 1, medium: 3, low: 4 };

  it('renders the severity counts in the breakdown', () => {
    const { getByText } = renderBody({ status: 'ready', grade: 'F', counts }, 'expanded');
    // The accessible severity list reports each non-zero severity.
    expect(getByText(/critical/i)).toBeInTheDocument();
    expect(getByText(/high/i)).toBeInTheDocument();
  });

  it('marks a truncated tally as a lower bound (partial)', () => {
    const { getByText, container } = renderBody({
      status: 'ready',
      grade: 'F',
      counts,
      truncated: true,
    });
    expect(getByText(/partial/i)).toBeInTheDocument();
    expect(container.textContent).toContain('≥');
  });

  it('does not show a partial indicator when not truncated', () => {
    const { queryByText } = renderBody({ status: 'ready', grade: 'F', counts });
    expect(queryByText(/partial/i)).toBeNull();
  });
});

describe('SecurityTileBody — size tiers', () => {
  const slice: SecuritySignalSlice = {
    status: 'ready',
    grade: 'F',
    counts: { critical: 2, high: 1, medium: 0, low: 0 },
  };

  it('compact: grade BigValue only, no arc gauge', () => {
    const { container, getByText } = renderBody(slice, 'compact');
    expect(getByText('F')).toBeInTheDocument();
    expect(container.querySelector('[data-part="arc-gauge"]')).toBeNull();
  });

  it('standard: renders the arc gauge with the grade hero', () => {
    const { container, getByText } = renderBody(slice, 'standard');
    expect(container.querySelector('[data-part="arc-gauge"]')).not.toBeNull();
    expect(getByText('F')).toBeInTheDocument();
  });

  it('expanded: renders the arc gauge plus the full severity breakdown', () => {
    const { container } = renderBody(slice, 'expanded');
    expect(container.querySelector('[data-part="arc-gauge"]')).not.toBeNull();
    expect(container.querySelector('[data-part="severity-bar"]')).not.toBeNull();
  });
});

describe('SecurityTileBody — theming & a11y', () => {
  it('contains no hard-coded hex colours', () => {
    const { container } = renderBody({
      status: 'ready',
      grade: 'C',
      counts: { critical: 0, high: 0, medium: 2, low: 0 },
    });
    expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,6}/);
  });

  it('derives the grade from counts when the slice omits it (reuses the grader)', () => {
    const { getByText } = renderBody({
      status: 'ready',
      counts: { critical: 1, high: 0, medium: 0, low: 0 },
    });
    expect(getByText('F')).toBeInTheDocument();
  });
});
