import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { COMMAND_RECENTS_KEY } from './lib/command-recents';
import { forgetToken } from './lib/token-storage';
import { validateToken } from './lib/validate-token';
import { useRepos } from './hooks/useRepos';
import { useRepoSignals } from './hooks/useRepoSignals';
import type { GetRowData, Repo } from './types/fleet';
import { App } from './App';

vi.mock('./lib/validate-token', () => ({
  validateToken: vi.fn(),
}));

vi.mock('./hooks/useRepos', () => ({
  useRepos: vi.fn(),
}));

vi.mock('./hooks/useRepoSignals', () => ({
  useRepoSignals: vi.fn(),
}));

const mockValidate = vi.mocked(validateToken);
const mockUseRepos = vi.mocked(useRepos);
const mockUseRepoSignals = vi.mocked(useRepoSignals);
const getRowData: GetRowData = () => ({});

function repo(nameWithOwner: string): Repo {
  const slash = nameWithOwner.indexOf('/');
  return {
    nameWithOwner,
    owner: nameWithOwner.slice(0, slash),
    name: nameWithOwner.slice(slash + 1),
    isPrivate: false,
  };
}

beforeEach(() => {
  forgetToken();
  sessionStorage.clear();
  localStorage.clear();
  // Open authenticated sessions on the Grid view for a stable starting point.
  localStorage.setItem('fleet:default-view', 'grid');
  mockValidate.mockReset();
  mockUseRepos.mockReset();
  mockUseRepos.mockReturnValue({ status: 'success', repos: [], error: null, reload: vi.fn() });
  mockUseRepoSignals.mockReset();
  mockUseRepoSignals.mockReturnValue({ getRowData });
});

afterEach(() => {
  forgetToken();
  sessionStorage.clear();
  localStorage.clear();
});

async function authenticate(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  mockValidate.mockResolvedValue({ ok: true, login: 'octocat', avatarUrl: undefined });
  mockUseRepos.mockReturnValue({
    status: 'success',
    repos: [repo('octo/hello-world')],
    error: null,
    reload: vi.fn(),
  });
  await user.type(screen.getByLabelText(/personal access token/i), 'ghp_valid');
  await user.click(screen.getByRole('button', { name: /connect/i }));
  await screen.findByRole('group', { name: /view mode/i });
}

async function openPalette(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
  await user.keyboard('{Control>}k{/Control}');
  return screen.findByRole('dialog', { name: /command palette/i });
}

describe('App ⌘K command palette', () => {
  it('opens the command palette when ⌘K / Ctrl-K is pressed', async () => {
    const user = userEvent.setup();
    render(<App />);
    await authenticate(user);

    expect(screen.queryByRole('dialog', { name: /command palette/i })).toBeNull();

    await openPalette(user);

    expect(screen.getByRole('dialog', { name: /command palette/i })).toBeInTheDocument();
  });

  it('toggles the palette closed on a second ⌘K and on Escape', async () => {
    const user = userEvent.setup();
    render(<App />);
    await authenticate(user);

    await openPalette(user);
    await user.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: /command palette/i })).toBeNull(),
    );

    await openPalette(user);
    await user.keyboard('{Control>}k{/Control}');
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: /command palette/i })).toBeNull(),
    );
  });

  it('switches the active view when a navigation command is run', async () => {
    const user = userEvent.setup();
    render(<App />);
    await authenticate(user);

    const toggle = screen.getByRole('group', { name: /view mode/i });
    expect(within(toggle).getByRole('button', { name: /grid/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await openPalette(user);
    await user.type(screen.getByRole('combobox'), 'Go to Triage');
    await user.keyboard('{Enter}');

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: /command palette/i })).toBeNull(),
    );
    expect(within(toggle).getByRole('button', { name: /triage/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('activates a filter preset when a filter command is run', async () => {
    const user = userEvent.setup();
    render(<App />);
    await authenticate(user);

    const filterButton = screen.getByRole('button', { name: /filter repositories/i });
    expect(filterButton.getAttribute('aria-label')).toMatch(/all repositories/i);

    await openPalette(user);
    await user.type(screen.getByRole('combobox'), 'Failing CI');
    await user.keyboard('{Enter}');

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: /command palette/i })).toBeNull(),
    );
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /filter repositories/i }).getAttribute('aria-label'),
      ).toMatch(/1 filter/i);
    });
    // Discriminate that specifically the Failing CI filter is active by opening
    // the panel and verifying the active filter chip.
    await user.click(screen.getByRole('button', { name: /filter repositories/i }));
    expect(screen.getByRole('button', { name: /remove failing ci filter/i })).toBeInTheDocument();
  });

  it('opens the settings overlay from the "Open Settings" command', async () => {
    const user = userEvent.setup();
    render(<App />);
    await authenticate(user);

    await openPalette(user);
    await user.type(screen.getByRole('combobox'), 'Open Settings');
    await user.keyboard('{Enter}');

    expect(await screen.findByRole('dialog', { name: /settings/i })).toBeInTheDocument();
  });

  it('persists run commands to the recents store and surfaces them on reopen', async () => {
    const user = userEvent.setup();
    render(<App />);
    await authenticate(user);

    await openPalette(user);
    await user.type(screen.getByRole('combobox'), 'Go to Matrix');
    await user.keyboard('{Enter}');

    await waitFor(() => {
      const stored = localStorage.getItem(COMMAND_RECENTS_KEY);
      expect(stored).not.toBeNull();
      expect(stored).toContain('nav-matrix');
    });

    await openPalette(user);
    expect(screen.getByText('Recent')).toBeInTheDocument();
  });
});
