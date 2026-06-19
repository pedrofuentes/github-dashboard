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
});
