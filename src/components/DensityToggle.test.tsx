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

describe('DensityToggle — keyboard (WAI-ARIA radiogroup roving tabindex)', () => {
  it('keeps only the checked radio in the tab order', () => {
    localStorage.setItem(DENSITY_KEY, 'glanceable');
    render(<DensityToggle />);
    expect(screen.getByRole('radio', { name: /glanceable/i })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('radio', { name: /balanced/i })).toHaveAttribute('tabindex', '-1');
  });

  it('moves selection and focus to the next option on ArrowRight, wrapping at the end', async () => {
    const user = userEvent.setup();
    render(<DensityToggle />); // defaults to balanced (the first option)

    screen.getByRole('radio', { name: /balanced/i }).focus();
    await user.keyboard('{ArrowRight}');

    const glanceable = screen.getByRole('radio', { name: /glanceable/i });
    expect(glanceable).toHaveAttribute('aria-checked', 'true');
    expect(glanceable).toHaveFocus();
    expect(localStorage.getItem(DENSITY_KEY)).toBe('glanceable');

    // Wrapping: ArrowRight from the last option returns to the first.
    await user.keyboard('{ArrowRight}');
    const balanced = screen.getByRole('radio', { name: /balanced/i });
    expect(balanced).toHaveAttribute('aria-checked', 'true');
    expect(balanced).toHaveFocus();
    expect(localStorage.getItem(DENSITY_KEY)).toBe('balanced');
  });

  it('moves selection and focus to the previous option on ArrowLeft, wrapping at the start', async () => {
    const user = userEvent.setup();
    render(<DensityToggle />); // balanced (first) — ArrowLeft wraps to the last

    screen.getByRole('radio', { name: /balanced/i }).focus();
    await user.keyboard('{ArrowLeft}');

    const glanceable = screen.getByRole('radio', { name: /glanceable/i });
    expect(glanceable).toHaveAttribute('aria-checked', 'true');
    expect(glanceable).toHaveFocus();
  });

  it('treats ArrowDown/ArrowUp as forward/backward movement', async () => {
    const user = userEvent.setup();
    render(<DensityToggle />);

    // ArrowDown mirrors ArrowRight (forward): it must move selection AND focus
    // and persist the choice, not merely shift focus — assert all three so the
    // test discriminates a real selection change from a focus-only move.
    screen.getByRole('radio', { name: /balanced/i }).focus();
    await user.keyboard('{ArrowDown}');
    const glanceable = screen.getByRole('radio', { name: /glanceable/i });
    expect(glanceable).toHaveFocus();
    expect(glanceable).toHaveAttribute('aria-checked', 'true');
    expect(localStorage.getItem(DENSITY_KEY)).toBe('glanceable');

    await user.keyboard('{ArrowUp}');
    const balanced = screen.getByRole('radio', { name: /balanced/i });
    expect(balanced).toHaveFocus();
    expect(balanced).toHaveAttribute('aria-checked', 'true');
    expect(localStorage.getItem(DENSITY_KEY)).toBe('balanced');
  });

  it('jumps to the first and last option with Home and End', async () => {
    const user = userEvent.setup();
    render(<DensityToggle />);

    screen.getByRole('radio', { name: /balanced/i }).focus();
    await user.keyboard('{End}');
    expect(screen.getByRole('radio', { name: /glanceable/i })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('radio', { name: /glanceable/i })).toHaveFocus();

    await user.keyboard('{Home}');
    expect(screen.getByRole('radio', { name: /balanced/i })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('radio', { name: /balanced/i })).toHaveFocus();
  });

  it('activates the focused radio with Space and Enter via native button semantics', async () => {
    const user = userEvent.setup();
    render(<DensityToggle />);

    // The roving model leaves the unchecked radio at tabindex="-1"; it is still
    // focusable, and Space/Enter activate it through the underlying <button>.
    const glanceable = screen.getByRole('radio', { name: /glanceable/i });
    glanceable.focus();
    await user.keyboard(' ');
    expect(glanceable).toHaveAttribute('aria-checked', 'true');
    expect(localStorage.getItem(DENSITY_KEY)).toBe('glanceable');

    screen.getByRole('radio', { name: /balanced/i }).focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('radio', { name: /balanced/i })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(localStorage.getItem(DENSITY_KEY)).toBe('balanced');
  });

  it('leaves selection and focus untouched for keys outside the radio-group model', async () => {
    const user = userEvent.setup();
    render(<DensityToggle />);

    const balanced = screen.getByRole('radio', { name: /balanced/i });
    balanced.focus();
    await user.keyboard('a');

    expect(balanced).toHaveAttribute('aria-checked', 'true');
    expect(balanced).toHaveFocus();
  });
});
