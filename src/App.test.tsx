import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadInboxTriage } from './lib/inbox/triage-store';
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

// A fully-loaded fleet seam that yields exactly one (unread) failing-CI inbox
// item per repo, so the lifted useInbox produces a deterministic fleet-wide
// unread count. Every signal slice is settled (the non-CI slices resolve empty),
// so each repo counts as fully resolved and the watermark may advance on open.
const getRowDataWithFailingCi: GetRowData = (target: Repo): RepoSignalData => ({
  ci: {
    status: 'ready',
    conclusion: 'failure',
    runId: 42,
    updatedAt: CI_TIMESTAMP,
    latestRunUrl: `https://github.com/${target.nameWithOwner}/actions/runs/42`,
  },
  security: { status: 'ready' },
  reviews: { status: 'ready' },
  pullRequests: { status: 'ready' },
  issues: { status: 'ready' },
  stale: { status: 'ready' },
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

  it('exposes a Settings button that opens an overlay with the appearance controls', async () => {
    const user = userEvent.setup();
    render(<App />);

    // The scattered theme/density controls are no longer directly in the header.
    expect(screen.queryByRole('radiogroup', { name: /theme/i })).toBeNull();
    expect(screen.queryByRole('radiogroup', { name: /density/i })).toBeNull();

    const settings = screen.getByRole('button', { name: /settings/i });
    expect(settings).toHaveAttribute('aria-haspopup', 'dialog');
    expect(settings).toHaveAttribute('aria-expanded', 'false');

    await user.click(settings);

    const dialog = await screen.findByRole('dialog', { name: /settings/i });
    expect(settings).toHaveAttribute('aria-expanded', 'true');
    expect(within(dialog).getByRole('radiogroup', { name: /theme/i })).toBeInTheDocument();
    expect(within(dialog).getByRole('radiogroup', { name: /density/i })).toBeInTheDocument();
  });

  it('closes the settings overlay on Escape and returns focus to the Settings button', async () => {
    const user = userEvent.setup();
    render(<App />);

    const settings = screen.getByRole('button', { name: /settings/i });
    await user.click(settings);
    await screen.findByRole('dialog', { name: /settings/i });

    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(settings).toHaveFocus();
    expect(settings).toHaveAttribute('aria-expanded', 'false');
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

  it('shows the authenticated identity and a forget control in the settings overlay after sign-in', async () => {
    mockValidate.mockResolvedValue({
      ok: true,
      login: 'octocat',
      avatarUrl: 'https://avatars.githubusercontent.com/u/1',
    });
    const user = userEvent.setup();
    render(<App />);

    await user.type(screen.getByLabelText(/personal access token/i), 'ghp_valid');
    await user.click(screen.getByRole('button', { name: /connect/i }));
    await screen.findByRole('group', { name: /view mode/i });

    await user.click(screen.getByRole('button', { name: /settings/i }));
    const dialog = await screen.findByRole('dialog', { name: /settings/i });
    expect(within(dialog).getByText(/authenticated as octocat/i)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /forget token/i })).toBeInTheDocument();
  });

  it('renders a neutral placeholder without an external image when the avatar is dropped', async () => {
    mockValidate.mockResolvedValue({ ok: true, login: 'octocat', avatarUrl: undefined });
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.type(screen.getByLabelText(/personal access token/i), 'ghp_valid');
    await user.click(screen.getByRole('button', { name: /connect/i }));
    await screen.findByRole('group', { name: /view mode/i });

    await user.click(screen.getByRole('button', { name: /settings/i }));
    const dialog = await screen.findByRole('dialog', { name: /settings/i });
    expect(within(dialog).getByText(/authenticated as octocat/i)).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
  });

  it('renders the fleet grid for the authenticated user', async () => {
    localStorage.setItem('fleet:default-view', 'grid');
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

    await screen.findByRole('group', { name: /view mode/i });
    expect(mockUseRepos).toHaveBeenCalledWith('ghp_valid');
  });

  it('opens an origin-validated drill-down dialog when a repo row is activated', async () => {
    localStorage.setItem('fleet:default-view', 'grid');
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
    await screen.findByRole('group', { name: /view mode/i });
  }

  it('offers an accessible Grid/Dashboard view toggle once authenticated', async () => {
    const user = userEvent.setup();
    render(<App />);
    await authenticateWithRepos(user, [repo('octo/hello-world')]);

    const toggle = screen.getByRole('group', { name: /view/i });
    expect(within(toggle).getByRole('button', { name: /grid/i })).toBeInTheDocument();
    expect(within(toggle).getByRole('button', { name: /boards/i })).toBeInTheDocument();
  });

  it('labels the demoted RGL view "Boards" (not "Dashboard") and places it after Matrix/Grid', async () => {
    const user = userEvent.setup();
    render(<App />);
    await authenticateWithRepos(user, [repo('octo/hello-world')]);

    const toggle = screen.getByRole('group', { name: /view/i });
    const boards = within(toggle).getByRole('button', { name: /boards/i });
    expect(boards).toBeInTheDocument();
    expect(within(toggle).queryByRole('button', { name: /^dashboard$/i })).toBeNull();

    // Secondary, not the default: ordered after Matrix and Grid.
    const labels = within(toggle)
      .getAllByRole('button')
      .map((button) => button.textContent ?? '');
    expect(labels.indexOf('Boards')).toBeGreaterThan(labels.indexOf('Matrix'));
    expect(labels.indexOf('Boards')).toBeGreaterThan(labels.indexOf('Grid'));
  });

  it('renders the RGL grid when the Boards view is selected', async () => {
    localStorage.setItem('fleet:default-view', 'grid');
    const user = userEvent.setup();
    render(<App />);
    await authenticateWithRepos(user, [repo('octo/hello-world')]);
    await screen.findByRole('table');

    await user.click(screen.getByRole('button', { name: /boards/i }));
    expect(await screen.findByRole('grid')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('renders the dashboard view when configured as the default (AC1)', async () => {
    localStorage.setItem('fleet:default-view', 'dashboard');
    const user = userEvent.setup();
    render(<App />);
    await authenticateWithRepos(user, [repo('octo/hello-world')]);

    expect(await screen.findByRole('region', { name: /dashboard/i })).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('switches between the grid and dashboard views', async () => {
    localStorage.setItem('fleet:default-view', 'grid');
    const user = userEvent.setup();
    render(<App />);
    await authenticateWithRepos(user, [repo('octo/hello-world')]);
    await screen.findByRole('table');

    await user.click(screen.getByRole('button', { name: /boards/i }));
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByRole('region', { name: /dashboard/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /grid/i }));
    expect(await screen.findByRole('table')).toBeInTheDocument();
  });

  it('does not persist an in-session view switch under fleet:view (AC6)', async () => {
    const user = userEvent.setup();
    render(<App />);
    await authenticateWithRepos(user, [repo('octo/hello-world')]);

    await user.click(screen.getByRole('button', { name: /grid/i }));
    expect(await screen.findByRole('table')).toBeInTheDocument();
    expect(localStorage.getItem('fleet:view')).toBeNull();
  });

  it('opens to the dashboard view when configured as default (AC1)', async () => {
    localStorage.setItem('fleet:default-view', 'dashboard');
    const user = userEvent.setup();
    render(<App />);
    await authenticateWithRepos(user, [repo('octo/hello-world')]);

    expect(await screen.findByRole('region', { name: /dashboard/i })).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('opens the drill-down drawer from a dashboard tile', async () => {
    localStorage.setItem('fleet:default-view', 'grid');
    const user = userEvent.setup();
    render(<App />);
    await authenticateWithRepos(user, [repo('octo/hello-world')]);
    await screen.findByRole('table');

    await user.click(screen.getByRole('button', { name: /boards/i }));
    const tile = screen.getAllByRole('button', {
      name: /: .*\u2014 octo\/hello-world/i,
    })[0];
    await user.click(tile);

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  it('does not offer the customize-layout control in the grid view', async () => {
    localStorage.setItem('fleet:default-view', 'grid');
    const user = userEvent.setup();
    render(<App />);
    await authenticateWithRepos(user, [repo('octo/hello-world')]);

    expect(await screen.findByRole('table')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /customize layout/i })).toBeNull();
  });

  it('offers an accessible customize-layout toggle only in the dashboard view', async () => {
    localStorage.setItem('fleet:default-view', 'grid');
    const user = userEvent.setup();
    render(<App />);
    await authenticateWithRepos(user, [repo('octo/hello-world')]);
    await screen.findByRole('table');

    await user.click(screen.getByRole('button', { name: /boards/i }));

    const customize = screen.getByRole('button', { name: /customize layout/i });
    expect(customize).toHaveAttribute('aria-pressed', 'false');

    // Returning to the grid hides the control again.
    await user.click(screen.getByRole('button', { name: /grid/i }));
    expect(screen.queryByRole('button', { name: /customize layout/i })).toBeNull();
  });

  it('enables drag + resize on the dashboard when customize layout is toggled on', async () => {
    localStorage.setItem('fleet:default-view', 'grid');
    const user = userEvent.setup();
    const { container } = render(<App />);
    await authenticateWithRepos(user, [repo('octo/hello-world')]);
    await screen.findByRole('table');

    await user.click(screen.getByRole('button', { name: /boards/i }));
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
    await screen.findByRole('group', { name: /view mode/i });
  }

  it('shows a loading skeleton in the dashboard view while repos load', async () => {
    localStorage.setItem('fleet:default-view', 'dashboard');
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
    localStorage.setItem('fleet:default-view', 'dashboard');
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
    expect(within(toggle).getByRole('button', { name: /boards/i })).toBeInTheDocument();
    expect(within(toggle).getByRole('button', { name: /inbox/i })).toBeInTheDocument();
  });

  it('renders the inbox view and hides the grid when Inbox is selected (AC-15)', async () => {
    localStorage.setItem('fleet:default-view', 'grid');
    const user = userEvent.setup();
    render(<App />);
    await authenticateWithRepos(user, [repo('octo/hello-world')]);
    await screen.findByRole('table');

    await user.click(inboxToggleButton());

    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByRole('region', { name: /notifications inbox/i })).toBeInTheDocument();
  });

  it('does not persist an in-session inbox switch under fleet:view (AC6)', async () => {
    const user = userEvent.setup();
    render(<App />);
    await authenticateWithRepos(user, [repo('octo/hello-world')]);

    await user.click(inboxToggleButton());
    expect(localStorage.getItem('fleet:view')).toBeNull();
  });

  it('opens to the configured default view (inbox) (AC1/AC5)', async () => {
    localStorage.setItem('fleet:default-view', 'inbox');
    const user = userEvent.setup();
    render(<App />);
    await authenticateWithRepos(user, [repo('octo/hello-world')]);

    expect(await screen.findByRole('region', { name: /notifications inbox/i })).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('switching the default view persists fleet:default-view and switches the live view (AC5)', async () => {
    const user = userEvent.setup();
    render(<App />);
    await authenticateWithRepos(user, [repo('octo/hello-world')]);

    await user.click(screen.getByRole('button', { name: /settings/i }));
    const dialog = await screen.findByRole('dialog', { name: /settings/i });
    const defaultGroup = within(dialog).getByRole('radiogroup', { name: /default view/i });
    await user.click(within(defaultGroup).getByRole('radio', { name: /inbox/i }));

    expect(localStorage.getItem('fleet:default-view')).toBe('inbox');
    expect(screen.getByRole('region', { name: /notifications inbox/i })).toBeInTheDocument();
  });

  it('resets the live view to the configured default after forget + re-auth (no reload)', async () => {
    const user = userEvent.setup();
    render(<App />);
    await authenticateWithRepos(user, [repo('octo/hello-world')]);

    // The session opens on the configured default (Triage).
    expect(await screen.findByRole('region', { name: /triage/i })).toBeInTheDocument();

    // Switch the live view away from the default via the ViewToggle.
    await user.click(within(viewToggle()).getByRole('button', { name: /grid/i }));
    expect(await screen.findByRole('table')).toBeInTheDocument();

    // Forget the token (sign out) from the Settings overlay — no page reload.
    await user.click(screen.getByRole('button', { name: /settings/i }));
    const dialog = await screen.findByRole('dialog', { name: /settings/i });
    await user.click(within(dialog).getByRole('button', { name: /forget token/i }));

    // Back to the unauthenticated token input; close the overlay and re-auth.
    await user.click(screen.getByRole('button', { name: /close settings/i }));
    await authenticateWithRepos(user, [repo('octo/hello-world')]);

    // The new session must open on the configured DEFAULT (Triage), not the
    // previously-selected Grid view.
    expect(await screen.findByRole('region', { name: /triage/i })).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('ignores a legacy fleet:view value on load (AC7)', async () => {
    localStorage.setItem('fleet:view', 'inbox');
    const user = userEvent.setup();
    render(<App />);
    await authenticateWithRepos(user, [repo('octo/hello-world')]);

    expect(await screen.findByRole('region', { name: /triage/i })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /notifications inbox/i })).toBeNull();
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
    localStorage.setItem('fleet:default-view', 'grid');
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
    localStorage.setItem('fleet:default-view', 'grid');
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

  it('keeps persisted triage when the inbox opens before per-repo signals load (AC-16)', async () => {
    // Regression for the triage-wipe: landing on the persisted Inbox view must not
    // GC read/dismissed marks against the transiently-empty live set produced while
    // the per-repo signals are still loading (the repo list resolved, signals not).
    const seeded = '2024-01-01T00:00:00.000Z';
    localStorage.setItem('fleet:default-view', 'inbox');
    localStorage.setItem(
      'fleet:inbox-triage',
      JSON.stringify({
        readIds: ['ci:octo/one:42'],
        dismissedIds: ['ci:octo/two:7'],
        lastVisitedAt: seeded,
      }),
    );

    // Signals start UNloaded: the repo list has resolved but every repo's slices
    // are still absent, so deriveInboxItems is transiently empty (liveIds === []).
    mockUseRepoSignals.mockReturnValue({ getRowData: () => ({}) });
    const user = userEvent.setup();
    const { rerender } = render(<App />);
    await authenticateWithRepos(user, [repo('octo/one'), repo('octo/two')]);
    await screen.findByRole('region', { name: /notifications inbox/i });

    // The per-repo signals now fully settle: each repo resolves every slice —
    // including a failing-CI slice whose derived id matches a seeded triage id
    // (run 42 → octo/one, run 7 → octo/two) — so the fleet is fully resolved and
    // both seeded ids are live once loading completes.
    const getRowDataLoaded: GetRowData = (target: Repo): RepoSignalData => ({
      ci: {
        status: 'ready',
        conclusion: 'failure',
        runId: target.nameWithOwner === 'octo/two' ? 7 : 42,
        updatedAt: CI_TIMESTAMP,
        latestRunUrl: `https://github.com/${target.nameWithOwner}/actions/runs/1`,
      },
      security: { status: 'ready' },
      reviews: { status: 'ready' },
      pullRequests: { status: 'ready' },
      issues: { status: 'ready' },
      stale: { status: 'ready' },
    });
    mockUseRepoSignals.mockReturnValue({ getRowData: getRowDataLoaded });
    rerender(<App />);

    // The seeded marks must SURVIVE the visit (not be wiped during the load window),
    // while the watermark still advances once the signals have settled.
    await waitFor(() => {
      const stored = loadInboxTriage();
      expect(stored.readIds).toContain('ci:octo/one:42');
      expect(stored.dismissedIds).toContain('ci:octo/two:7');
      expect(stored.lastVisitedAt).not.toBeNull();
      expect(Date.parse(stored.lastVisitedAt as string)).toBeGreaterThan(Date.parse(seeded));
    });
  });

  it('keeps persisted triage when the inbox opens while a slower signal slice is still loading (AC-16)', async () => {
    // Residual regression for the PARTIAL-signal-load triage wipe: a repo whose
    // `ci` slice settles first must NOT count as "resolved" while its `security`
    // / `reviews` / `stale` slices are still loading. Counting it resolved on the
    // first settled slice advances the watermark and prunes the seeded
    // read/dismissed ids that belong to those not-yet-live slices — silently
    // wiping a dismissed security alert and a read stale item. Triage must
    // survive the partial-load window and settle only once EVERY slice has loaded.
    const seeded = '2024-01-01T00:00:00.000Z';
    localStorage.setItem('fleet:default-view', 'inbox');
    localStorage.setItem(
      'fleet:inbox-triage',
      JSON.stringify({
        readIds: ['stale:octo/one:issue:#9'],
        dismissedIds: ['security:octo/one:dependabot:5'],
        lastVisitedAt: seeded,
      }),
    );

    // Partial load: the `ci` slice has settled (ready) but `security`, `reviews`
    // and `stale` are still loading, so deriveInboxItems only emits the CI item —
    // the seeded security/stale ids are NOT yet in the live set. With `.some` this
    // repo is wrongly "resolved" (ci settled), so markAllSeen runs and prunes them.
    const getRowDataPartial: GetRowData = (target: Repo): RepoSignalData => ({
      ci: {
        status: 'ready',
        conclusion: 'failure',
        runId: 42,
        updatedAt: CI_TIMESTAMP,
        latestRunUrl: `https://github.com/${target.nameWithOwner}/actions/runs/42`,
      },
      security: { status: 'loading' },
      reviews: { status: 'loading' },
      stale: { status: 'loading' },
    });
    mockUseRepoSignals.mockReturnValue({ getRowData: getRowDataPartial });

    const user = userEvent.setup();
    const { rerender } = render(<App />);
    await authenticateWithRepos(user, [repo('octo/one')]);
    await screen.findByRole('region', { name: /notifications inbox/i });

    // During the partial-load window the watermark must NOT advance and the
    // seeded slow-slice ids must SURVIVE (under `.some` the settled `ci` slice
    // wrongly resolves the repo, markAllSeen runs and GCs them against the
    // transiently-incomplete live set).
    const duringLoad = loadInboxTriage();
    expect(duringLoad.dismissedIds).toContain('security:octo/one:dependabot:5');
    expect(duringLoad.readIds).toContain('stale:octo/one:issue:#9');
    expect(duringLoad.lastVisitedAt).toBe(seeded);

    // Every remaining slice now settles, so each seeded id maps to a live item
    // (alert #5 → the security id, issue #9 → the stale id) and the repo is fully
    // resolved across all slices.
    const getRowDataLoaded: GetRowData = (target: Repo): RepoSignalData => ({
      ci: {
        status: 'ready',
        conclusion: 'failure',
        runId: 42,
        updatedAt: CI_TIMESTAMP,
        latestRunUrl: `https://github.com/${target.nameWithOwner}/actions/runs/42`,
      },
      security: {
        status: 'ready',
        alerts: [
          {
            number: 5,
            type: 'dependabot',
            severity: 'high',
            html_url: `https://github.com/${target.nameWithOwner}/security/dependabot/5`,
            created_at: CI_TIMESTAMP,
          },
        ],
      },
      reviews: { status: 'ready' },
      pullRequests: { status: 'ready' },
      issues: { status: 'ready' },
      stale: {
        status: 'ready',
        staleItems: [
          {
            number: 9,
            type: 'issue',
            title: 'Stale issue',
            html_url: `https://github.com/${target.nameWithOwner}/issues/9`,
            updated_at: CI_TIMESTAMP,
          },
        ],
      },
    });
    mockUseRepoSignals.mockReturnValue({ getRowData: getRowDataLoaded });
    rerender(<App />);

    // Only now (every slice settled) does the watermark advance — and the seeded
    // ids still survive because they are live once their slices loaded.
    await waitFor(() => {
      const stored = loadInboxTriage();
      expect(stored.dismissedIds).toContain('security:octo/one:dependabot:5');
      expect(stored.readIds).toContain('stale:octo/one:issue:#9');
      expect(stored.lastVisitedAt).not.toBeNull();
      expect(Date.parse(stored.lastVisitedAt as string)).toBeGreaterThan(Date.parse(seeded));
    });
  });

  function matrixToggleButton(): HTMLElement {
    return within(viewToggle()).getByRole('button', { name: /matrix/i });
  }

  it('offers a Matrix option in the view toggle', async () => {
    const user = userEvent.setup();
    render(<App />);
    await authenticateWithRepos(user, [repo('octo/hello-world')]);

    expect(matrixToggleButton()).toBeInTheDocument();
  });

  it('falls back to the triage view when no default is stored', async () => {
    const user = userEvent.setup();
    render(<App />);
    await authenticateWithRepos(user, [repo('octo/hello-world')]);

    expect(await screen.findByRole('region', { name: /triage/i })).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: /fleet matrix/i })).toBeNull();
    expect(screen.queryByRole('region', { name: /dashboard/i })).toBeNull();
  });

  it('honours a persisted default over the matrix fallback', async () => {
    localStorage.setItem('fleet:default-view', 'dashboard');
    const user = userEvent.setup();
    render(<App />);
    await authenticateWithRepos(user, [repo('octo/hello-world')]);

    expect(await screen.findByRole('region', { name: /dashboard/i })).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: /fleet matrix/i })).toBeNull();
  });

  it('renders the fleet matrix and hides the dashboard when Matrix is selected', async () => {
    localStorage.setItem('fleet:default-view', 'dashboard');
    mockUseRepoSignals.mockReturnValue({ getRowData: getRowDataWithFailingCi });
    const user = userEvent.setup();
    render(<App />);
    await authenticateWithRepos(user, [repo('octo/hello-world')]);
    await screen.findByRole('region', { name: /dashboard/i });

    await user.click(matrixToggleButton());

    expect(screen.getByRole('table', { name: /fleet matrix/i })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /repository/i })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /view details for octo\/hello-world/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /dashboard/i })).toBeNull();
  });

  it('narrows the matrix rows via the faceted repo filter', async () => {
    localStorage.setItem('fleet:default-view', 'matrix');
    mockUseRepoSignals.mockReturnValue({ getRowData: getRowDataWithFailingCi });
    const user = userEvent.setup();
    render(<App />);
    await authenticateWithRepos(user, [repo('octo/alpha'), repo('octo/beta')]);
    await screen.findByRole('table', { name: /fleet matrix/i });

    expect(
      screen.getByRole('button', { name: /view details for octo\/alpha/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /view details for octo\/beta/i }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /filter repositories/i }));
    const search = await screen.findByRole('combobox', { name: /search repositories/i });
    await user.type(search, 'alpha');

    expect(
      screen.getByRole('button', { name: /view details for octo\/alpha/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /view details for octo\/beta/i })).toBeNull();
  });

  it('opens the drill-down drawer from a matrix row', async () => {
    localStorage.setItem('fleet:default-view', 'matrix');
    mockUseRepoSignals.mockReturnValue({ getRowData: getRowDataWithFailingCi });
    const user = userEvent.setup();
    render(<App />);
    await authenticateWithRepos(user, [repo('octo/hello-world')]);
    await screen.findByRole('table', { name: /fleet matrix/i });

    await user.click(screen.getByRole('button', { name: /view details for octo\/hello-world/i }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  function triageToggleButton(): HTMLElement {
    return within(viewToggle()).getByRole('button', { name: /triage/i });
  }

  it('offers a Triage option listed first in the view toggle', async () => {
    const user = userEvent.setup();
    render(<App />);
    await authenticateWithRepos(user, [repo('octo/hello-world')]);

    expect(triageToggleButton()).toBeInTheDocument();
    const buttons = within(viewToggle()).getAllByRole('button');
    expect(buttons[0]).toHaveAccessibleName(/triage/i);
  });

  it('renders the triage view when it is the fallback default and hides the matrix/grid', async () => {
    mockUseRepoSignals.mockReturnValue({ getRowData: getRowDataWithFailingCi });
    const user = userEvent.setup();
    render(<App />);
    await authenticateWithRepos(user, [repo('octo/hello-world')]);

    expect(await screen.findByRole('region', { name: /triage/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /needs attention/i })).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: /fleet matrix/i })).toBeNull();
    expect(screen.queryByRole('columnheader', { name: /repository/i })).toBeNull();
  });

  it('selects the triage view from another view and hides the matrix', async () => {
    localStorage.setItem('fleet:default-view', 'matrix');
    mockUseRepoSignals.mockReturnValue({ getRowData: getRowDataWithFailingCi });
    const user = userEvent.setup();
    render(<App />);
    await authenticateWithRepos(user, [repo('octo/hello-world')]);
    await screen.findByRole('table', { name: /fleet matrix/i });

    await user.click(triageToggleButton());

    expect(screen.getByRole('region', { name: /triage/i })).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: /fleet matrix/i })).toBeNull();
  });

  it('honours a persisted matrix default over the triage fallback', async () => {
    localStorage.setItem('fleet:default-view', 'matrix');
    const user = userEvent.setup();
    render(<App />);
    await authenticateWithRepos(user, [repo('octo/hello-world')]);

    expect(await screen.findByRole('table', { name: /fleet matrix/i })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /triage/i })).toBeNull();
  });

  it('honours a persisted dashboard default over the triage fallback', async () => {
    localStorage.setItem('fleet:default-view', 'dashboard');
    const user = userEvent.setup();
    render(<App />);
    await authenticateWithRepos(user, [repo('octo/hello-world')]);

    expect(await screen.findByRole('region', { name: /dashboard/i })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /triage/i })).toBeNull();
  });

  it('narrows the triage repos via the faceted repo filter', async () => {
    mockUseRepoSignals.mockReturnValue({ getRowData: getRowDataWithFailingCi });
    const user = userEvent.setup();
    render(<App />);
    await authenticateWithRepos(user, [repo('octo/alpha'), repo('octo/beta')]);
    await screen.findByRole('region', { name: /triage/i });

    expect(
      screen.getByRole('button', { name: /view details for octo\/alpha/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /view details for octo\/beta/i }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /filter repositories/i }));
    const search = await screen.findByRole('combobox', { name: /search repositories/i });
    await user.type(search, 'alpha');

    expect(
      screen.getByRole('button', { name: /view details for octo\/alpha/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /view details for octo\/beta/i })).toBeNull();
  });

  it('opens the drill-down drawer from a triage row', async () => {
    mockUseRepoSignals.mockReturnValue({ getRowData: getRowDataWithFailingCi });
    const user = userEvent.setup();
    render(<App />);
    await authenticateWithRepos(user, [repo('octo/hello-world')]);
    await screen.findByRole('region', { name: /triage/i });

    await user.click(screen.getByRole('button', { name: /view details for octo\/hello-world/i }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });
});
