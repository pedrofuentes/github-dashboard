import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { forgetToken } from './lib/token-storage';
import { validateToken } from './lib/validate-token';
import { App } from './App';

vi.mock('./lib/validate-token', () => ({
  validateToken: vi.fn(),
}));

const mockValidate = vi.mocked(validateToken);

beforeEach(() => {
  forgetToken();
  sessionStorage.clear();
  localStorage.clear();
  mockValidate.mockReset();
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
});
