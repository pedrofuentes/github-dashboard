import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DensityToggle } from './DensityToggle';

const DENSITY_KEY = 'fleet:density';

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('DensityToggle', () => {
  it('exposes an accessible radiogroup with the two density choices', () => {
    render(<DensityToggle />);
    const group = screen.getByRole('radiogroup', { name: /density/i });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /balanced/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /glanceable/i })).toBeInTheDocument();
  });

  it('defaults to Balanced when nothing is stored', () => {
    render(<DensityToggle />);
    expect(screen.getByRole('radio', { name: /balanced/i })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('radio', { name: /glanceable/i })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  it('marks the stored choice as checked', () => {
    localStorage.setItem(DENSITY_KEY, 'glanceable');
    render(<DensityToggle />);
    expect(screen.getByRole('radio', { name: /glanceable/i })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('radio', { name: /balanced/i })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  it('renders a redundant text label for every option (never colour alone)', () => {
    render(<DensityToggle />);
    expect(screen.getByText('Balanced')).toBeInTheDocument();
    expect(screen.getByText('Glanceable')).toBeInTheDocument();
  });

  it('exposes a visible focus ring on each option for keyboard users', () => {
    render(<DensityToggle />);
    expect(screen.getByRole('radio', { name: /balanced/i }).className).toMatch(
      /focus-visible:outline-focus/,
    );
  });

  it('selects and persists the density on click', async () => {
    const user = userEvent.setup();
    render(<DensityToggle />);

    await user.click(screen.getByRole('radio', { name: /glanceable/i }));

    expect(screen.getByRole('radio', { name: /glanceable/i })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(localStorage.getItem(DENSITY_KEY)).toBe('glanceable');

    await user.click(screen.getByRole('radio', { name: /balanced/i }));

    expect(screen.getByRole('radio', { name: /balanced/i })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(localStorage.getItem(DENSITY_KEY)).toBe('balanced');
  });
});
