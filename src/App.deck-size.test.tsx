import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { validateToken } from './lib/validate-token';
import { forgetToken } from './lib/token-storage';
import { useRepos } from './hooks/useRepos';
import { useRepoSignals } from './hooks/useRepoSignals';
import { __resetDeckTileSizeStoreForTests } from './hooks/useDeckTileSize';
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
  mockUseRepos.mockReturnValue({
    status: 'success',
    repos: [],
    error: null,
    statusHint: false,
    reload: vi.fn(),
  });
  mockUseRepoSignals.mockReset();
  mockUseRepoSignals.mockReturnValue({ getRowData });
});

afterEach(() => {
  forgetToken();
  sessionStorage.clear();
  localStorage.clear();
});

async function authenticateOnDeck(
  user: ReturnType<typeof userEvent.setup>,
  repos: Repo[],
): Promise<void> {
  mockValidate.mockResolvedValue({ ok: true, login: 'octocat', avatarUrl: undefined });
  mockUseRepos.mockReturnValue({
    status: 'success',
    repos,
    error: null,
    statusHint: false,
    reload: vi.fn(),
  });
  await user.type(screen.getByLabelText(/personal access token/i), 'ghp_valid');
  await user.click(screen.getByRole('button', { name: /connect/i }));
  await screen.findByRole('group', { name: /view mode/i });
  await user.click(screen.getByRole('button', { name: /deck/i }));
  await screen.findByRole('region', { name: /repository board/i });
}

describe('App — Deck tile-size wiring', () => {
  it('shows the tile-size control only in the Deck view', async () => {
    const user = userEvent.setup();
    render(<App />);
    await authenticateOnDeck(user, [repo('octo/a')]);

    expect(screen.getByRole('radiogroup', { name: /tile size/i })).toBeInTheDocument();

    // Switch to Boards — the deck-only size control disappears.
    await user.click(screen.getByRole('button', { name: /boards/i }));
    await screen.findByRole('region', { name: /dashboard/i });
    expect(screen.queryByRole('radiogroup', { name: /tile size/i })).toBeNull();
  });

  it('renders the Deck full-bleed (uncapped) so blocks center, but caps other views', async () => {
    const user = userEvent.setup();
    render(<App />);
    await authenticateOnDeck(user, [repo('octo/a')]);

    const main = document.getElementById('main-content');
    expect(main?.className).not.toContain('max-w-5xl');

    await user.click(screen.getByRole('button', { name: /boards/i }));
    await screen.findByRole('region', { name: /dashboard/i });
    expect(document.getElementById('main-content')?.className).toContain('max-w-5xl');
  });

  it('keeps the full-bleed Deck toolbar in a centered max-w-5xl column (aligned with the header)', async () => {
    const user = userEvent.setup();
    render(<App />);
    await authenticateOnDeck(user, [repo('octo/a')]);

    // On the uncapped Deck, main is full-bleed — so the toolbar must live in its
    // own max-w-5xl wrapper (not main) to stay aligned with the header column
    // instead of orphaning to the window's left edge.
    const group = screen.getByRole('group', { name: /view mode/i });
    const main = document.getElementById('main-content');
    expect(main?.className).not.toContain('max-w-5xl');
    const capped = group.closest('.max-w-5xl');
    expect(capped).not.toBeNull();
    expect(capped).not.toBe(main);

    // On a capped view (Boards) there is no extra wrapper: the toolbar's only
    // max-w-5xl ancestor is main itself.
    await user.click(screen.getByRole('button', { name: /boards/i }));
    await screen.findByRole('region', { name: /dashboard/i });
    const cappedMain = document.getElementById('main-content');
    expect(screen.getByRole('group', { name: /view mode/i }).closest('.max-w-5xl')).toBe(
      cappedMain,
    );
  });

  it('resizes the live Deck grid when a new size is chosen', async () => {
    const user = userEvent.setup();
    render(<App />);
    await authenticateOnDeck(user, [repo('octo/a')]);

    const board = screen.getByRole('region', { name: /repository board/i });
    const gridOf = (): HTMLElement => {
      const row = board.querySelector<HTMLElement>('[data-repo-row]');
      if (!row) {
        throw new Error('deck repo row not found');
      }
      return row;
    };

    // Default medium.
    expect(gridOf().style.gridTemplateColumns).toBe('repeat(6, 152px)');

    await user.click(screen.getByRole('radio', { name: /large/i }));

    expect(gridOf().style.gridTemplateColumns).toBe('repeat(6, 192px)');
    expect(localStorage.getItem('fleet:deck-tile-size')).toBe('large');
  });
});
