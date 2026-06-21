import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Chip } from './Chip';

describe('Chip', () => {
  it('renders its text content', () => {
    render(<Chip tone="info">12 open</Chip>);
    expect(screen.getByText('12 open')).toBeInTheDocument();
  });

  it('colours text with the accent token (tint pattern, AA in both themes)', () => {
    const { container } = render(<Chip tone="coral">External</Chip>);
    const chip = container.firstElementChild as HTMLElement;
    expect(chip.className).toContain('text-accent-coral');
  });

  it('applies a low-opacity accent tint background via the tone variable', () => {
    const { container } = render(<Chip tone="warning">Stale</Chip>);
    const chip = container.firstElementChild as HTMLElement;
    expect(chip.style.backgroundColor).toContain('var(--color-warning)');
  });

  it('renders a decorative icon hidden from assistive tech', () => {
    const { container } = render(
      <Chip tone="success" icon={<svg data-testid="icon" />}>
        Healthy
      </Chip>,
    );
    const icon = container.querySelector('[aria-hidden="true"]');
    expect(icon).toBeTruthy();
    expect(icon?.querySelector('[data-testid="icon"]')).toBeTruthy();
  });

  it('passes a title through for hover/tooltip context', () => {
    render(
      <Chip tone="failure" title="3 failing checks">
        3
      </Chip>,
    );
    expect(screen.getByTitle('3 failing checks')).toBeInTheDocument();
  });

  it('adds screen-reader-only context when srLabel is given', () => {
    const { container } = render(
      <Chip tone="info" srLabel="12 open pull requests">
        12
      </Chip>,
    );
    const sr = container.querySelector('.sr-only');
    expect(sr?.textContent).toBe('12 open pull requests');
  });

  it('exposes the tone via a data attribute', () => {
    const { container } = render(<Chip tone="purple">Release</Chip>);
    expect(container.firstElementChild).toHaveAttribute('data-tone', 'purple');
  });
});
