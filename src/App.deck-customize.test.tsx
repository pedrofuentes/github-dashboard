import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { validateToken } from './lib/validate-token';
import { forgetToken } from './lib/token-storage';
import { useRepos } from './hooks/useRepos';
import { useRepoSignals } from './hooks/useRepoSignals';
import type { GetRowData, Repo, RepoSignalData } from './types/fleet';
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
const erroredCiRowData: GetRowData = (): RepoSignalData => ({
  ci: { status: 'error' },
  security: { status: 'ready', grade: 'A' },
  reviews: { status: 'ready', requestedCount: 0 },
  pullRequests: { status: 'ready', openCount: 0 },
  issues: { status: 'ready', openCount: 0 },
  stale: { status: 'ready', staleCount: 0 },
});

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

/** Authenticates and navigates to the Deck view. */
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

describe('App — Deck per-tile customize wiring', () => {
  it('shows the "Customize tiles" toggle only in the Deck view', async () => {
    const user = userEvent.setup();
    render(<App />);
    await authenticateOnDeck(user, [repo('octo/a')]);

    // Toggle is present in Deck view.
    expect(screen.getByRole('button', { name: /customize tiles/i })).toBeInTheDocument();

    // Switch to Boards view — the deck toggle must disappear.
    await user.click(screen.getByRole('button', { name: /boards/i }));
    await screen.findByRole('region', { name: /dashboard/i });
    expect(screen.queryByRole('button', { name: /customize tiles/i })).toBeNull();
  });

  it('opens the DeckCustomizePanel dialog when "Customize tiles" is clicked', async () => {
    const user = userEvent.setup();
    render(<App />);
    await authenticateOnDeck(user, [repo('octo/a')]);

    expect(screen.queryByRole('dialog', { name: /customize deck/i })).toBeNull();
    await user.click(screen.getByRole('button', { name: /customize tiles/i }));
    expect(screen.getByRole('dialog', { name: /customize deck/i })).toBeInTheDocument();
  });

  it('removes a tile from the live Deck grid via the inline ✕ and persists it', async () => {
    const user = userEvent.setup();
    render(<App />);
    await authenticateOnDeck(user, [repo('octo/a')]);

    // Enter edit mode.
    await user.click(screen.getByRole('button', { name: /customize tiles/i }));

    // The inline remove button for CI on octo/a must be present.
    const removeBtn = screen.getByRole('button', { name: /remove ci tile for octo\/a/i });
    expect(removeBtn).toBeInTheDocument();

    // Click the remove button.
    await user.click(removeBtn);

    // The remove button is gone from the grid.
    expect(screen.queryByRole('button', { name: /remove ci tile for octo\/a/i })).toBeNull();

    // The key is persisted to localStorage.
    const stored = JSON.parse(localStorage.getItem('fleet:deck-hidden') ?? '[]') as string[];
    expect(stored).toContain('octo/a:ci');
  });

  it('hides a signal across all repos from the panel', async () => {
    const repos = [repo('octo/a'), repo('octo/b')];
    const user = userEvent.setup();
    render(<App />);
    await authenticateOnDeck(user, repos);

    // Open the customize panel.
    await user.click(screen.getByRole('button', { name: /customize tiles/i }));
    expect(screen.getByRole('dialog', { name: /customize deck/i })).toBeInTheDocument();

    // Click the per-signal "Hide all CI keys" button in the panel.
    await user.click(screen.getByRole('button', { name: /hide all ci keys/i }));

    // Both repos' CI remove buttons are gone from the board (CI keys hidden).
    expect(screen.queryByRole('button', { name: /remove ci tile for octo\/a/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /remove ci tile for octo\/b/i })).toBeNull();

    // Persistence reflects both keys hidden.
    const stored = JSON.parse(localStorage.getItem('fleet:deck-hidden') ?? '[]') as string[];
    expect(stored).toContain('octo/a:ci');
    expect(stored).toContain('octo/b:ci');
  });

  it('resets Deck edit mode when navigating away from the Deck view', async () => {
    const user = userEvent.setup();
    render(<App />);
    await authenticateOnDeck(user, [repo('octo/a')]);

    // Enter Deck edit mode — the customize panel opens.
    await user.click(screen.getByRole('button', { name: /customize tiles/i }));
    expect(screen.getByRole('dialog', { name: /customize deck/i })).toBeInTheDocument();

    // Navigate away to Boards, then back to the Deck.
    await user.click(screen.getByRole('button', { name: /boards/i }));
    await screen.findByRole('region', { name: /dashboard/i });
    await user.click(screen.getByRole('button', { name: /deck/i }));
    await screen.findByRole('region', { name: /repository board/i });

    // Edit mode must have reset: panel closed, toggle back to "Customize tiles",
    // and no inline remove overlay on the board.
    expect(screen.queryByRole('dialog', { name: /customize deck/i })).toBeNull();
    expect(screen.getByRole('button', { name: /customize tiles/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /remove ci tile for octo\/a/i })).toBeNull();
  });
});

describe('App — Deck scoped retry wiring', () => {
  it('retries one errored Deck tile through the scoped signal retry instead of reloading repos', async () => {
    const user = userEvent.setup();
    const repos = [repo('octo/a')];
    const reload = vi.fn();
    const retrySignal = vi.fn();
    mockUseRepoSignals.mockReturnValue({ getRowData: erroredCiRowData, retrySignal });
    mockUseRepos.mockReturnValue({ status: 'success', repos, error: null, reload });

    render(<App />);
    await authenticateOnDeck(user, repos);

    await user.click(screen.getByRole('button', { name: 'Retry CI for octo/a' }));

    expect(retrySignal).toHaveBeenCalledTimes(1);
    expect(retrySignal).toHaveBeenCalledWith(repos[0], 'ci');
    expect(reload).not.toHaveBeenCalled();
  });

  it('gates Deck row reordering when a repo filter is active (no grips, hint shown)', async () => {
    const user = userEvent.setup();
    render(<App />);
    await authenticateOnDeck(user, [repo('octo/a'), repo('octo/b')]);

    // Enter Customize: both repo rows expose a reorder grip.
    await user.click(screen.getByRole('button', { name: /customize tiles/i }));
    expect(screen.getByRole('button', { name: /reorder octo\/a/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reorder octo\/b/i })).toBeInTheDocument();

    // Activate a repo filter narrowing the fleet to octo/a.
    await user.click(screen.getByRole('button', { name: /filter repositories/i }));
    await user.click(screen.getByRole('option', { name: /octo\/a/i }));

    // Reordering must be gated while filtered (a subset cannot persist into the
    // full-fleet order): no grips, and the hint explains how to re-enable it.
    expect(screen.queryByRole('button', { name: /reorder octo\/a/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /reorder octo\/b/i })).toBeNull();
    expect(screen.getByText(/clear the filter to reorder/i)).toBeInTheDocument();
  });
});
