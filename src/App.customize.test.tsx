import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { validateToken } from './lib/validate-token';
import { forgetToken } from './lib/token-storage';
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

// Activity tiles self-fetch via `useCommitActivity` (which reads the auth
// context); stub it so the dashboard grid mounts deterministically.
vi.mock('./hooks/useCommitActivity', () => ({
  useCommitActivity: vi.fn(() => ({ state: 'empty' })),
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

/** Authenticates and lands on the (factory-default) Dashboard view. */
async function authenticateOnDashboard(
  user: ReturnType<typeof userEvent.setup>,
  repos: Repo[],
): Promise<void> {
  mockValidate.mockResolvedValue({ ok: true, login: 'octocat', avatarUrl: undefined });
  mockUseRepos.mockReturnValue({ status: 'success', repos, error: null, reload: vi.fn() });
  await user.type(screen.getByLabelText(/personal access token/i), 'ghp_valid');
  await user.click(screen.getByRole('button', { name: /connect/i }));
  await screen.findByRole('group', { name: /view mode/i });
  await user.click(screen.getByRole('button', { name: /dashboard/i }));
  await screen.findByRole('region', { name: /dashboard/i });
}

describe('App — customize + repo-filter wiring (C1)', () => {
  it('offers the repo-scope filter in the dashboard display mode', async () => {
    const user = userEvent.setup();
    render(<App />);
    await authenticateOnDashboard(user, [repo('octo/a')]);

    // The faceted repo-filter disclosure is available without entering edit mode.
    expect(screen.getByRole('button', { name: /filter repositories/i })).toBeInTheDocument();
  });

  it('reveals the CustomizePanel dialog when "Customize layout" is opened', async () => {
    const user = userEvent.setup();
    render(<App />);
    await authenticateOnDashboard(user, [repo('octo/a')]);

    expect(screen.queryByRole('dialog', { name: /customize dashboard/i })).toBeNull();
    await user.click(screen.getByRole('button', { name: /customize layout/i }));
    expect(screen.getByRole('dialog', { name: /customize dashboard/i })).toBeInTheDocument();
  });

  it('keeps the CustomizePanel mounted when every tile is hidden (recovery stays reachable)', async () => {
    const user = userEvent.setup();
    render(<App />);
    await authenticateOnDashboard(user, [repo('octo/a')]);

    await user.click(screen.getByRole('button', { name: /customize layout/i }));
    // Hide every tile via the panel's bulk "Hide all tiles" rule action.
    await user.click(screen.getByRole('button', { name: /^hide all tiles$/i }));

    // The dashboard collapses to the all-hidden recovery copy …
    expect(screen.getByText(/all tiles hidden/i)).toBeInTheDocument();
    // … but the panel (an App sibling, not a DashboardView child) is still mounted.
    expect(screen.getByRole('dialog', { name: /customize dashboard/i })).toBeInTheDocument();
  });

  it('toggling a tile OFF in the panel removes it from the live dashboard grid (shared layout)', async () => {
    const user = userEvent.setup();
    render(<App />);
    await authenticateOnDashboard(user, [repo('octo/a')]);

    await user.click(screen.getByRole('button', { name: /customize layout/i }));

    // The CI tile is in the live grid before toggling.
    expect(screen.getByRole('button', { name: /ci: .*octo\/a/i })).toBeInTheDocument();

    // Hide the CI tile via the panel's per-repo override (surfaced by search).
    await user.type(screen.getByRole('textbox', { name: /search repositories/i }), 'octo/a');
    await user.click(screen.getByRole('checkbox', { name: /octo\/a, ci tile/i }));

    // It disappears from the rendered DashboardView grid — proving App passes ONE
    // shared useDashboardLayout instance to both surfaces (red-team B-1 desync).
    expect(screen.queryByRole('button', { name: /ci: .*octo\/a/i })).toBeNull();
  });
});
