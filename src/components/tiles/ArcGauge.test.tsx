import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ArcGauge } from './ArcGauge';

/** Collects every numeric token from the geometry attributes of the SVG. */
function geometryNumbers(container: HTMLElement): number[] {
  const nums: number[] = [];
  container.querySelectorAll('path').forEach((p) => {
    const d = p.getAttribute('d') ?? '';
    for (const m of d.match(/-?\d*\.?\d+(?:e-?\d+)?/gi) ?? []) nums.push(Number(m));
  });
  return nums;
}

function expectAllFinite(container: HTMLElement): void {
  for (const n of geometryNumbers(container)) {
    expect(Number.isFinite(n)).toBe(true);
  }
}

describe('ArcGauge', () => {
  it('renders an accessible image with role=img, aria-label and sr text', () => {
    const label = 'Security grade A, score 100 of 100';
    const { getByRole, getByText } = render(
      <ArcGauge value={100} tone="success" center="A" srLabel={label} />,
    );
    const svg = getByRole('img');
    expect(svg).toHaveAttribute('aria-label', label);
    expect(getByText(label)).toBeInTheDocument();
  });

  it('renders the centered hero node', () => {
    const { getByText } = render(
      <ArcGauge value={50} tone="warning" center={<span>C</span>} srLabel="grade C" />,
    );
    expect(getByText('C')).toBeInTheDocument();
  });

  it('draws both a muted track path and a tone-coloured fill path', () => {
    const { container } = render(
      <ArcGauge value={60} max={100} tone="warning" center="C" srLabel="grade C" />,
    );
    const track = container.querySelector('[data-part="track"]');
    const fill = container.querySelector('[data-part="fill"]');
    expect(track).not.toBeNull();
    expect(fill).not.toBeNull();
    // The fill paints in the tone colour; the track must NOT use the tone.
    expect(fill?.getAttribute('stroke')).toBe('var(--color-warning)');
    expect(track?.getAttribute('stroke')).not.toBe('var(--color-warning)');
  });

  it('uses the tone CSS variable for the fill (no hard-coded hex)', () => {
    const { container } = render(
      <ArcGauge value={20} tone="failure" center="F" srLabel="grade F" />,
    );
    expect(container.innerHTML).toContain('var(--color-failure)');
    expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,6}/);
  });

  it('is static (reduced-motion safe): no animation classes', () => {
    const { container } = render(<ArcGauge value={40} tone="info" center="D" srLabel="grade D" />);
    expect(container.innerHTML).not.toMatch(/animate/);
  });

  it('produces only finite geometry when max === 0 (no NaN, no divide-by-zero)', () => {
    const { container, getByRole } = render(
      <ArcGauge value={5} max={0} tone="neutral" center="?" srLabel="unknown" />,
    );
    expect(getByRole('img')).toBeInTheDocument();
    expectAllFinite(container);
    // fraction clamps to 0 → no fill arc is drawn; the track is the full 180°.
    expect(container.querySelector('[data-part="fill"]')).toBeNull();
    expect(container.querySelector('[data-part="track"]')?.getAttribute('d')).toBe(
      'M6 60 A54 54 0 0 1 114 60',
    );
  });

  it('clamps value > max to a full arc with finite geometry', () => {
    const { container } = render(
      <ArcGauge value={250} max={100} tone="success" center="A" srLabel="grade A" />,
    );
    expectAllFinite(container);
    // fraction clamps to 1 → the fill arc spans the whole track exactly.
    const track = container.querySelector('[data-part="track"]')?.getAttribute('d');
    const fill = container.querySelector('[data-part="fill"]')?.getAttribute('d');
    expect(fill).toBe('M6 60 A54 54 0 0 1 114 60');
    expect(fill).toBe(track);
  });

  it('clamps negative value to zero with finite geometry', () => {
    const { container } = render(
      <ArcGauge value={-10} max={100} tone="failure" center="F" srLabel="grade F" />,
    );
    expectAllFinite(container);
    // fraction clamps to 0 → no fill arc.
    expect(container.querySelector('[data-part="fill"]')).toBeNull();
  });

  it('renders finitely for an empty/zero value', () => {
    const { container } = render(
      <ArcGauge value={0} max={100} tone="failure" center="F" srLabel="grade F" />,
    );
    expectAllFinite(container);
    expect(container.querySelector('[data-part="fill"]')).toBeNull();
  });

  it('draws the fill arc to the exact half-way point for value = max/2', () => {
    const { container } = render(
      <ArcGauge value={50} max={100} tone="success" center="B" srLabel="grade B" />,
    );
    // fraction 0.5 → arc ends at the top of the semicircle (CX, CY-RADIUS) = (60, 6).
    expect(container.querySelector('[data-part="fill"]')?.getAttribute('d')).toBe(
      'M6 60 A54 54 0 0 1 60 6',
    );
  });
});
