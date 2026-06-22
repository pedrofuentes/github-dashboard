import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AgeBucketBar } from './AgeBucketBar';

/** Pull the `h-<n>` height utility off a rendered bucket segment. */
function heightOf(el: Element): number {
  const cls = [...el.classList].find((c) => /^h-\d/.test(c));
  return cls ? Number(cls.replace('h-', '')) : Number.NaN;
}

describe('AgeBucketBar', () => {
  it('renders one segment per non-zero bucket', () => {
    const { container } = render(
      <AgeBucketBar
        buckets={[
          { label: '>14d', value: 2 },
          { label: '>30d', value: 3 },
          { label: '>60d', value: 1 },
        ]}
        srLabel="Age distribution"
      />,
    );
    expect(container.querySelectorAll('[data-bucket]')).toHaveLength(3);
  });

  it('steps segment heights so older buckets are taller (grayscale-safe)', () => {
    const { container } = render(
      <AgeBucketBar
        buckets={[
          { label: '>14d', value: 2 },
          { label: '>30d', value: 3 },
          { label: '>60d', value: 1 },
        ]}
        srLabel="Age distribution"
      />,
    );
    const segs = [...container.querySelectorAll('[data-bucket]')];
    const heights = segs.map(heightOf);
    // distinct height class per bucket — order survives grayscale
    expect(new Set(heights).size).toBe(3);
    // older (later) bucket is taller than the younger one
    expect(heights[2]).toBeGreaterThan(heights[1]);
    expect(heights[1]).toBeGreaterThan(heights[0]);
  });

  it('omits zero-value buckets entirely', () => {
    const { container } = render(
      <AgeBucketBar
        buckets={[
          { label: '>14d', value: 0 },
          { label: '>30d', value: 2 },
          { label: '>60d', value: 1 },
        ]}
        srLabel="Age distribution"
      />,
    );
    const segs = container.querySelectorAll('[data-bucket]');
    expect(segs).toHaveLength(2);
    expect(segs[0]).toHaveAttribute('data-bucket', '>30d');
    expect(segs[1]).toHaveAttribute('data-bucket', '>60d');
  });

  it('sizes each visible segment proportionally to its value', () => {
    const { container } = render(
      <AgeBucketBar
        buckets={[
          { label: '>14d', value: 1 },
          { label: '>30d', value: 3 },
        ]}
        srLabel="Age distribution"
      />,
    );
    const segs = container.querySelectorAll<HTMLElement>('[data-bucket]');
    expect(segs[0].style.width).toBe('25%');
    expect(segs[1].style.width).toBe('75%');
  });

  it('paints the fill with the ochre token only (no hard-coded hex)', () => {
    const { container } = render(
      <AgeBucketBar buckets={[{ label: '>60d', value: 1 }]} srLabel="Age distribution" />,
    );
    const seg = container.querySelector('[data-bucket]') as HTMLElement;
    expect(seg.className).toContain('bg-accent-ochre');
    expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,6}/);
  });

  it('exposes a screen-reader list of each bucket and count plus the summary label', () => {
    render(
      <AgeBucketBar
        buckets={[
          { label: '>14d', value: 2 },
          { label: '>30d', value: 0 },
          { label: '>60d', value: 1 },
        ]}
        srLabel="3 stale items by age"
      />,
    );
    expect(screen.getByText('3 stale items by age')).toBeInTheDocument();
    expect(screen.getByText('>14d: 2')).toBeInTheDocument();
    expect(screen.getByText('>60d: 1')).toBeInTheDocument();
    // zero buckets are not listed
    expect(screen.queryByText('>30d: 0')).toBeNull();
  });

  it('renders nothing visible but stays safe when every bucket is zero', () => {
    const { container } = render(
      <AgeBucketBar buckets={[{ label: '>14d', value: 0 }]} srLabel="No stale items" />,
    );
    expect(container.querySelectorAll('[data-bucket]')).toHaveLength(0);
  });

  it('marks the coloured bar decorative (aria-hidden) so meaning rests on the sr-only list', () => {
    const { container } = render(
      <AgeBucketBar buckets={[{ label: '>60d', value: 1 }]} srLabel="Age distribution" />,
    );
    const seg = container.querySelector('[data-bucket]') as HTMLElement;
    // every visible segment lives inside an aria-hidden subtree
    expect(seg.closest('[aria-hidden="true"]')).not.toBeNull();
    // the textual channel is NOT hidden
    const list = container.querySelector('.sr-only');
    expect(list?.closest('[aria-hidden="true"]')).toBeNull();
  });
});
