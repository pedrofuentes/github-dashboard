import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Sparkline } from './Sparkline';

/** Collects every numeric token from the geometry attributes of the SVG. */
function geometryNumbers(container: HTMLElement): number[] {
  const nums: number[] = [];
  container.querySelectorAll('path').forEach((p) => {
    const d = p.getAttribute('d') ?? '';
    for (const m of d.match(/-?\d*\.?\d+(?:e-?\d+)?/gi) ?? []) nums.push(Number(m));
  });
  container.querySelectorAll('circle').forEach((c) => {
    for (const attr of ['cx', 'cy', 'r']) {
      const v = c.getAttribute(attr);
      if (v !== null) nums.push(Number(v));
    }
  });
  return nums;
}

function expectAllFinite(container: HTMLElement): void {
  const nums = geometryNumbers(container);
  // Guard against a vacuous pass: every caller below renders real geometry, so
  // an empty set means the markup/selector changed — not that all numbers are
  // finite. The empty-data case asserts zero geometry directly instead.
  expect(nums.length).toBeGreaterThan(0);
  for (const n of nums) {
    expect(Number.isFinite(n)).toBe(true);
  }
}

describe('Sparkline', () => {
  it('renders an accessible image with the sr summary, role=img and aria-label', () => {
    const label = '12 commits over 8 weeks, trend up';
    const { container, getByRole, getByText } = render(
      <Sparkline data={[0, 1, 2, 1, 3, 2, 4, 5]} srLabel={label} />,
    );
    const svg = getByRole('img');
    expect(svg).toHaveAttribute('aria-label', label);
    // Redundant (non-colour) encoding: a sr-only text alternative is present.
    expect(getByText(label)).toBeInTheDocument();
    expectAllFinite(container);
  });

  it('draws a stroke + area path and an endpoint dot for a typical series', () => {
    const { container } = render(<Sparkline data={[1, 2, 3, 2, 4, 6, 5, 8]} srLabel="summary" />);
    // At least two paths: the filled area and the stroked line.
    expect(container.querySelectorAll('path').length).toBeGreaterThanOrEqual(2);
    // Endpoint dot.
    expect(container.querySelector('circle')).not.toBeNull();
    expectAllFinite(container);
  });

  it('uses the tone CSS variable for ink and fill (no hard-coded hex)', () => {
    const { container } = render(<Sparkline data={[1, 2, 3]} tone="info" srLabel="summary" />);
    const markup = container.innerHTML;
    expect(markup).toContain('var(--color-info)');
    expect(markup).not.toMatch(/#[0-9a-fA-F]{3,6}/);
  });

  it('defaults to the success tone', () => {
    const { container } = render(<Sparkline data={[1, 2, 3]} srLabel="summary" />);
    expect(container.innerHTML).toContain('var(--color-success)');
  });

  it('renders gracefully for empty data with no NaN/Infinity geometry', () => {
    const { container, getByRole, getByText } = render(
      <Sparkline data={[]} srLabel="No recent commit activity" />,
    );
    expect(getByRole('img')).toBeInTheDocument();
    expect(getByText('No recent commit activity')).toBeInTheDocument();
    // No path should be drawn for empty data.
    expect(container.querySelector('path[d]')).toBeNull();
    // Empty data draws zero geometry — assert that explicitly rather than
    // calling expectAllFinite (which would pass vacuously over an empty set).
    expect(geometryNumbers(container)).toHaveLength(0);
  });

  it('renders an all-zero series as a flat line with finite geometry (no division by zero)', () => {
    const { container } = render(
      <Sparkline data={[0, 0, 0, 0]} srLabel="0 commits over 4 weeks, flat" />,
    );
    expectAllFinite(container);
    // The line path's y coordinates should all be identical (flat).
    const line = container.querySelector('path[data-part="line"]');
    expect(line).not.toBeNull();
    const d = line?.getAttribute('d') ?? '';
    const ys = [...d.matchAll(/[ML]\s*-?\d*\.?\d+[ ,]\s*(-?\d*\.?\d+)/gi)].map((m) => Number(m[1]));
    expect(ys.length).toBeGreaterThan(0);
    for (const y of ys) expect(y).toBe(ys[0]);
  });

  it('renders a single data point with finite geometry and an endpoint dot', () => {
    const { container } = render(<Sparkline data={[7]} srLabel="7 commits in 1 week" />);
    expect(container.querySelector('circle')).not.toBeNull();
    expectAllFinite(container);
  });

  it('sanitizes a non-finite (Infinity) value to zero so it never corrupts the scale (#165)', () => {
    // 96×24 viewport → PADDING 3, baseY 21. Without the guard a single Infinity
    // makes `max` Infinity, flattening every finite point onto the baseline and
    // (via NaN→0 rounding) plotting the Infinity itself at the very top.
    const { container } = render(
      <Sparkline data={[2, 4, Infinity]} srLabel="summary" width={96} height={24} />,
    );
    expectAllFinite(container);
    const line = container.querySelector('path[data-part="line"]');
    const d = line?.getAttribute('d') ?? '';
    const ys = [...d.matchAll(/[ML]\s*-?\d*\.?\d+[ ,]\s*(-?\d*\.?\d+)/gi)].map((m) => Number(m[1]));
    expect(ys).toHaveLength(3);
    // The finite max (4) reaches the top of the plot…
    expect(ys[1]).toBeLessThanOrEqual(4);
    // …and the non-finite value, treated as 0, sits on the baseline.
    expect(ys[2]).toBeGreaterThanOrEqual(20);
  });

  it('sanitizes a NaN value to zero (no out-of-bounds geometry) (#165)', () => {
    const { container } = render(
      <Sparkline data={[2, 4, NaN]} srLabel="summary" width={96} height={24} />,
    );
    expectAllFinite(container);
    const line = container.querySelector('path[data-part="line"]');
    const d = line?.getAttribute('d') ?? '';
    const ys = [...d.matchAll(/[ML]\s*-?\d*\.?\d+[ ,]\s*(-?\d*\.?\d+)/gi)].map((m) => Number(m[1]));
    expect(ys).toHaveLength(3);
    // The NaN must not blow up the scale: the finite max stays at the top and
    // the NaN point sits on the baseline, all within [0, height].
    expect(ys[1]).toBeLessThanOrEqual(4);
    expect(ys[2]).toBeGreaterThanOrEqual(20);
    for (const y of ys) {
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(24);
    }
  });

  it('honours custom width and height on the SVG viewport', () => {
    const { getByRole } = render(
      <Sparkline data={[1, 2, 3]} srLabel="summary" width={200} height={50} />,
    );
    const svg = getByRole('img');
    expect(svg).toHaveAttribute('width', '200');
    expect(svg).toHaveAttribute('height', '50');
    expect(svg).toHaveAttribute('viewBox', '0 0 200 50');
  });

  it('keeps geometry within the viewport bounds for a typical series', () => {
    const width = 96;
    const height = 24;
    const { container } = render(
      <Sparkline data={[3, 1, 4, 1, 5, 9, 2, 6]} srLabel="summary" width={width} height={height} />,
    );
    const dot = container.querySelector('circle');
    const cx = Number(dot?.getAttribute('cx'));
    const cy = Number(dot?.getAttribute('cy'));
    expect(cx).toBeGreaterThanOrEqual(0);
    expect(cx).toBeLessThanOrEqual(width);
    expect(cy).toBeGreaterThanOrEqual(0);
    expect(cy).toBeLessThanOrEqual(height);
  });
});

describe('Sparkline — full-path viewport bounds (#164)', () => {
  const WIDTH = 96;
  const HEIGHT = 24;

  /**
   * Asserts EVERY geometry number (line + area path coords AND the dot) lies in
   * the [0, max(width, height)] box, so a future path-math regression — not just
   * a stray endpoint dot — fails a test.
   */
  function expectGeometryWithinBounds(container: HTMLElement, width: number, height: number): void {
    const bound = Math.max(width, height);
    const nums = geometryNumbers(container);
    expect(nums.length).toBeGreaterThan(0);
    for (const n of nums) {
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThanOrEqual(bound);
    }
  }

  it('keeps ALL path + dot coordinates within the viewport for a typical series', () => {
    const { container } = render(
      <Sparkline data={[3, 1, 4, 1, 5, 9, 2, 6]} srLabel="summary" width={WIDTH} height={HEIGHT} />,
    );
    expectGeometryWithinBounds(container, WIDTH, HEIGHT);
  });

  it('keeps geometry within bounds for a single point', () => {
    const { container } = render(
      <Sparkline data={[7]} srLabel="summary" width={WIDTH} height={HEIGHT} />,
    );
    expectGeometryWithinBounds(container, WIDTH, HEIGHT);
  });

  it('keeps geometry within bounds for extreme values', () => {
    const { container } = render(
      <Sparkline
        data={[0, 1_000_000, 5, 999_999, 1]}
        srLabel="summary"
        width={WIDTH}
        height={HEIGHT}
      />,
    );
    expectGeometryWithinBounds(container, WIDTH, HEIGHT);
  });
});
