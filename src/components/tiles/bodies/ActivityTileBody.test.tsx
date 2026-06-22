import { render, screen, within } from '@testing-library/react';
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
  it('routes loading through TileMessage (data-state="loading", reduced-motion-safe glyph)', () => {
    const { container } = renderBody({ state: 'loading' });
    expect(container.querySelector('[data-state="loading"]')).not.toBeNull();
    expect(screen.getAllByText(/loading/i).length).toBeGreaterThan(0);
    const spinner = container.querySelector('svg[data-status="loading"]');
    expect(spinner?.getAttribute('class')).toContain('motion-reduce:animate-none');
  });

  it('renders a computing message', () => {
    renderBody({ state: 'computing' });
    expect(screen.getByText(/computing/i)).toBeInTheDocument();
  });

  it('routes empty through TileMessage all-clear (data-state="empty")', () => {
    const { container } = renderBody({ state: 'empty' });
    expect(container.querySelector('[data-state="empty"]')).not.toBeNull();
    expect(screen.getAllByText(/no recent commit activity/i).length).toBeGreaterThan(0);
    expect(container.querySelector('svg[data-status="success"]')).not.toBeNull();
  });

  it('routes error through TileMessage (data-state="failed-to-load") and never throws', () => {
    const { container } = renderBody({ state: 'error', error: new Error('x') });
    expect(container.querySelector('[data-state="failed-to-load"]')).not.toBeNull();
    expect(container.querySelector('svg[data-status="warning"]')).not.toBeNull();
    expect(container.querySelector('.sr-only')?.textContent).toMatch(
      /couldn.t load commit activity/i,
    );
  });

  it('HARD RULE: empty all-clear is unmistakable from failed-to-load', () => {
    const { container: empty } = renderBody({ state: 'empty' });
    const { container: failed } = renderBody({ state: 'error', error: new Error('x') });
    expect(empty.querySelector('[data-state="empty"]')).not.toBeNull();
    expect(failed.querySelector('[data-state="failed-to-load"]')).not.toBeNull();
    expect(empty.querySelector('svg[data-status="success"]')).not.toBeNull();
    expect(failed.querySelector('svg[data-status="warning"]')).not.toBeNull();
  });
});

describe('ActivityTileBody — ok state (commits-this-week hero + delta)', () => {
  // Sum (23) differs from this-week (13) so the hero can never be the all-weeks
  // total by accident; last=13, prev=10 → ▲3.
  const weeks: CommitActivityWeek[] = [
    week(10, [2, 2, 2, 2, 2, 0, 0]),
    week(13, [3, 2, 2, 2, 2, 1, 1]),
  ];

  it('uses commits THIS week (last week total) as the hero, not the all-weeks sum', () => {
    renderBody({ state: 'ok', weeks }, 'standard');
    expect(screen.getByText('13')).toBeInTheDocument();
    // 23 is the all-weeks sum — it must NOT be the hero.
    expect(screen.queryByText('23')).toBeNull();
  });

  it('renders a ▲/▼ delta vs last week from formatDelta', () => {
    renderBody({ state: 'ok', weeks }, 'standard');
    expect(screen.getByText('▲3')).toBeInTheDocument();
  });

  it('renders a ▼ delta when this week is below last week', () => {
    const falling: CommitActivityWeek[] = [
      week(13, [3, 2, 2, 2, 2, 1, 1]),
      week(8, [2, 2, 2, 2, 0, 0, 0]),
    ];
    renderBody({ state: 'ok', weeks: falling }, 'standard');
    expect(screen.getByText('8')).toBeInTheDocument();
    expect(screen.getByText('▼5')).toBeInTheDocument();
  });

  it('shows an em-dash delta when only a single week of data exists', () => {
    renderBody({ state: 'ok', weeks: [week(7, [1, 1, 1, 1, 1, 1, 1])] }, 'standard');
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('announces the hero count from a body-owned aria-live region (R1)', () => {
    const { container } = renderBody({ state: 'ok', weeks }, 'standard');
    const live = container.querySelector('[aria-live="polite"]');
    expect(live).toBeTruthy();
    expect(within(live as HTMLElement).getByText('13')).toBeInTheDocument();
  });

  it('carries a redundant sr-only sentence with commits-this-week + delta', () => {
    renderBody({ state: 'ok', weeks }, 'standard');
    expect(
      screen.getByText(/13 commits this week in octo\/a.*more than last week/i),
    ).toBeInTheDocument();
  });

  it('exposes data-state, data-tone (purple identity) and data-tier attributes', () => {
    const { container } = renderBody({ state: 'ok', weeks }, 'standard');
    const root = container.querySelector('[data-state="ready"]');
    expect(root).toBeTruthy();
    expect(root?.getAttribute('data-tone')).toBe('purple');
    expect(root?.getAttribute('data-tier')).toBe('standard');
  });

  it('at compact size shows the hero + delta but NEITHER sparkline NOR heatmap', () => {
    const { container } = renderBody({ state: 'ok', weeks }, 'compact');
    expect(screen.getByText('13')).toBeInTheDocument();
    expect(screen.getByText('▲3')).toBeInTheDocument();
    expect(screen.queryByRole('img')).toBeNull();
    expect(container.querySelector('[data-heatmap-cell]')).toBeNull();
  });

  it('at standard size adds the sparkline but not the heatmap', () => {
    const { container } = renderBody({ state: 'ok', weeks }, 'standard');
    expect(screen.getByRole('img', { name: /commits over/i })).toBeInTheDocument();
    expect(container.querySelector('[data-heatmap-cell]')).toBeNull();
  });

  it('at expanded size also renders the heatmap', () => {
    const { container } = renderBody({ state: 'ok', weeks }, 'expanded');
    expect(container.querySelector('[data-heatmap-cell]')).toBeTruthy();
    expect(screen.getAllByRole('img').length).toBeGreaterThanOrEqual(2);
  });

  it('paints the sparkline ink with the purple identity token (R2)', () => {
    const { container } = renderBody({ state: 'ok', weeks }, 'standard');
    const line = container.querySelector('[data-part="line"]');
    expect(line?.getAttribute('stroke')).toBe('var(--color-purple)');
  });

  it('paints non-empty heatmap cells with the purple identity token (R2)', () => {
    const { container } = renderBody({ state: 'ok', weeks }, 'expanded');
    const activeCell = Array.from(
      container.querySelectorAll<SVGRectElement>('[data-heatmap-cell]'),
    ).find((cell) => Number(cell.getAttribute('data-count')) > 0);
    expect(activeCell?.getAttribute('fill')).toBe('var(--color-purple)');
  });

  it('passes the repo through to the data hook', () => {
    renderBody({ state: 'ok', weeks });
    expect(mockUse).toHaveBeenCalledWith(repo);
  });
});

describe('ActivityTileBody — density-aware standard tier (T15)', () => {
  const weeks: CommitActivityWeek[] = [
    week(10, [2, 2, 2, 2, 2, 0, 0]),
    week(13, [3, 2, 2, 2, 2, 1, 1]),
  ];

  it('glanceable standard: keeps the hero + delta but drops the sparkline', () => {
    mockUse.mockReturnValue({ state: 'ok', weeks });
    render(<ActivityTileBody repo={repo} size="standard" density="glanceable" />);
    expect(screen.getByText('13')).toBeInTheDocument();
    expect(screen.getByText('▲3')).toBeInTheDocument();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('balanced standard: keeps the sparkline (unchanged)', () => {
    mockUse.mockReturnValue({ state: 'ok', weeks });
    render(<ActivityTileBody repo={repo} size="standard" density="balanced" />);
    expect(screen.getByRole('img', { name: /commits over/i })).toBeInTheDocument();
  });

  it('glanceable expanded: keeps the sparkline (expanded unaffected)', () => {
    mockUse.mockReturnValue({ state: 'ok', weeks });
    render(<ActivityTileBody repo={repo} size="expanded" density="glanceable" />);
    // The sparkline label leads with the count; the heatmap label leads with
    // "Commit activity heatmap" — match only the sparkline.
    expect(screen.getByRole('img', { name: /^\d+ commits over/i })).toBeInTheDocument();
  });
});
