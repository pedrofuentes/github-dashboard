import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { Repo, StaleItem, StaleSignalSlice } from '../../../types/fleet';
import { StaleTileBody } from './StaleTileBody';

const repo: Repo = {
  nameWithOwner: 'octocat/hello-world',
  owner: 'octocat',
  name: 'hello-world',
  isPrivate: false,
};

const NOW = new Date('2026-06-21T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

/** ISO timestamp `n` whole days before {@link NOW} (UTC, DST-safe). */
function daysAgo(n: number): string {
  return new Date(NOW.getTime() - n * DAY).toISOString();
}

function item(type: 'pr' | 'issue', ageDays: number, number = ageDays): StaleItem {
  return {
    number,
    title: `item ${String(number)}`,
    html_url: `https://github.com/octocat/hello-world/issues/${String(number)}`,
    updated_at: daysAgo(ageDays),
    type,
  };
}

function renderBody(
  stale: StaleSignalSlice | undefined,
  size: 'compact' | 'standard' | 'expanded' = 'standard',
  now: Date = NOW,
) {
  return render(<StaleTileBody repo={repo} data={{ stale }} size={size} now={now} />);
}

describe('StaleTileBody — states', () => {
  it('routes loading through TileMessage (data-state="loading") with sr text', () => {
    const { getAllByText, container } = renderBody({ status: 'loading' });
    expect(container.querySelector('[data-state="loading"]')).not.toBeNull();
    expect(getAllByText(/loading stale/i).length).toBeGreaterThan(0);
  });

  it('routes errors through TileMessage (data-state="failed-to-load")', () => {
    const { getAllByText, container } = renderBody({ status: 'error' });
    expect(container.querySelector('[data-state="failed-to-load"]')).not.toBeNull();
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

  it('routes a zero-count ready slice through TileMessage all-clear (data-state="empty")', () => {
    const { getAllByText, container } = renderBody({ status: 'ready', staleCount: 0 });
    expect(container.querySelector('[data-state="empty"]')).not.toBeNull();
    expect(getAllByText(/all clear/i).length).toBeGreaterThan(0);
    expect(container.querySelector('.sr-only')?.textContent).toMatch(
      /no stale open pull requests/i,
    );
  });

  it('HARD RULE: all-clear (empty) is unmistakable from failed-to-load', () => {
    const { container: clear } = renderBody({ status: 'ready', staleCount: 0 });
    const { container: failed } = renderBody({ status: 'error' });
    expect(clear.querySelector('[data-state="empty"]')).not.toBeNull();
    expect(failed.querySelector('[data-state="failed-to-load"]')).not.toBeNull();
    expect(clear.querySelector('svg[data-status="success"]')).not.toBeNull();
    expect(failed.querySelector('svg[data-status="warning"]')).not.toBeNull();
  });
});

describe('StaleTileBody — age-led hero (redesign T12)', () => {
  const slice: StaleSignalSlice = {
    status: 'ready',
    staleCount: 5,
    staleItems: [
      item('pr', 34),
      item('pr', 18),
      item('pr', 16),
      item('issue', 65),
      item('issue', 40),
    ],
  };

  it('leads with the OLDEST item age as the hero, not the count', () => {
    const { getByText, queryByText } = renderBody(slice, 'standard');
    expect(getByText('65d')).toBeInTheDocument();
    // the count is NOT the hero number
    expect(queryByText('5')).toBeNull();
  });

  it('uses the ochre identity tone, not warning', () => {
    const { container } = renderBody(slice, 'standard');
    expect(container.querySelector('[data-tone="ochre"]')).not.toBeNull();
    expect(container.querySelector('[data-tone="warning"]')).toBeNull();
  });

  it('shows the count + PR/issue type split in the meta line', () => {
    const { getByText } = renderBody(slice, 'standard');
    expect(getByText(/5 items \(3 PR · 2 issue\)/)).toBeInTheDocument();
  });

  it('does not announce the calm hero with aria-live', () => {
    const { container } = renderBody(slice, 'standard');
    expect(container.querySelector('[aria-live]')).toBeNull();
  });

  it('respects an injected now so age is deterministic', () => {
    const later = new Date(NOW.getTime() + 10 * DAY);
    const { getByText } = renderBody(slice, 'standard', later);
    // oldest item was 65d before NOW → 75d before `later`
    expect(getByText('75d')).toBeInTheDocument();
  });

  it('uses the singular noun when exactly one item is stale', () => {
    const singular: StaleSignalSlice = {
      status: 'ready',
      staleCount: 1,
      staleItems: [item('pr', 12)],
    };
    const { getByText, container } = renderBody(singular, 'standard');
    // meta line: singular "item", not "items"
    expect(getByText(/1 item \(1 PR · 0 issue\)/)).toBeInTheDocument();
    // sr sentence also reads singular "stale item"
    const srTexts = [...container.querySelectorAll('.sr-only')].map((n) => n.textContent ?? '');
    expect(srTexts.some((t) => /1 stale item,/i.test(t) && /oldest 12 days/i.test(t))).toBe(true);
  });
});

describe('StaleTileBody — size tiers', () => {
  const slice: StaleSignalSlice = {
    status: 'ready',
    staleCount: 4,
    staleItems: [item('pr', 70), item('pr', 45), item('issue', 33), item('issue', 20)],
  };

  it('compact: shows the oldest-age hero without the age-bucket bar', () => {
    const { getByText, container } = renderBody(slice, 'compact');
    expect(getByText('70d')).toBeInTheDocument();
    expect(container.querySelector('[data-tier="compact"]')).not.toBeNull();
    expect(container.querySelector('[data-part="age-bucket-bar"]')).toBeNull();
  });

  it('standard: adds the AgeBucketBar micro-viz', () => {
    const { container } = renderBody(slice, 'standard');
    expect(container.querySelector('[data-part="age-bucket-bar"]')).not.toBeNull();
    // grayscale-safe height channel survives: each bucket carries an h-* class
    const bucket = container.querySelector('[data-bucket]');
    expect(bucket?.className).toMatch(/\bh-\d/);
  });

  it('expanded: adds the type breakdown', () => {
    const { container } = renderBody(slice, 'expanded');
    expect(container.querySelector('[data-part="age-bucket-bar"]')).not.toBeNull();
    expect(container.querySelector('[data-part="breakdown"]')).not.toBeNull();
  });
});

describe('StaleTileBody — defensive & a11y', () => {
  it('degrades a ready slice with a missing count to the clear state (no throw)', () => {
    expect(() => renderBody({ status: 'ready' })).not.toThrow();
    const { container } = renderBody({ status: 'ready' });
    expect(container.querySelector('[data-state="empty"]')).not.toBeNull();
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
    expect(container.querySelector('[data-state="empty"]')).not.toBeNull();
  });

  it('stays safe when a positive count carries no item details (no throw)', () => {
    expect(() => renderBody({ status: 'ready', staleCount: 6 })).not.toThrow();
    const { container } = renderBody({ status: 'ready', staleCount: 6 });
    expect(container.querySelector('[data-tone="ochre"]')).not.toBeNull();
  });

  it('exposes a redundant screen-reader sentence naming the count and oldest age', () => {
    const slice: StaleSignalSlice = {
      status: 'ready',
      staleCount: 2,
      staleItems: [item('pr', 50), item('issue', 22)],
    };
    const { container } = renderBody(slice, 'standard');
    const srTexts = [...container.querySelectorAll('.sr-only')].map((n) => n.textContent ?? '');
    expect(srTexts.some((t) => /2 stale items/i.test(t) && /oldest 50 days/i.test(t))).toBe(true);
  });

  it('contains no hard-coded hex colours', () => {
    const slice: StaleSignalSlice = {
      status: 'ready',
      staleCount: 3,
      staleItems: [item('pr', 80), item('issue', 35), item('issue', 19)],
    };
    const { container } = renderBody(slice, 'expanded');
    expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,6}/);
  });
});

describe('StaleTileBody — density-aware standard tier (T15)', () => {
  const slice: StaleSignalSlice = {
    status: 'ready',
    staleCount: 3,
    staleItems: [item('pr', 20), item('issue', 40), item('issue', 70)],
  };

  it('glanceable standard: keeps the hero but drops the age-bucket bar', () => {
    const { getByText, container } = render(
      <StaleTileBody
        repo={repo}
        data={{ stale: slice }}
        size="standard"
        now={NOW}
        density="glanceable"
      />,
    );
    expect(getByText('70d')).toBeInTheDocument();
    expect(container.querySelector('[data-part="age-bucket-bar"]')).toBeNull();
  });

  it('balanced standard: keeps the age-bucket bar (unchanged)', () => {
    const { container } = render(
      <StaleTileBody
        repo={repo}
        data={{ stale: slice }}
        size="standard"
        now={NOW}
        density="balanced"
      />,
    );
    expect(container.querySelector('[data-part="age-bucket-bar"]')).not.toBeNull();
  });

  it('glanceable expanded: keeps the age-bucket bar (expanded unaffected)', () => {
    const { container } = render(
      <StaleTileBody
        repo={repo}
        data={{ stale: slice }}
        size="expanded"
        now={NOW}
        density="glanceable"
      />,
    );
    expect(container.querySelector('[data-part="age-bucket-bar"]')).not.toBeNull();
  });
});
