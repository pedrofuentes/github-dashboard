import { act, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RepoOwnerToggle } from './RepoOwnerToggle';
import { __resetRepoOwnerStoreForTests, useRepoOwner } from '../hooks/useRepoOwner';

const REPO_OWNER_KEY = 'fleet:repo-owner';

beforeEach(() => {
  localStorage.clear();
  __resetRepoOwnerStoreForTests();
  vi.restoreAllMocks();
});

afterEach(() => {
  localStorage.clear();
  __resetRepoOwnerStoreForTests();
  vi.restoreAllMocks();
});

describe('RepoOwnerToggle', () => {
  it('exposes an accessible radiogroup with the two repo-name choices', () => {
    render(<RepoOwnerToggle />);
    const group = screen.getByRole('radiogroup', { name: /repository names/i });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /show owner/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /name only/i })).toBeInTheDocument();
  });

  it('defaults to Show owner when nothing is stored', () => {
    render(<RepoOwnerToggle />);
    expect(screen.getByRole('radio', { name: /show owner/i })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('radio', { name: /name only/i })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  it('marks the stored choice as checked', () => {
    localStorage.setItem(REPO_OWNER_KEY, 'hide');
    render(<RepoOwnerToggle />);
    expect(screen.getByRole('radio', { name: /name only/i })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('radio', { name: /show owner/i })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  it('renders a redundant text label for every option (never colour alone)', () => {
    render(<RepoOwnerToggle />);
    expect(screen.getByText('Show owner')).toBeInTheDocument();
    expect(screen.getByText('Name only')).toBeInTheDocument();
  });

  it('exposes a visible focus ring on each option for keyboard users', () => {
    render(<RepoOwnerToggle />);
    expect(screen.getByRole('radio', { name: /show owner/i }).className).toMatch(
      /focus-visible:outline-focus/,
    );
  });

  it('selects and persists the display on click', async () => {
    const user = userEvent.setup();
    render(<RepoOwnerToggle />);

    await user.click(screen.getByRole('radio', { name: /name only/i }));

    expect(screen.getByRole('radio', { name: /name only/i })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(localStorage.getItem(REPO_OWNER_KEY)).toBe('hide');

    await user.click(screen.getByRole('radio', { name: /show owner/i }));

    expect(screen.getByRole('radio', { name: /show owner/i })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(localStorage.getItem(REPO_OWNER_KEY)).toBe('show');
  });

  it('reflects a live display update from another consumer of the shared store', () => {
    render(<RepoOwnerToggle />);
    expect(screen.getByRole('radio', { name: /show owner/i })).toHaveAttribute(
      'aria-checked',
      'true',
    );

    const hook = renderHook(() => useRepoOwner());
    act(() => {
      hook.result.current.setDisplay('hide');
    });

    expect(screen.getByRole('radio', { name: /name only/i })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('radio', { name: /show owner/i })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });
});

describe('RepoOwnerToggle — keyboard (WAI-ARIA radiogroup roving tabindex)', () => {
  it('keeps only the checked radio in the tab order', () => {
    localStorage.setItem(REPO_OWNER_KEY, 'hide');
    render(<RepoOwnerToggle />);
    expect(screen.getByRole('radio', { name: /name only/i })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('radio', { name: /show owner/i })).toHaveAttribute('tabindex', '-1');
  });

  it('moves selection and focus to the next option on ArrowRight, wrapping at the end', async () => {
    const user = userEvent.setup();
    render(<RepoOwnerToggle />); // defaults to show (the first option)

    screen.getByRole('radio', { name: /show owner/i }).focus();
    await user.keyboard('{ArrowRight}');

    const nameOnly = screen.getByRole('radio', { name: /name only/i });
    expect(nameOnly).toHaveAttribute('aria-checked', 'true');
    expect(nameOnly).toHaveFocus();
    expect(localStorage.getItem(REPO_OWNER_KEY)).toBe('hide');

    // Wrapping: ArrowRight from the last option returns to the first.
    await user.keyboard('{ArrowRight}');
    const showOwner = screen.getByRole('radio', { name: /show owner/i });
    expect(showOwner).toHaveAttribute('aria-checked', 'true');
    expect(showOwner).toHaveFocus();
    expect(localStorage.getItem(REPO_OWNER_KEY)).toBe('show');
  });

  it('moves selection and focus to the previous option on ArrowLeft, wrapping at the start', async () => {
    const user = userEvent.setup();
    render(<RepoOwnerToggle />); // show (first) — ArrowLeft wraps to the last

    screen.getByRole('radio', { name: /show owner/i }).focus();
    await user.keyboard('{ArrowLeft}');

    const nameOnly = screen.getByRole('radio', { name: /name only/i });
    expect(nameOnly).toHaveAttribute('aria-checked', 'true');
    expect(nameOnly).toHaveFocus();
  });

  it('treats ArrowDown/ArrowUp as forward/backward movement', async () => {
    const user = userEvent.setup();
    render(<RepoOwnerToggle />);

    screen.getByRole('radio', { name: /show owner/i }).focus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('radio', { name: /name only/i })).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(screen.getByRole('radio', { name: /show owner/i })).toHaveFocus();
  });

  it('jumps to the first and last option with Home and End', async () => {
    const user = userEvent.setup();
    render(<RepoOwnerToggle />);

    screen.getByRole('radio', { name: /show owner/i }).focus();
    await user.keyboard('{End}');
    expect(screen.getByRole('radio', { name: /name only/i })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('radio', { name: /name only/i })).toHaveFocus();

    await user.keyboard('{Home}');
    expect(screen.getByRole('radio', { name: /show owner/i })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('radio', { name: /show owner/i })).toHaveFocus();
  });

  it('activates the focused radio with Space and Enter via native button semantics', async () => {
    const user = userEvent.setup();
    render(<RepoOwnerToggle />);

    // The roving model leaves the unchecked radio at tabindex="-1"; it is still
    // focusable, and Space/Enter activate it through the underlying <button>.
    const nameOnly = screen.getByRole('radio', { name: /name only/i });
    nameOnly.focus();
    await user.keyboard(' ');
    expect(nameOnly).toHaveAttribute('aria-checked', 'true');
    expect(localStorage.getItem(REPO_OWNER_KEY)).toBe('hide');

    screen.getByRole('radio', { name: /show owner/i }).focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('radio', { name: /show owner/i })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(localStorage.getItem(REPO_OWNER_KEY)).toBe('show');
  });

  it('leaves selection and focus untouched for keys outside the radio-group model', async () => {
    const user = userEvent.setup();
    render(<RepoOwnerToggle />);

    const showOwner = screen.getByRole('radio', { name: /show owner/i });
    showOwner.focus();
    await user.keyboard('a');

    expect(showOwner).toHaveAttribute('aria-checked', 'true');
    expect(showOwner).toHaveFocus();
  });
});
