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
  it('shows a loading state via TileMessage (data-state="loading") with sr text', () => {
    const { getAllByText, container } = renderBody({ status: 'loading' });
    expect(container.querySelector('[data-state="loading"]')).not.toBeNull();
    expect(getAllByText(/loading security/i).length).toBeGreaterThan(0);
  });

  it('shows a failed-to-load state via TileMessage (data-state="failed-to-load")', () => {
    const { getAllByText, container } = renderBody({ status: 'error' });
    expect(container.querySelector('[data-state="failed-to-load"]')).not.toBeNull();
    expect(getAllByText(/couldn.t load security/i).length).toBeGreaterThan(0);
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

  it('shows an all-clear positive state with no alerts (never blank, never an alarm)', () => {
    const { getAllByText, container } = renderBody({
      status: 'ready',
      grade: 'A',
      counts: { critical: 0, high: 0, medium: 0, low: 0 },
    });
    expect(getAllByText(/all clear/i).length).toBeGreaterThan(0);
    expect(getAllByText(/no open alerts/i).length).toBeGreaterThan(0);
    // All-clear routes through the shared TileMessage: a calm success glyph +
    // data-state="empty" (NOT a problem hero, no live region).
    expect(container.querySelector('[data-state="empty"]')).not.toBeNull();
    expect(container.querySelector('svg[data-status="success"]')).not.toBeNull();
    expect(container.querySelector('[aria-live="polite"]')).toBeNull();
  });

  it('HARD RULE: all-clear (empty) is unmistakable from failed-to-load', () => {
    const { container: clear } = renderBody({
      status: 'ready',
      grade: 'A',
      counts: { critical: 0, high: 0, medium: 0, low: 0 },
    });
    const { container: failed } = renderBody({ status: 'error' });
    expect(clear.querySelector('[data-state="empty"]')).not.toBeNull();
    expect(failed.querySelector('[data-state="failed-to-load"]')).not.toBeNull();
    expect(clear.querySelector('svg[data-status="success"]')).not.toBeNull();
    expect(failed.querySelector('svg[data-status="warning"]')).not.toBeNull();
  });
});

describe('SecurityTileBody — severity-led hero', () => {
  it('leads with the critical count when critical alerts exist', () => {
    const { getByText, container } = renderBody({
      status: 'ready',
      grade: 'F',
      counts: { critical: 2, high: 5, medium: 3, low: 1 },
    });
    const label = getByText('Critical');
    expect(label).toBeInTheDocument();
    expect(label.className).toContain('text-accent-failure');
    // The critical count is the hero number.
    expect(getByText('2')).toBeInTheDocument();
    expect(container.querySelector('[data-tone="failure"]')).not.toBeNull();
  });

  it('leads with the worst present severity (High) tinted with the coral INK token (AA)', () => {
    const { getByText, container } = renderBody({
      status: 'ready',
      grade: 'D',
      counts: { critical: 0, high: 5, medium: 0, low: 0 },
    });
    const label = getByText('High');
    expect(label).toBeInTheDocument();
    // R5: severity TEXT uses the ink token, never the coral fill token.
    expect(label.className).toContain('text-accent-coral-ink');
    expect(label.className).not.toMatch(/text-accent-coral(?![-\w])/);
    expect(getByText('5')).toBeInTheDocument();
    expect(container.querySelector('[data-tone="coral"]')).not.toBeNull();
  });

  it('demotes the total to a sub-line (e.g. "11 total")', () => {
    const { getByText } = renderBody({
      status: 'ready',
      grade: 'F',
      counts: { critical: 2, high: 5, medium: 3, low: 1 },
    });
    expect(getByText('11 total')).toBeInTheDocument();
  });

  it('announces problem heroes via an aria-live region but leaves calm low-only tiles silent', () => {
    const problem = renderBody({
      status: 'ready',
      grade: 'F',
      counts: { critical: 1, high: 0, medium: 0, low: 0 },
    });
    expect(problem.container.querySelector('[aria-live="polite"]')).not.toBeNull();

    const calm = renderBody({
      status: 'ready',
      grade: 'B',
      counts: { critical: 0, high: 0, medium: 0, low: 3 },
    });
    expect(calm.container.querySelector('[aria-live="polite"]')).toBeNull();
    expect(calm.getByText('Low')).toBeInTheDocument();
  });
});

describe('SecurityTileBody — severity → tone mapping', () => {
  const cases: Array<[Partial<Record<'critical' | 'high' | 'medium' | 'low', number>>, string]> = [
    [{ critical: 1 }, 'failure'],
    [{ high: 2 }, 'coral'],
    [{ medium: 4 }, 'info'],
    [{ low: 3 }, 'neutral'],
  ];

  it.each(cases)('maps worst severity %o to body tone %s', (partial, tone) => {
    const counts = { critical: 0, high: 0, medium: 0, low: 0, ...partial };
    const { container } = renderBody({ status: 'ready', counts });
    const root = container.querySelector('[data-tone]');
    expect(root?.getAttribute('data-tone')).toBe(tone);
  });
});

describe('SecurityTileBody — stacked severity bar (no arc gauge)', () => {
  const slice: SecuritySignalSlice = {
    status: 'ready',
    grade: 'F',
    counts: { critical: 2, high: 1, medium: 0, low: 0 },
  };

  it('never renders an arc gauge at any tier', () => {
    for (const size of ['compact', 'standard', 'expanded'] as const) {
      const { container } = renderBody(slice, size);
      expect(container.querySelector('[data-part="arc-gauge"]')).toBeNull();
      expect(container.querySelector('[data-part="arc"]')).toBeNull();
    }
  });

  it('compact: hero severity + total only, no severity bar', () => {
    const { getByText, container } = renderBody(slice, 'compact');
    expect(getByText('Critical')).toBeInTheDocument();
    expect(container.querySelector('[data-part="severity-bar"]')).toBeNull();
  });

  it('standard: renders the stacked severity bar plus the hero', () => {
    const { getByText, container } = renderBody(slice, 'standard');
    expect(getByText('Critical')).toBeInTheDocument();
    expect(container.querySelector('[data-part="severity-bar"]')).not.toBeNull();
  });

  it('expanded: renders the severity bar plus the per-severity breakdown', () => {
    const { container } = renderBody(slice, 'expanded');
    expect(container.querySelector('[data-part="severity-bar"]')).not.toBeNull();
    expect(container.querySelector('[data-part="breakdown"]')).not.toBeNull();
  });
});

describe('SecurityTileBody — severity breakdown & truncation', () => {
  const counts = { critical: 2, high: 1, medium: 3, low: 4 };

  it('renders each non-zero severity in the breakdown', () => {
    const { getAllByText } = renderBody({ status: 'ready', grade: 'F', counts }, 'expanded');
    expect(getAllByText(/critical/i).length).toBeGreaterThan(0);
    expect(getAllByText(/high/i).length).toBeGreaterThan(0);
  });

  it('marks a truncated tally as a lower bound (partial)', () => {
    const { getAllByText, container } = renderBody({
      status: 'ready',
      grade: 'F',
      counts,
      truncated: true,
    });
    expect(getAllByText(/partial/i).length).toBeGreaterThan(0);
    expect(container.textContent).toContain('≥');
  });

  it('does not show a partial indicator when not truncated', () => {
    const { queryByText } = renderBody({ status: 'ready', grade: 'F', counts });
    expect(queryByText(/partial/i)).toBeNull();
  });
});

describe('SecurityTileBody — recency meta', () => {
  it('shows the most-recent-alert recency when alerts are present', () => {
    const newest = new Date().toISOString();
    const older = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    const { container } = renderBody({
      status: 'ready',
      grade: 'F',
      counts: { critical: 1, high: 0, medium: 0, low: 0 },
      alerts: [
        { number: 1, type: 'dependabot', severity: 'critical', html_url: '#', created_at: older },
        { number: 2, type: 'dependabot', severity: 'critical', html_url: '#', created_at: newest },
      ],
    });
    // Newest alert is "just now"; the meta surfaces that recency.
    expect(container.textContent).toMatch(/just now/i);
  });

  it('omits recency on a slice without alert rows', () => {
    const { queryByText } = renderBody({
      status: 'ready',
      grade: 'F',
      counts: { critical: 1, high: 0, medium: 0, low: 0 },
    });
    expect(queryByText(/ago|just now/i)).toBeNull();
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

  it('leads with the worst severity even when the slice omits the grade', () => {
    const { getByText } = renderBody({
      status: 'ready',
      counts: { critical: 1, high: 0, medium: 0, low: 0 },
    });
    expect(getByText('Critical')).toBeInTheDocument();
  });
});

describe('SecurityTileBody — density-aware standard tier (T15)', () => {
  const slice: SecuritySignalSlice = {
    status: 'ready',
    grade: 'F',
    counts: { critical: 2, high: 1, medium: 0, low: 0 },
  };

  it('glanceable standard: keeps the hero but drops the severity bar + meta', () => {
    const { getByText, container } = render(
      <SecurityTileBody
        repo={repo}
        data={{ security: slice }}
        size="standard"
        density="glanceable"
      />,
    );
    expect(getByText('Critical')).toBeInTheDocument();
    expect(container.querySelector('[data-part="severity-bar"]')).toBeNull();
    expect(container.querySelector('[data-part="meta"]')).toBeNull();
  });

  it('balanced standard: keeps the severity bar (unchanged)', () => {
    const { container } = render(
      <SecurityTileBody
        repo={repo}
        data={{ security: slice }}
        size="standard"
        density="balanced"
      />,
    );
    expect(container.querySelector('[data-part="severity-bar"]')).not.toBeNull();
  });

  it('glanceable expanded: keeps the severity bar (expanded unaffected)', () => {
    const { container } = render(
      <SecurityTileBody
        repo={repo}
        data={{ security: slice }}
        size="expanded"
        density="glanceable"
      />,
    );
    expect(container.querySelector('[data-part="severity-bar"]')).not.toBeNull();
  });
});
