import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { validateToken } from './lib/validate-token';
import { forgetToken } from './lib/token-storage';
import { useRepos } from './hooks/useRepos';
import { useRepoSignals } from './hooks/useRepoSignals';
import { useDeckOrder } from './hooks/useDeckOrder';
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

vi.mock('./hooks/useDeckOrder', () => ({
  useDeckOrder: vi.fn(),
}));

// Replace the @dnd-kit-driven surfaces with light doubles that fire the reorder
// callbacks directly. Real pointer/keyboard drag is unreliable in jsdom (see
// DeckSignalOrderList), and this suite only needs each callback to fire so the
// App-level guard runs against a throwing mutator.
vi.mock('./components/board/BoardView', () => ({
  BoardView: ({ onMoveRepo }: { onMoveRepo?: (from: number, to: number) => void }) => (
    <section aria-label="Repository board">
      <button type="button" onClick={() => onMoveRepo?.(0, 1)}>
        fire move repo
      </button>
    </section>
  ),
}));

vi.mock('./components/board/DeckCustomizePanel', () => ({
  DeckCustomizePanel: ({ onMoveSignal }: { onMoveSignal: (from: number, to: number) => void }) => (
    <button type="button" onClick={() => onMoveSignal(0, 1)}>
      fire move signal
    </button>
  ),
}));

const mockValidate = vi.mocked(validateToken);
const mockUseRepos = vi.mocked(useRepos);
const mockUseRepoSignals = vi.mocked(useRepoSignals);
const mockUseDeckOrder = vi.mocked(useDeckOrder);
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

function deckOrder(overrides: {
  moveRepo: (from: number, to: number) => void;
  moveSignal: (from: number, to: number) => void;
}): ReturnType<typeof useDeckOrder> {
  return {
    repoOrder: ['octo/a'],
    signalOrder: [],
    reset: vi.fn(),
    ...overrides,
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
  mockUseDeckOrder.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
  forgetToken();
  sessionStorage.clear();
  localStorage.clear();
});

async function authenticateOnDeck(
  user: ReturnType<typeof userEvent.setup>,
  repos: Repo[],
): Promise<void> {
  mockValidate.mockResolvedValue({ ok: true, login: 'octocat', avatarUrl: undefined });
  mockUseRepos.mockReturnValue({ status: 'success', repos, error: null, reload: vi.fn() });
  await user.type(screen.getByLabelText(/personal access token/i), 'ghp_valid');
  await user.click(screen.getByRole('button', { name: /connect/i }));
  await screen.findByRole('group', { name: /view mode/i });
  await user.click(screen.getByRole('button', { name: /deck/i }));
  await screen.findByRole('region', { name: /repository board/i });
}

describe('App — Deck reorder guards (#668)', () => {
  it('swallows a thrown signal reorder and warns instead of tearing down the board', async () => {
    const moveSignal = vi.fn(() => {
      throw new Error('signal reorder boom');
    });
    mockUseDeckOrder.mockReturnValue(deckOrder({ moveRepo: vi.fn(), moveSignal }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const user = userEvent.setup();
    render(<App />);
    await authenticateOnDeck(user, [repo('octo/a')]);

    // Enter edit mode so the (mocked) customize panel — and its trigger — mount.
    await user.click(screen.getByRole('button', { name: /customize tiles/i }));
    await user.click(screen.getByRole('button', { name: /fire move signal/i }));

    expect(moveSignal).toHaveBeenCalledWith(0, 1);
    expect(warn).toHaveBeenCalled();
    // The board is still mounted: the guard degraded the move to a no-op.
    expect(screen.getByRole('region', { name: /repository board/i })).toBeInTheDocument();
  });

  it('swallows a thrown repo reorder and warns instead of tearing down the board', async () => {
    const moveRepo = vi.fn(() => {
      throw new Error('repo reorder boom');
    });
    mockUseDeckOrder.mockReturnValue(deckOrder({ moveRepo, moveSignal: vi.fn() }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const user = userEvent.setup();
    render(<App />);
    await authenticateOnDeck(user, [repo('octo/a')]);

    await user.click(screen.getByRole('button', { name: /fire move repo/i }));

    expect(moveRepo).toHaveBeenCalledWith(0, 1);
    expect(warn).toHaveBeenCalled();
    expect(screen.getByRole('region', { name: /repository board/i })).toBeInTheDocument();
  });
});
