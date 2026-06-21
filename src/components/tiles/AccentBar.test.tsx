import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AccentBar } from './AccentBar';

describe('AccentBar', () => {
  it('renders a full-width decorative bar tinted with the tone variable', () => {
    const { container } = render(<AccentBar tone="failure" />);
    const bar = container.firstElementChild as HTMLElement;
    expect(bar).toHaveAttribute('aria-hidden', 'true');
    expect(bar.className).toContain('w-full');
    expect(bar.className).toContain('rounded-t');
    expect(bar.className).toContain('bg-accent-failure');
  });

  it('defaults to the calm 5px thickness', () => {
    const { container } = render(<AccentBar tone="success" />);
    const bar = container.firstElementChild as HTMLElement;
    expect(bar.className).toContain('h-[5px]');
    expect(bar.className).not.toContain('h-[6px]');
  });

  it('renders the calm 5px thickness when thickness is calm', () => {
    const { container } = render(<AccentBar tone="success" thickness="calm" />);
    const bar = container.firstElementChild as HTMLElement;
    expect(bar.className).toContain('h-[5px]');
    expect(bar.className).not.toContain('h-[6px]');
  });

  it('renders the problem 6px thickness when thickness is problem', () => {
    const { container } = render(<AccentBar tone="failure" thickness="problem" />);
    const bar = container.firstElementChild as HTMLElement;
    expect(bar.className).toContain('h-[6px]');
    expect(bar.className).not.toContain('h-[5px]');
    expect(bar).toHaveAttribute('aria-hidden', 'true');
    expect(bar).toHaveAttribute('data-tone', 'failure');
    expect(bar.className).toContain('bg-accent-failure');
  });

  it('keeps the deprecated sm alias mapping to the calm 5px height', () => {
    const { container } = render(<AccentBar tone="success" thickness="sm" />);
    const bar = container.firstElementChild as HTMLElement;
    expect(bar.className).toContain('h-[5px]');
    expect(bar.className).not.toContain('h-[6px]');
  });

  it('keeps the deprecated md alias mapping to the problem 6px height', () => {
    const { container } = render(<AccentBar tone="success" thickness="md" />);
    const bar = container.firstElementChild as HTMLElement;
    expect(bar.className).toContain('h-[6px]');
    expect(bar.className).not.toContain('h-[5px]');
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
