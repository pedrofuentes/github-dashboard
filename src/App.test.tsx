import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { forgetToken } from './lib/token-storage';
import { validateToken } from './lib/validate-token';
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

const mockValidate = vi.mocked(validateToken);
const mockUseRepos = vi.mocked(useRepos);
const mockUseRepoSignals = vi.mocked(useRepoSignals);
const getRowData: GetRowData = () => ({});

const CI_TIMESTAMP = '2026-06-20T12:00:00.000Z';

// A fleet seam that yields exactly one (unread) failing-CI inbox item per repo,
// so the lifted useInbox produces a deterministic fleet-wide unread count.
const getRowDataWithFailingCi: GetRowData = (target: Repo): RepoSignalData => ({
  ci: {
    status: 'ready',
    conclusion: 'failure',
    runId: 42,
    updatedAt: CI_TIMESTAMP,
    latestRunUrl: `https://github.com/${target.nameWithOwner}/actions/runs/42`,
  },
});

function repo(nameWithOwner: string, isPrivate = false): Repo {
  const slash = nameWithOwner.indexOf('/');
  return {
    nameWithOwner,
    owner: nameWithOwner.slice(0, slash),
    name: nameWithOwner.slice(slash + 1),
    isPrivate,
  };
}

beforeEach(() => {
  forgetToken();
  sessionStorage.clear();
  localStorage.clear();
  mockValidate.mockReset();
  mockUseRepos.mockReset();
  mockUseRepos.mockReturnValue({
    status: 'success',
    repos: [],
    error: null,
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

describe('App', () => {
  it('renders the dashboard heading', () => {
    render(<App />);

    expect(screen.getByRole('heading', { level: 1, name: 'github-dashboard' })).toBeInTheDocument();
  });

  it('renders a main landmark for accessibility', () => {
    render(<App />);

    expect(screen.getByRole('main')).toBeInTheDocument();
  });

  it('exposes a top-level banner landmark that holds the dashboard heading', () => {
    render(<App />);

    const banner = screen.getByRole('banner');
    expect(banner).toBeInTheDocument();
    expect(
      within(banner).getByRole('heading', { level: 1, name: 'github-dashboard' }),
    ).toBeInTheDocument();
    // The banner must NOT be nested inside the main landmark (else it is not a banner).
    expect(screen.getByRole('main')).not.toContainElement(banner);
  });

  it('offers a skip-to-content link that targets the focusable main region', () => {
    render(<App />);

    const skipLink = screen.getByRole('link', { name: /skip to main content/i });
    expect(skipLink).toHaveAttribute('href', '#main-content');

    const main = screen.getByRole('main');
    expect(main).toHaveAttribute('id', 'main-content');
    // tabIndex=-1 lets the skip link move keyboard focus into <main> programmatically.
    expect(main).toHaveAttribute('tabindex', '-1');
  });

  it('shows the token input when unauthenticated', () => {
    render(<App />);

    expect(screen.getByLabelText(/personal access token/i)).toBeInTheDocument();
  });

  it('shows the authenticated identity and a forget control after sign-in', async () => {
    mockValidate.mockResolvedValue({
      ok: true,
      login: 'octocat',
      avatarUrl: 'https://avatars.githubusercontent.com/u/1',
    });
    const user = userEvent.setup();
    render(<App />);

    await user.type(screen.getByLabelText(/personal access token/i), 'ghp_valid');
    await user.click(screen.getByRole('button', { name: /connect/i }));

    expect(await screen.findByText(/authenticated as octocat/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /forget token/i })).toBeInTheDocument();
  });

  it('renders a neutral placeholder without an external image when the avatar is dropped', async () => {
    mockValidate.mockResolvedValue({ ok: true, login: 'octocat', avatarUrl: undefined });
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.type(screen.getByLabelText(/personal access token/i), 'ghp_valid');
    await user.click(screen.getByRole('button', { name: /connect/i }));

    expect(await screen.findByText(/authenticated as octocat/i)).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
  });

  it('renders the fleet grid for the authenticated user', async () => {
    mockValidate.mockResolvedValue({ ok: true, login: 'octocat', avatarUrl: undefined });
    mockUseRepos.mockReturnValue({
      status: 'success',
      repos: [repo('octo/hello-world'), repo('octo/secret', true)],
      error: null,
      reload: vi.fn(),
    });
    const user = userEvent.setup();
    render(<App />);

    await user.type(screen.getByLabelText(/personal access token/i), 'ghp_valid');
    await user.click(screen.getByRole('button', { name: /connect/i }));

    expect(await screen.findByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /repository/i })).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: /octo\/hello-world/i })).toBeInTheDocument();
  });

  it('passes the authenticated token to the repo data hook', async () => {
    mockValidate.mockResolvedValue({ ok: true, login: 'octocat', avatarUrl: undefined });
    const user = userEvent.setup();
    render(<App />);

    await user.type(screen.getByLabelText(/personal access token/i), 'ghp_valid');
    await user.click(screen.getByRole('button', { name: /connect/i }));

    await screen.findByText(/authenticated as octocat/i);
    expect(mockUseRepos).toHaveBeenCalledWith('ghp_valid');
  });

  it('opens an origin-validated drill-down dialog when a repo row is activated', async () => {
    mockValidate.mockResolvedValue({ ok: true, login: 'octocat', avatarUrl: undefined });
    mockUseRepos.mockReturnValue({
      status: 'success',
      repos: [repo('octo/hello-world')],
      error: null,
      reload: vi.fn(),
    });
    const user = userEvent.setup();
    render(<App />);

    await user.type(screen.getByLabelText(/personal access token/i), 'ghp_valid');
    await user.click(screen.getByRole('button', { name: /connect/i }));
    await screen.findByRole('table');

    expect(screen.queryByRole('dialog')).toBeNull();

    const trigger = screen.getByRole('button', { name: /view details for octo\/hello-world/i });
    await user.click(trigger);

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(within(dialog).getByRole('link', { name: 'octo/hello-world' })).toHaveAttribute(
      'href',
      'https://github.com/octo/hello-world',
    );

    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(trigger).toHaveFocus();
  });

  async function authenticateWithRepos(
    user: ReturnType<typeof userEvent.setup>,
    repos: Repo[],
  ): Promise<void> {
    mockValidate.mockResolvedValue({ ok: true, login: 'octocat', avatarUrl: undefined });
    mockUseRepos.mockReturnValue({ status: 'success', repos, error: null, reload: vi.fn() });
    await user.type(screen.getByLabelText(/personal access token/i), 'ghp_valid');
    await user.click(screen.getByRole('button', { name: /connect/i }));
    await screen.findByText(/authenticated as octocat/i);
  }

  it('offers an accessible Grid/Dashboard view toggle once authenticated', async () => {
    const user = userEvent.setup();
    render(<App />);
    await authenticateWithRepos(user, [repo('octo/hello-world')]);

    const toggle = screen.getByRole('group', { name: /view/i });
    expect(within(toggle).getByRole('button', { name: /grid/i })).toBeInTheDocument();
    expect(within(toggle).getByRole('button', { name: /dashboard/i })).toBeInTheDocument();
  });

  it('defaults to the grid (table) view', async () => {
    const user = userEvent.setup();
    render(<App />);
    await authenticateWithRepos(user, [repo('octo/hello-world')]);

    expect(await screen.findByRole('table')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /dashboard/i })).toBeNull();
  });

  it('switches between the grid and dashboard views', async () => {
    const user = userEvent.setup();
    render(<App />);
    await authenticateWithRepos(user, [repo('octo/hello-world')]);
    await screen.findByRole('table');

    await user.click(screen.getByRole('button', { name: /dashboard/i }));
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByRole('region', { name: /dashboard/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /grid/i }));
    expect(await screen.findByRole('table')).toBeInTheDocument();
  });

  it('persists the selected view', async () => {
    const user = userEvent.setup();
    render(<App />);
    await authenticateWithRepos(user, [repo('octo/hello-world')]);

    await user.click(screen.getByRole('button', { name: /dashboard/i }));
    expect(localStorage.getItem('fleet:view')).toBe('dashboard');
  });

  it('starts in the dashboard view when it was previously persisted', async () => {
    localStorage.setItem('fleet:view', 'dashboard');
    const user = userEvent.setup();
    render(<App />);
    await authenticateWithRepos(user, [repo('octo/hello-world')]);

    expect(await screen.findByRole('region', { name: /dashboard/i })).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('opens the drill-down drawer from a dashboard tile', async () => {
    const user = userEvent.setup();
    render(<App />);
    await authenticateWithRepos(user, [repo('octo/hello-world')]);
    await screen.findByRole('table');

    await user.click(screen.getByRole('button', { name: /dashboard/i }));
    const tile = screen.getAllByRole('button', {
      name: /view .* details for octo\/hello-world/i,
    })[0];
    await user.click(tile);

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  it('does not offer the customize-layout control in the grid view', async () => {
    const user = userEvent.setup();
    render(<App />);
    await authenticateWithRepos(user, [repo('octo/hello-world')]);

    expect(await screen.findByRole('table')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /customize layout/i })).toBeNull();
  });

  it('offers an accessible customize-layout toggle only in the dashboard view', async () => {
    const user = userEvent.setup();
    render(<App />);
    await authenticateWithRepos(user, [repo('octo/hello-world')]);
    await screen.findByRole('table');

    await user.click(screen.getByRole('button', { name: /dashboard/i }));

    const customize = screen.getByRole('button', { name: /customize layout/i });
    expect(customize).toHaveAttribute('aria-pressed', 'false');

    // Returning to the grid hides the control again.
    await user.click(screen.getByRole('button', { name: /grid/i }));
    expect(screen.queryByRole('button', { name: /customize layout/i })).toBeNull();
  });

  it('enables drag + resize on the dashboard when customize layout is toggled on', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    await authenticateWithRepos(user, [repo('octo/hello-world')]);
    await screen.findByRole('table');

    await user.click(screen.getByRole('button', { name: /dashboard/i }));
    // Static before editing.
    expect(container.querySelector('.react-grid-item.react-draggable')).toBeNull();

    const customize = screen.getByRole('button', { name: /customize layout/i });
    await user.click(customize);

    expect(customize).toHaveAttribute('aria-pressed', 'true');
    expect(container.querySelector('.react-grid-item.react-draggable')).not.toBeNull();
  });

  async function authenticate(user: ReturnType<typeof userEvent.setup>): Promise<void> {
    mockValidate.mockResolvedValue({ ok: true, login: 'octocat', avatarUrl: undefined });
    await user.type(screen.getByLabelText(/personal access token/i), 'ghp_valid');
    await user.click(screen.getByRole('button', { name: /connect/i }));
    await screen.findByText(/authenticated as octocat/i);
  }

  it('shows a loading skeleton in the dashboard view while repos load', async () => {
    localStorage.setItem('fleet:view', 'dashboard');
    mockUseRepos.mockReturnValue({
      status: 'loading',
      repos: [],
      error: null,
      reload: vi.fn(),
    });
    const user = userEvent.setup();
    const { container } = render(<App />);
    await authenticate(user);

    expect(screen.getByRole('region', { name: /dashboard/i })).toBeInTheDocument();
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.queryByText(/no repositories to display/i)).toBeNull();
  });

  it('shows an error + retry in the dashboard view and calls reload on retry', async () => {
    localStorage.setItem('fleet:view', 'dashboard');
    const reload = vi.fn();
    mockUseRepos.mockReturnValue({
      status: 'error',
      repos: [],
      error: 'Could not load your repositories.',
      reload,
    });
    const user = userEvent.setup();
    render(<App />);
    await authenticate(user);

    expect(screen.getByRole('alert')).toHaveTextContent('Could not load your repositories.');
    await user.click(screen.getByRole('button', { name: /retry/i }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  function viewToggle(): HTMLElement {
    return screen.getByRole('group', { name: /view/i });
  }

  function inboxToggleButton(): HTMLElement {
    return within(viewToggle()).getByRole('button', { name: /inbox/i });
  }

  it('offers a third Inbox option in the view toggle (AC-15)', async () => {
    const user = userEvent.setup();
    render(<App />);
    await authenticateWithRepos(user, [repo('octo/hello-world')]);

    const toggle = viewToggle();
    expect(within(toggle).getByRole('button', { name: /grid/i })).toBeInTheDocument();
    expect(within(toggle).getByRole('button', { name: /dashboard/i })).toBeInTheDocument();
    expect(within(toggle).getByRole('button', { name: /inbox/i })).toBeInTheDocument();
  });

  it('renders the inbox view and hides the grid when Inbox is selected (AC-15)', async () => {
    const user = userEvent.setup();
    render(<App />);
    await authenticateWithRepos(user, [repo('octo/hello-world')]);
    await screen.findByRole('table');

    await user.click(inboxToggleButton());

    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByRole('region', { name: /notifications inbox/i })).toBeInTheDocument();
  });

  it('persists the inbox view selection under fleet:view (AC-15)', async () => {
    const user = userEvent.setup();
    render(<App />);
    await authenticateWithRepos(user, [repo('octo/hello-world')]);

    await user.click(inboxToggleButton());
    expect(localStorage.getItem('fleet:view')).toBe('inbox');
  });

  it('starts in the inbox view when it was previously persisted (AC-15)', async () => {
    localStorage.setItem('fleet:view', 'inbox');
    const user = userEvent.setup();
    render(<App />);
    await authenticateWithRepos(user, [repo('octo/hello-world')]);

    expect(await screen.findByRole('region', { name: /notifications inbox/i })).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('surfaces the fleet-wide unread count as an accessible badge on the Inbox toggle (AC-16)', async () => {
    mockUseRepoSignals.mockReturnValue({ getRowData: getRowDataWithFailingCi });
    const user = userEvent.setup();
    render(<App />);
    await authenticateWithRepos(user, [repo('octo/one'), repo('octo/two')]);

    // Two repos, one failing-CI item each → 2 unread, shown as a number (not colour alone).
    const inboxButton = inboxToggleButton();
    expect(inboxButton).toHaveTextContent('2');
    expect(inboxButton).toHaveAccessibleName(/unread/i);
  });

  it('shares a single inbox instance so dismissing in the view updates the toggle badge (AC-16)', async () => {
    mockUseRepoSignals.mockReturnValue({ getRowData: getRowDataWithFailingCi });
    const user = userEvent.setup();
    render(<App />);
    await authenticateWithRepos(user, [repo('octo/one'), repo('octo/two')]);
    await screen.findByRole('table');

    expect(inboxToggleButton()).toHaveTextContent('2');

    await user.click(inboxToggleButton());
    const dismissButtons = await screen.findAllByRole('button', { name: /dismiss/i });
    await user.click(dismissButtons[0]);

    // One shared useInbox: dismissing an item in the view drops the badge 2 → 1.
    await waitFor(() => expect(inboxToggleButton()).toHaveTextContent('1'));
  });

  it('advances the last-visited watermark when the inbox is opened (AC-16)', async () => {
    const seeded = '2024-01-01T00:00:00.000Z';
    localStorage.setItem(
      'fleet:inbox-triage',
      JSON.stringify({ readIds: [], dismissedIds: [], lastVisitedAt: seeded }),
    );
    mockUseRepoSignals.mockReturnValue({ getRowData: getRowDataWithFailingCi });
    const user = userEvent.setup();
    render(<App />);
    await authenticateWithRepos(user, [repo('octo/one')]);
    await screen.findByRole('table');

    await user.click(inboxToggleButton());

    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem('fleet:inbox-triage') ?? '{}') as {
        lastVisitedAt: string | null;
      };
      expect(typeof stored.lastVisitedAt).toBe('string');
      expect(Date.parse(stored.lastVisitedAt as string)).toBeGreaterThan(Date.parse(seeded));
    });
  });
});
