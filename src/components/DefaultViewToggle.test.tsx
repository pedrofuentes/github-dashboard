import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { DefaultViewToggle } from './DefaultViewToggle';

describe('DefaultViewToggle', () => {
  it('exposes an accessible "Default view" radiogroup with the three choices', () => {
    render(<DefaultViewToggle value="dashboard" onChange={vi.fn()} />);
    const group = screen.getByRole('radiogroup', { name: /default view/i });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /grid/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /dashboard/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /inbox/i })).toBeInTheDocument();
  });

  it('marks the passed value as the checked default', () => {
    render(<DefaultViewToggle value="inbox" onChange={vi.fn()} />);
    expect(screen.getByRole('radio', { name: /inbox/i })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: /grid/i })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('radio', { name: /dashboard/i })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  it('renders a redundant text label for every option (never colour alone)', () => {
    render(<DefaultViewToggle value="dashboard" onChange={vi.fn()} />);
    expect(screen.getByText('Grid')).toBeInTheDocument();
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Inbox')).toBeInTheDocument();
  });

  it.each([/grid/i, /dashboard/i, /inbox/i])(
    'exposes a visible focus ring on the %s option for keyboard users',
    (name) => {
      render(<DefaultViewToggle value="dashboard" onChange={vi.fn()} />);
      expect(screen.getByRole('radio', { name }).className).toMatch(/focus-visible:outline-focus/);
    },
  );

  it.each([
    { name: /grid/i, expected: 'grid' as const },
    { name: /dashboard/i, expected: 'dashboard' as const },
    { name: /inbox/i, expected: 'inbox' as const },
  ])('calls onChange with $expected when that radio is clicked', async ({ name, expected }) => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    // `value="grid"` so the grid click re-selects the already-active radio while
    // dashboard/inbox are genuine changes; the toggle calls `onChange`
    // unconditionally, so every option — re-select included — reports its value.
    render(<DefaultViewToggle value="grid" onChange={onChange} />);
    await user.click(screen.getByRole('radio', { name }));
    expect(onChange).toHaveBeenCalledWith(expected);
  });
});
