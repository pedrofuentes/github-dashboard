import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AccentBar } from './AccentBar';

describe('AccentBar', () => {
  it('renders a full-width decorative bar tinted with the tone variable', () => {
    const { container } = render(<AccentBar tone="failure" />);
    const bar = container.firstElementChild as HTMLElement;
    expect(bar).toHaveAttribute('aria-hidden', 'true');
    expect(bar.className).toContain('w-full');
    expect(bar.className).toContain('bg-accent-failure');
  });

  it('defaults to the thin (sm) thickness', () => {
    const { container } = render(<AccentBar tone="success" />);
    const bar = container.firstElementChild as HTMLElement;
    expect(bar.className).toContain('h-1');
    expect(bar.className).not.toContain('h-1.5');
  });

  it('renders a thicker bar when thickness is md', () => {
    const { container } = render(<AccentBar tone="success" thickness="md" />);
    const bar = container.firstElementChild as HTMLElement;
    expect(bar.className).toContain('h-1.5');
  });

  it('exposes the tone via a data attribute for consumers', () => {
    const { container } = render(<AccentBar tone="info" />);
    expect(container.firstElementChild).toHaveAttribute('data-tone', 'info');
  });

  it('carries no accessible text (purely decorative)', () => {
    const { container } = render(<AccentBar tone="warning" />);
    expect(container.textContent).toBe('');
  });
});
