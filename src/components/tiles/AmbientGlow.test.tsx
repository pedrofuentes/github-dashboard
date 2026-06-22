import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AmbientGlow } from './AmbientGlow';

describe('AmbientGlow', () => {
  it('renders a decorative tint hidden from assistive tech', () => {
    const { container } = render(<AmbientGlow tone="warning" />);
    const glow = container.firstElementChild as HTMLElement;
    expect(glow).toHaveAttribute('aria-hidden', 'true');
    expect(container.textContent).toBe('');
  });

  it('tints with the tone variable and a low default opacity', () => {
    const { container } = render(<AmbientGlow tone="success" />);
    const glow = container.firstElementChild as HTMLElement;
    expect(glow.style.backgroundColor).toBe('var(--color-success)');
    expect(glow.style.opacity).toBe('0.06');
    // The data-opacity seam mirrors the applied style exactly.
    expect(glow).toHaveAttribute('data-opacity', '0.06');
  });

  it('accepts a custom opacity', () => {
    const { container } = render(<AmbientGlow tone="failure" opacity={0.12} />);
    const glow = container.firstElementChild as HTMLElement;
    expect(glow.style.opacity).toBe('0.12');
    expect(glow).toHaveAttribute('data-opacity', '0.12');
  });

  it('falls back to the default opacity for a non-finite value (never silently opaque)', () => {
    // An unguarded NaN reaches the DOM as an invalid value → ignored → the tint
    // renders fully opaque. The guard substitutes the subtle default instead.
    const { container } = render(<AmbientGlow tone="failure" opacity={NaN} />);
    const glow = container.firstElementChild as HTMLElement;
    expect(glow.style.opacity).toBe('0.06');
  });

  it('does not animate (static tint, no spin/pulse classes)', () => {
    const { container } = render(<AmbientGlow tone="info" />);
    const glow = container.firstElementChild as HTMLElement;
    expect(glow.className).not.toContain('animate-');
    expect(glow.className).toContain('pointer-events-none');
  });

  it('exposes the tone via a data attribute', () => {
    const { container } = render(<AmbientGlow tone="purple" />);
    expect(container.firstElementChild).toHaveAttribute('data-tone', 'purple');
  });
});

describe('AmbientGlow — opacity clamp (data-opacity seam)', () => {
  // JSDOM independently clamps `style.opacity`, so over-range/negative inputs
  // can't be characterised through the style alone. The component therefore
  // surfaces the clamp result on `data-opacity`, which is a plain attribute the
  // CSSOM never touches — every assertion below fails without the clamp.
  const opacityAttr = (opacity: number): string | null => {
    const { container } = render(<AmbientGlow tone="info" opacity={opacity} />);
    return (container.firstElementChild as HTMLElement).getAttribute('data-opacity');
  };

  it('passes an in-range opacity through unchanged', () => {
    expect(opacityAttr(0.5)).toBe('0.5');
    expect(opacityAttr(0)).toBe('0');
    expect(opacityAttr(1)).toBe('1');
  });

  it('clamps an over-range opacity down to 1', () => {
    expect(opacityAttr(5)).toBe('1');
    expect(opacityAttr(1.0001)).toBe('1');
  });

  it('clamps a negative opacity up to 0', () => {
    expect(opacityAttr(-0.5)).toBe('0');
    expect(opacityAttr(-100)).toBe('0');
  });

  it('falls back to the subtle default for any non-finite opacity (never opaque)', () => {
    expect(opacityAttr(NaN)).toBe('0.06');
    expect(opacityAttr(Infinity)).toBe('0.06');
    expect(opacityAttr(-Infinity)).toBe('0.06');
  });
});
