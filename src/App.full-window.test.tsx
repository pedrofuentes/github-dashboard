import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { validateToken } from './lib/validate-token';
import { forgetToken } from './lib/token-storage';
import { useRepos } from './hooks/useRepos';
import { useRepoSignals } from './hooks/useRepoSignals';
import { __resetDeckTileSizeStoreForTests } from './hooks/useDeckTileSize';
import type { GetRowData, Repo } from './types/fleet';
import { App } from './App';

vi.mock('./lib/validate-token', () => ({ validateToken: vi.fn() }));
vi.mock('./hooks/useRepos', () => ({ useRepos: vi.fn() }));
vi.mock('./hooks/useRepoSignals', () => ({ useRepoSignals: vi.fn() }));
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
  __resetDeckTileSizeStoreForTests();
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

async function authenticate(
  user: ReturnType<typeof userEvent.setup>,
  repos: Repo[],
): Promise<void> {
  mockValidate.mockResolvedValue({ ok: true, login: 'octocat', avatarUrl: undefined });
  mockUseRepos.mockReturnValue({ status: 'success', repos, error: null, reload: vi.fn() });
  await user.type(screen.getByLabelText(/personal access token/i), 'ghp_valid');
  await user.click(screen.getByRole('button', { name: /connect/i }));
  await screen.findByRole('group', { name: /view mode/i });
}

describe('App — full-window mode', () => {
  it('enters an immersive overlay that hides the toolbar', async () => {
    localStorage.setItem('fleet:default-view', 'matrix');
    const user = userEvent.setup();
    render(<App />);
    await authenticate(user, [repo('octo/a')]);

    expect(screen.queryByRole('region', { name: /full window/i })).toBeNull();

    await user.click(screen.getByRole('button', { name: /^full window/i }));

    expect(screen.getByRole('region', { name: /matrix.*full window/i })).toBeInTheDocument();
    // The chrome (view switcher) is hidden in full-window.
    expect(screen.queryByRole('group', { name: /view mode/i })).toBeNull();
  });

  it('exits full-window via the Exit button', async () => {
    localStorage.setItem('fleet:default-view', 'matrix');
    const user = userEvent.setup();
    render(<App />);
    await authenticate(user, [repo('octo/a')]);

    await user.click(screen.getByRole('button', { name: /^full window/i }));
    await user.click(screen.getByRole('button', { name: /exit full window/i }));

    expect(screen.queryByRole('region', { name: /full window/i })).toBeNull();
    expect(screen.getByRole('group', { name: /view mode/i })).toBeInTheDocument();
  });

  it('exits full-window with the Escape key', async () => {
    localStorage.setItem('fleet:default-view', 'matrix');
    const user = userEvent.setup();
    render(<App />);
    await authenticate(user, [repo('octo/a')]);

    await user.click(screen.getByRole('button', { name: /^full window/i }));
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('region', { name: /full window/i })).toBeNull();
    expect(screen.getByRole('group', { name: /view mode/i })).toBeInTheDocument();
  });

  it('surfaces the deck size control inside the full-window bar on the Deck', async () => {
    localStorage.setItem('fleet:default-view', 'deck');
    const user = userEvent.setup();
    render(<App />);
    await authenticate(user, [repo('octo/a')]);
    await screen.findByRole('region', { name: /repository board/i });

    await user.click(screen.getByRole('button', { name: /^full window/i }));

    const overlay = screen.getByRole('region', { name: /deck.*full window/i });
    expect(within(overlay).getByRole('radiogroup', { name: /tile size/i })).toBeInTheDocument();
  });
});
