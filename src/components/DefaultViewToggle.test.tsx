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

  it('exposes a visible focus ring on each option for keyboard users', () => {
    render(<DefaultViewToggle value="dashboard" onChange={vi.fn()} />);
    expect(screen.getByRole('radio', { name: /grid/i }).className).toMatch(
      /focus-visible:outline-focus/,
    );
  });

  it('calls onChange with the chosen view when a radio is clicked', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<DefaultViewToggle value="dashboard" onChange={onChange} />);
    await user.click(screen.getByRole('radio', { name: /inbox/i }));
    expect(onChange).toHaveBeenCalledWith('inbox');
  });
});
