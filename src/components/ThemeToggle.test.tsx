import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ThemeToggle } from './ThemeToggle';

const THEME_KEY = 'fleet:theme';

function stubMatchMedia(matches: boolean): void {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockReturnValue({
      matches,
      media: '(prefers-color-scheme: dark)',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  );
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove('dark');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  stubMatchMedia(false);
});

afterEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove('dark');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('ThemeToggle', () => {
  it('exposes an accessible radiogroup with the three theme choices', () => {
    render(<ThemeToggle />);
    const group = screen.getByRole('radiogroup', { name: /theme/i });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /light/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /dark/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /system/i })).toBeInTheDocument();
  });

  it('marks the stored choice as checked', () => {
    localStorage.setItem(THEME_KEY, 'dark');
    render(<ThemeToggle />);
    expect(screen.getByRole('radio', { name: /dark/i })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: /light/i })).toHaveAttribute('aria-checked', 'false');
  });

  it('defaults to System when nothing is stored', () => {
    render(<ThemeToggle />);
    expect(screen.getByRole('radio', { name: /system/i })).toHaveAttribute('aria-checked', 'true');
  });

  it('switches the theme, applies the class and persists on selection', async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);

    await user.click(screen.getByRole('radio', { name: /dark/i }));

    expect(screen.getByRole('radio', { name: /dark/i })).toHaveAttribute('aria-checked', 'true');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(localStorage.getItem(THEME_KEY)).toBe('dark');

    await user.click(screen.getByRole('radio', { name: /light/i }));

    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(localStorage.getItem(THEME_KEY)).toBe('light');
  });
});

describe('ThemeToggle — keyboard (WAI-ARIA radiogroup roving tabindex)', () => {
  it('keeps only the checked radio in the tab order', () => {
    localStorage.setItem(THEME_KEY, 'dark');
    render(<ThemeToggle />);
    expect(screen.getByRole('radio', { name: /dark/i })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('radio', { name: /light/i })).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('radio', { name: /system/i })).toHaveAttribute('tabindex', '-1');
  });

  it('moves selection and focus to the next option on ArrowRight, wrapping at the end', async () => {
    const user = userEvent.setup();
    localStorage.setItem(THEME_KEY, 'dark');
    render(<ThemeToggle />);

    screen.getByRole('radio', { name: /dark/i }).focus();
    await user.keyboard('{ArrowRight}');

    const system = screen.getByRole('radio', { name: /system/i });
    expect(system).toHaveAttribute('aria-checked', 'true');
    expect(system).toHaveFocus();
    expect(localStorage.getItem(THEME_KEY)).toBe('system');

    await user.keyboard('{ArrowRight}');
    const light = screen.getByRole('radio', { name: /light/i });
    expect(light).toHaveAttribute('aria-checked', 'true');
    expect(light).toHaveFocus();
  });

  it('moves selection and focus to the previous option on ArrowLeft, wrapping at the start', async () => {
    const user = userEvent.setup();
    localStorage.setItem(THEME_KEY, 'light');
    render(<ThemeToggle />);

    screen.getByRole('radio', { name: /light/i }).focus();
    await user.keyboard('{ArrowLeft}');

    const system = screen.getByRole('radio', { name: /system/i });
    expect(system).toHaveAttribute('aria-checked', 'true');
    expect(system).toHaveFocus();
  });

  it('treats ArrowDown/ArrowUp as forward/backward movement', async () => {
    const user = userEvent.setup();
    localStorage.setItem(THEME_KEY, 'light');
    render(<ThemeToggle />);

    screen.getByRole('radio', { name: /light/i }).focus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('radio', { name: /dark/i })).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(screen.getByRole('radio', { name: /light/i })).toHaveFocus();
  });

  it('jumps to the first and last option with Home and End', async () => {
    const user = userEvent.setup();
    localStorage.setItem(THEME_KEY, 'dark');
    render(<ThemeToggle />);

    screen.getByRole('radio', { name: /dark/i }).focus();
    await user.keyboard('{End}');
    expect(screen.getByRole('radio', { name: /system/i })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: /system/i })).toHaveFocus();

    await user.keyboard('{Home}');
    expect(screen.getByRole('radio', { name: /light/i })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: /light/i })).toHaveFocus();
  });

  it('leaves selection and focus untouched for keys outside the radio-group model', async () => {
    const user = userEvent.setup();
    localStorage.setItem(THEME_KEY, 'dark');
    render(<ThemeToggle />);

    const dark = screen.getByRole('radio', { name: /dark/i });
    dark.focus();
    await user.keyboard('a');

    expect(dark).toHaveAttribute('aria-checked', 'true');
    expect(dark).toHaveFocus();
  });
});
