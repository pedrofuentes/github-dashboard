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
