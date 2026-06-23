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

describe('App keyboard shortcuts', () => {
  it('opens the shortcuts help overlay when "?" is pressed', async () => {
    const user = userEvent.setup();
    render(<App />);
    await authenticate(user);

    expect(screen.queryByRole('dialog', { name: /keyboard shortcuts/i })).toBeNull();

    await user.keyboard('?');

    expect(await screen.findByRole('dialog', { name: /keyboard shortcuts/i })).toBeInTheDocument();
  });

  it('switches the view to Inbox via the "g i" sequence', async () => {
    const user = userEvent.setup();
    render(<App />);
    await authenticate(user);

    const toggle = screen.getByRole('group', { name: /view mode/i });
    expect(within(toggle).getByRole('button', { name: /grid/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await user.keyboard('gi');

    await waitFor(() =>
      expect(within(toggle).getByRole('button', { name: /inbox/i })).toHaveAttribute(
        'aria-pressed',
        'true',
      ),
    );
  });

  it('does not change the view while typing "g i" inside the repo-filter search input', async () => {
    const user = userEvent.setup();
    render(<App />);
    await authenticate(user);

    const toggle = screen.getByRole('group', { name: /view mode/i });
    await user.click(screen.getByRole('button', { name: /filter repositories/i }));
    const search = await screen.findByRole('combobox', { name: /search repositories/i });
    search.focus();

    await user.type(search, 'gi');

    expect(within(toggle).getByRole('button', { name: /grid/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(toggle).getByRole('button', { name: /inbox/i })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });
});
