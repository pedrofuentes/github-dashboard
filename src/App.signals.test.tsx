import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useRepos } from './hooks/useRepos';
import { useRepoSignals } from './hooks/useRepoSignals';
import { forgetToken } from './lib/token-storage';
import { validateToken } from './lib/validate-token';
import type { GetRowData, Repo } from './types/fleet';
import { App } from './App';

const { fleetGridSpy } = vi.hoisted(() => ({ fleetGridSpy: vi.fn() }));

vi.mock('./lib/validate-token', () => ({ validateToken: vi.fn() }));
vi.mock('./hooks/useRepos', () => ({ useRepos: vi.fn() }));
vi.mock('./hooks/useRepoSignals', () => ({ useRepoSignals: vi.fn() }));
vi.mock('./components/FleetGrid', () => ({
  FleetGrid: (props: { getRowData?: GetRowData }) => {
    fleetGridSpy(props);
    return <div data-testid="fleet-grid" />;
  },
}));

const mockValidate = vi.mocked(validateToken);
const mockUseRepos = vi.mocked(useRepos);
const mockUseRepoSignals = vi.mocked(useRepoSignals);

const REPOS: Repo[] = [{ nameWithOwner: 'octo/a', owner: 'octo', name: 'a', isPrivate: false }];
const getRowData: GetRowData = () => ({});

beforeEach(() => {
  forgetToken();
  sessionStorage.clear();
  localStorage.clear();
  fleetGridSpy.mockClear();
  mockValidate.mockReset();
  mockUseRepos.mockReset();
  mockUseRepoSignals.mockReset();
  mockUseRepos.mockReturnValue({ status: 'success', repos: REPOS, error: null, reload: vi.fn() });
  mockUseRepoSignals.mockReturnValue({ getRowData });
});

afterEach(() => {
  forgetToken();
  sessionStorage.clear();
  localStorage.clear();
});

async function signIn(): Promise<void> {
  mockValidate.mockResolvedValue({ ok: true, login: 'octocat', avatarUrl: undefined });
  const user = userEvent.setup();
  render(<App />);
  await user.type(screen.getByLabelText(/personal access token/i), 'ghp_valid');
  await user.click(screen.getByRole('button', { name: /connect/i }));
  await screen.findByText(/authenticated as octocat/i);
}

describe('App fleet signal wiring', () => {
  it('feeds the authenticated repos and token into the signal aggregator', async () => {
    await signIn();

    expect(mockUseRepoSignals).toHaveBeenCalledWith(REPOS, 'ghp_valid');
  });

  it('passes the aggregator getRowData down to the fleet grid', async () => {
    localStorage.setItem('fleet:default-view', 'grid');
    await signIn();

    expect(fleetGridSpy).toHaveBeenCalledWith(expect.objectContaining({ getRowData }));
  });
});
