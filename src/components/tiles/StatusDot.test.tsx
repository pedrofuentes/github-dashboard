import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { StatusDot } from './StatusDot';

describe('StatusDot', () => {
  it('renders a small round accent dot tinted by tone', () => {
    const { container } = render(<StatusDot tone="success" />);
    const dot = container.firstElementChild as HTMLElement;
    expect(dot.className).toContain('rounded-full');
    expect(dot.className).toContain('bg-accent-success');
  });

  it('is hidden from assistive technology (decorative)', () => {
    const { container } = render(<StatusDot tone="warning" />);
    const dot = container.firstElementChild as HTMLElement;
    expect(dot).toHaveAttribute('aria-hidden', 'true');
    expect(container.textContent).toBe('');
  });

  it('exposes the tone via a data attribute', () => {
    const { container } = render(<StatusDot tone="coral" />);
    expect(container.firstElementChild).toHaveAttribute('data-tone', 'coral');
  });
});
