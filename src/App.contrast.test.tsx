import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { forgetToken } from './lib/token-storage';
import { validateToken } from './lib/validate-token';
import { useRepos } from './hooks/useRepos';
import { useRepoSignals } from './hooks/useRepoSignals';
import type { GetRowData, Repo } from './types/fleet';
import { App } from './App';

vi.mock('./lib/validate-token', () => ({ validateToken: vi.fn() }));
vi.mock('./hooks/useRepos', () => ({ useRepos: vi.fn() }));
vi.mock('./hooks/useRepoSignals', () => ({ useRepoSignals: vi.fn() }));

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

async function openDashboard(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  mockValidate.mockResolvedValue({ ok: true, login: 'octocat', avatarUrl: undefined });
  mockUseRepos.mockReturnValue({
    status: 'success',
    repos: [repo('octo/hello-world')],
    error: null,
    reload: vi.fn(),
  });
  await user.type(screen.getByLabelText(/personal access token/i), 'ghp_valid');
  await user.click(screen.getByRole('button', { name: /connect/i }));
  await screen.findByText(/authenticated as octocat/i);
  await user.click(screen.getByRole('button', { name: /dashboard/i }));
}

describe('App — customize-layout contrast (#125)', () => {
  it('uses sky-700 (AA-passing) for the active customize-layout toggle', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openDashboard(user);

    const customize = screen.getByRole('button', { name: /customize layout/i });
    await user.click(customize);

    expect(customize).toHaveAttribute('aria-pressed', 'true');
    const className = customize.getAttribute('class') ?? '';
    // The white-on-sky-600 active state failed 4.5:1; sky-700 (~5.93:1) passes AA.
    expect(className).toContain('bg-sky-700');
    expect(className).toContain('border-sky-700');
    expect(className).not.toContain('bg-sky-600');
    expect(className).not.toContain('border-sky-600');
  });

  it('uses an sky-700 focus ring on the customize-layout toggle', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openDashboard(user);

    const customize = screen.getByRole('button', { name: /customize layout/i });
    const className = customize.getAttribute('class') ?? '';
    expect(className).toContain('focus-visible:outline-sky-700');
    expect(className).not.toContain('focus-visible:outline-sky-600');
  });
});
