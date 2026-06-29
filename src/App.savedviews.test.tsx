import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

function repo(nameWithOwner: string): Repo {
  const slash = nameWithOwner.indexOf('/');
  return {
    nameWithOwner,
    owner: nameWithOwner.slice(0, slash),
    name: nameWithOwner.slice(slash + 1),
    isPrivate: false,
  };
}

// One repo has a failing CI signal so the "Failing CI" preset narrows the fleet.
const getRowData: GetRowData = (target) =>
  target.nameWithOwner === 'octo/broken'
    ? { ci: { status: 'ready', conclusion: 'failure' } }
    : { ci: { status: 'ready', conclusion: 'success' } };

beforeEach(() => {
  forgetToken();
  sessionStorage.clear();
  localStorage.clear();
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
    repos: [repo('octo/broken'), repo('octo/healthy')],
    error: null,
    reload: vi.fn(),
  });
  await user.type(screen.getByLabelText(/personal access token/i), 'ghp_valid');
  await user.click(screen.getByRole('button', { name: /connect/i }));
  await screen.findByRole('group', { name: /view mode/i });
}

describe('App Saved Views integration', () => {
  it('mounts the Saved Views control in the toolbar', async () => {
    const user = userEvent.setup();
    render(<App />);
    await authenticate(user);

    expect(screen.getByRole('button', { name: /saved views/i })).toBeInTheDocument();
  });

  it('applies a preset: switches to matrix and activates the filter', async () => {
    const user = userEvent.setup();
    render(<App />);
    await authenticate(user);

    const toggle = screen.getByRole('group', { name: /view mode/i });
    expect(within(toggle).getByRole('button', { name: /grid/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await user.click(screen.getByRole('button', { name: /saved views/i }));
    await user.click(screen.getByRole('button', { name: /apply preset failing ci/i }));

    await waitFor(() =>
      expect(within(toggle).getByRole('button', { name: /matrix/i })).toHaveAttribute(
        'aria-pressed',
        'true',
      ),
    );
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /filter repositories/i }).getAttribute('aria-label'),
      ).toMatch(/1 repo/),
    );
  });

  it('saves the current scope as a new user view that then appears in the menu', async () => {
    const user = userEvent.setup();
    render(<App />);
    await authenticate(user);

    await user.click(screen.getByRole('button', { name: /saved views/i }));
    await user.type(screen.getByLabelText(/name this view/i), 'My workspace');
    await user.click(screen.getByRole('button', { name: /^save current as view$/i }));

    const savedList = await screen.findByRole('list', { name: /saved views/i });
    expect(within(savedList).getByText('My workspace')).toBeInTheDocument();
  });
});
