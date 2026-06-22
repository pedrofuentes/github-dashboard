import { render, screen, within } from '@testing-library/react';

import { Heatmap } from './Heatmap';

/**
 * Contract for the accessible commit `Heatmap` primitive (DESIGN-TILES §4.7 /
 * §5). The grid is weeks (columns) × 7 days (rows). Intensity encodes
 * `count / max` as a tone shade, but the data is also exposed redundantly
 * (per-cell `<title>` + an sr-only weekly-totals table) so it is never
 * color-only, and the component must never emit `NaN`/`Infinity` geometry for
 * ragged, empty, or all-zero input.
 */

/** Read every `<rect>` cell the heatmap drew. */
function cells(container: HTMLElement): SVGRectElement[] {
  return Array.from(container.querySelectorAll<SVGRectElement>('rect[data-heatmap-cell]'));
}

/** Assert a numeric-looking SVG attribute is a finite number. */
function expectFiniteAttr(el: Element, attr: string): void {
  const raw = el.getAttribute(attr);
  expect(raw).not.toBeNull();
  const value = Number(raw);
  expect(Number.isFinite(value)).toBe(true);
}

describe('Heatmap', () => {
  const twoWeeks: number[][] = [
    [0, 1, 2, 3, 4, 5, 6],
    [6, 5, 4, 3, 2, 1, 0],
  ];

  it('exposes role=img with the provided srLabel as the accessible name', () => {
    render(<Heatmap weeks={twoWeeks} srLabel="42 commits over 2 weeks" />);
    const img = screen.getByRole('img', { name: '42 commits over 2 weeks' });
    expect(img).toBeInTheDocument();
  });

  it('draws one cell per day for every week (weeks × 7)', () => {
    const { container } = render(<Heatmap weeks={twoWeeks} srLabel="commits" />);
    expect(cells(container)).toHaveLength(2 * 7);
  });

  it('gives every cell a default "{count} commits" title', () => {
    const { container } = render(<Heatmap weeks={[[3]]} srLabel="commits" />);
    const cell = cells(container)[0];
    const title = cell.querySelector('title');
    expect(title?.textContent).toBe('3 commits');
  });

  it('uses the cellTitle callback when provided', () => {
    const { container } = render(
      <Heatmap
        weeks={[[5]]}
        srLabel="commits"
        cellTitle={(w, d, count) => `week ${w} day ${d}: ${count}`}
      />,
    );
    const title = cells(container)[0].querySelector('title');
    expect(title?.textContent).toBe('week 0 day 0: 5');
  });

  it('renders an sr-only table fallback of weekly totals', () => {
    render(<Heatmap weeks={twoWeeks} srLabel="commits" />);
    const table = screen.getByRole('table');
    // Week 0 total = 21, week 1 total = 21.
    const rows = within(table).getAllByRole('row');
    // header row + one row per week
    expect(rows).toHaveLength(1 + 2);
    expect(within(table).getAllByText('21')).toHaveLength(2);
  });

  it('renders zero cells with a different fill than non-zero cells', () => {
    const { container } = render(<Heatmap weeks={[[0, 4]]} srLabel="commits" />);
    const [zeroCell, hotCell] = cells(container);
    expect(zeroCell.getAttribute('data-count')).toBe('0');
    expect(hotCell.getAttribute('data-count')).toBe('4');
    expect(zeroCell.getAttribute('fill')).not.toBe(hotCell.getAttribute('fill'));
  });

  it('scales intensity by count / max and stays within [0, 1]', () => {
    const { container } = render(<Heatmap weeks={[[1, 2, 4]]} srLabel="commits" max={4} />);
    for (const cell of cells(container)) {
      expectFiniteAttr(cell, 'fill-opacity');
      const opacity = Number(cell.getAttribute('fill-opacity'));
      expect(opacity).toBeGreaterThanOrEqual(0);
      expect(opacity).toBeLessThanOrEqual(1);
    }
  });

  it('renders without crashing for empty weeks and shows no data rows', () => {
    const { container } = render(<Heatmap weeks={[]} srLabel="no commits" />);
    expect(cells(container)).toHaveLength(0);
    expect(screen.getByRole('img', { name: 'no commits' })).toBeInTheDocument();
    const table = screen.getByRole('table');
    // header row only.
    expect(within(table).getAllByRole('row')).toHaveLength(1);
  });

  it('tolerates a ragged week (fewer than 7 days) without NaN geometry', () => {
    const { container } = render(<Heatmap weeks={[[1, 2, 3]]} srLabel="commits" />);
    // Still a full 7-row column; the missing days are treated as zero.
    const drawn = cells(container);
    expect(drawn).toHaveLength(7);
    for (const cell of drawn) {
      expectFiniteAttr(cell, 'x');
      expectFiniteAttr(cell, 'y');
      expectFiniteAttr(cell, 'width');
      expectFiniteAttr(cell, 'height');
      expectFiniteAttr(cell, 'fill-opacity');
    }
    // Day index 4..6 are absent → counted as 0 in the weekly total (1+2+3 = 6).
    expect(screen.getByText('6')).toBeInTheDocument();
  });

  it('handles all-zero data without producing NaN opacity', () => {
    const { container } = render(<Heatmap weeks={[[0, 0, 0, 0, 0, 0, 0]]} srLabel="commits" />);
    for (const cell of cells(container)) {
      expectFiniteAttr(cell, 'fill-opacity');
      expect(cell.getAttribute('data-count')).toBe('0');
    }
  });

  it('guards max === 0 so intensity never divides by zero', () => {
    const { container } = render(<Heatmap weeks={[[3, 5]]} srLabel="commits" max={0} />);
    for (const cell of cells(container)) {
      expectFiniteAttr(cell, 'fill-opacity');
      const opacity = Number(cell.getAttribute('fill-opacity'));
      expect(Number.isFinite(opacity)).toBe(true);
      expect(opacity).toBeGreaterThanOrEqual(0);
    }
  });

  it('resolves the tone to a --color-* CSS variable (default success)', () => {
    const { container, rerender } = render(<Heatmap weeks={[[4]]} srLabel="commits" />);
    expect(cells(container)[0].getAttribute('fill')).toContain('var(--color-success)');

    rerender(<Heatmap weeks={[[4]]} srLabel="commits" tone="info" />);
    expect(cells(container)[0].getAttribute('fill')).toContain('var(--color-info)');
  });
});

describe('Heatmap — grayscale-safe low-cell floor', () => {
  it('floors the faintest non-zero cell to a visibly opaque minimum so zero ≠ low without colour', () => {
    // A single commit against a tall max would otherwise wash the cell out to a
    // near-invisible tint, ambiguous with an empty cell once hue is removed.
    const { container } = render(<Heatmap weeks={[[1]]} srLabel="commits" max={100} />);
    const cell = cells(container)[0];
    expect(cell.getAttribute('data-count')).toBe('1');
    const opacity = Number(cell.getAttribute('fill-opacity'));
    expect(opacity).toBeGreaterThanOrEqual(0.3);
  });

  it('keeps an empty cell distinguishable from the floored low cell (different fill, floored opacity)', () => {
    const { container } = render(<Heatmap weeks={[[0, 1]]} srLabel="commits" max={100} />);
    const [zeroCell, lowCell] = cells(container);
    expect(zeroCell.getAttribute('data-count')).toBe('0');
    expect(lowCell.getAttribute('data-count')).toBe('1');
    // Hue channel (distinct fill) PLUS the low cell clears the visible floor so
    // the zero/low pair stays separable in grayscale.
    expect(zeroCell.getAttribute('fill')).not.toBe(lowCell.getAttribute('fill'));
    expect(Number(lowCell.getAttribute('fill-opacity'))).toBeGreaterThanOrEqual(0.3);
  });
});

describe('Heatmap — max sanitization & intensity proportionality (#166)', () => {
  /** `MIN_INTENSITY` floor from Heatmap.tsx — the faintest non-zero opacity. */
  const MIN = 0.35;

  /** Non-empty cell opacities in DOM (week → day) order. */
  function nonEmptyOpacities(container: HTMLElement): number[] {
    return cells(container)
      .filter((cell) => Number(cell.getAttribute('data-count')) > 0)
      .map((cell) => Number(cell.getAttribute('fill-opacity')));
  }

  it('encodes intensity proportional to count/max (monotonic — a constant-opacity impl fails)', () => {
    const { container } = render(<Heatmap weeks={[[1, 2, 4]]} srLabel="commits" max={4} />);
    const opacities = nonEmptyOpacities(container);
    expect(opacities).toHaveLength(3);
    // Expected = MIN + (1 - MIN) * (count / max).
    expect(opacities[0]).toBeCloseTo(MIN + (1 - MIN) * (1 / 4), 5);
    expect(opacities[1]).toBeCloseTo(MIN + (1 - MIN) * (2 / 4), 5);
    expect(opacities[2]).toBeCloseTo(MIN + (1 - MIN) * (4 / 4), 5);
    // Strictly increasing with count — flat MIN_INTENSITY output would not pass.
    expect(opacities[0]).toBeLessThan(opacities[1]);
    expect(opacities[1]).toBeLessThan(opacities[2]);
  });

  it('sanitizes a NaN max by falling back to the data max (finite, proportional intensities)', () => {
    const { container } = render(<Heatmap weeks={[[1, 2, 4]]} srLabel="commits" max={NaN} />);
    const opacities = nonEmptyOpacities(container);
    expect(opacities).toHaveLength(3);
    for (const opacity of opacities) {
      expect(Number.isFinite(opacity)).toBe(true);
      expect(opacity).toBeGreaterThanOrEqual(0);
      expect(opacity).toBeLessThanOrEqual(1);
    }
    // Not flattened to a single constant — intensity still tracks count.
    expect(opacities[0]).toBeLessThan(opacities[1]);
    expect(opacities[1]).toBeLessThan(opacities[2]);
  });

  it('sanitizes an Infinity max by falling back to the data max (finite, proportional intensities)', () => {
    const { container } = render(<Heatmap weeks={[[1, 2, 4]]} srLabel="commits" max={Infinity} />);
    const opacities = nonEmptyOpacities(container);
    expect(opacities).toHaveLength(3);
    for (const opacity of opacities) {
      expect(Number.isFinite(opacity)).toBe(true);
      expect(opacity).toBeLessThanOrEqual(1);
    }
    expect(opacities[0]).toBeLessThan(opacities[1]);
    expect(opacities[1]).toBeLessThan(opacities[2]);
  });
});

describe('Heatmap — count > max clamp & max=0 tone fill (#167)', () => {
  it('clamps a cell whose count exceeds max to full intensity (ratio > 1)', () => {
    // count/max = 10/2 = 5 → ratio clamps to 1 → intensity = MIN + (1-MIN)*1 = 1.
    const { container } = render(<Heatmap weeks={[[10]]} srLabel="commits" max={2} />);
    const cell = cells(container)[0];
    expect(cell.getAttribute('data-count')).toBe('10');
    expect(Number(cell.getAttribute('fill-opacity'))).toBe(1);
  });

  it('still paints non-zero cells in the tone fill (not the empty fill) when max === 0', () => {
    // max=0 is non-positive, so the denominator falls back to the data max (5);
    // empty cells keep the raised-surface fill, non-zero cells keep the tone.
    const { container } = render(
      <Heatmap weeks={[[0, 5]]} srLabel="commits" max={0} tone="info" />,
    );
    const [zeroCell, hotCell] = cells(container);
    expect(zeroCell.getAttribute('data-count')).toBe('0');
    expect(zeroCell.getAttribute('fill')).toBe('var(--color-surface-raised)');
    expect(hotCell.getAttribute('data-count')).toBe('5');
    expect(hotCell.getAttribute('fill')).toBe('var(--color-info)');
    expect(hotCell.getAttribute('fill')).not.toBe(zeroCell.getAttribute('fill'));
    // The data-max cell reaches full intensity; always finite, never NaN.
    const opacity = Number(hotCell.getAttribute('fill-opacity'));
    expect(opacity).toBe(1);
    expect(opacity).toBeGreaterThan(0);
  });
});
