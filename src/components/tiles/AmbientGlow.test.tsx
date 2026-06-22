import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AmbientGlow, clampOpacity } from './AmbientGlow';

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
  });

  it('accepts a custom opacity', () => {
    const { container } = render(<AmbientGlow tone="failure" opacity={0.12} />);
    const glow = container.firstElementChild as HTMLElement;
    expect(glow.style.opacity).toBe('0.12');
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

describe('clampOpacity', () => {
  it('passes an in-range opacity through unchanged', () => {
    expect(clampOpacity(0.06)).toBe(0.06);
    expect(clampOpacity(0.5)).toBe(0.5);
    expect(clampOpacity(0)).toBe(0);
    expect(clampOpacity(1)).toBe(1);
  });

  it('clamps an over-range opacity down to 1', () => {
    expect(clampOpacity(5)).toBe(1);
    expect(clampOpacity(1.0001)).toBe(1);
  });

  it('clamps a negative opacity up to 0', () => {
    expect(clampOpacity(-0.5)).toBe(0);
    expect(clampOpacity(-100)).toBe(0);
  });

  it('falls back to the subtle default for a non-finite opacity (never opaque)', () => {
    expect(clampOpacity(NaN)).toBe(0.06);
    expect(clampOpacity(Infinity)).toBe(0.06);
    expect(clampOpacity(-Infinity)).toBe(0.06);
  });
});
