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
  });

  it('accepts a custom opacity', () => {
    const { container } = render(<AmbientGlow tone="failure" opacity={0.12} />);
    const glow = container.firstElementChild as HTMLElement;
    expect(glow.style.opacity).toBe('0.12');
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
