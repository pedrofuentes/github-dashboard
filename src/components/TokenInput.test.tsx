import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { AuthContext } from '../hooks/useAuth';
import type { AuthContextValue } from '../types/auth';
import { TokenInput } from './TokenInput';

function renderWithAuth(overrides: Partial<AuthContextValue> = {}): AuthContextValue {
  const value: AuthContextValue = {
    token: null,
    user: null,
    status: 'idle',
    error: null,
    signIn: vi.fn().mockResolvedValue(undefined),
    forget: vi.fn(),
    ...overrides,
  };

  render(
    <AuthContext.Provider value={value}>
      <TokenInput />
    </AuthContext.Provider>,
  );

  return value;
}

function tokenField(): HTMLElement {
  return screen.getByLabelText(/personal access token/i);
}

function submitButton(): HTMLElement {
  return screen.getByRole('button', { name: /connect/i });
}

describe('TokenInput', () => {
  it('renders an accessible, masked token field', () => {
    renderWithAuth();

    const input = tokenField();
    expect(input).toHaveAttribute('type', 'password');
  });

  it('offers three persistence choices and defaults to "Don\'t remember"', () => {
    renderWithAuth();

    const dontRemember = screen.getByRole('radio', { name: /don't remember/i });
    expect(dontRemember).toBeChecked();
    expect(screen.getByRole('radio', { name: /this session/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /this device/i })).toBeInTheDocument();
  });

  it('links to fine-grained PAT creation and lists the seven read-only permissions', () => {
    renderWithAuth();

    const link = screen.getByRole('link', { name: /token/i });
    expect(link.getAttribute('href')).toContain('github.com/settings/personal-access-tokens');

    const permissions = [
      'Actions',
      'Code scanning',
      'Contents',
      'Dependabot',
      'Issues',
      'Metadata',
      'Pull requests',
    ];
    for (const permission of permissions) {
      expect(screen.getByText(new RegExp(permission, 'i'))).toBeInTheDocument();
    }
  });

  it('shows an alert and does not call signIn when the token is empty', async () => {
    const value = renderWithAuth();
    const user = userEvent.setup();

    await user.click(submitButton());

    expect(value.signIn).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/enter.*token/i);
  });

  it('submits the trimmed token with the in-memory default ("none")', async () => {
    const value = renderWithAuth();
    const user = userEvent.setup();

    await user.type(tokenField(), '  ghp_default  ');
    await user.click(submitButton());

    expect(value.signIn).toHaveBeenCalledWith('ghp_default', 'none');
  });

  it('submits the token with the selected persistence mode', async () => {
    const value = renderWithAuth();
    const user = userEvent.setup();

    await user.type(tokenField(), 'ghp_secret123');
    await user.click(screen.getByRole('radio', { name: /this session/i }));
    await user.click(submitButton());

    expect(value.signIn).toHaveBeenCalledWith('ghp_secret123', 'session');
  });

  it('renders authentication errors from context in an alert region', () => {
    renderWithAuth({ status: 'error', error: 'Invalid or expired token' });

    expect(screen.getByRole('alert')).toHaveTextContent('Invalid or expired token');
  });

  it('disables submission while authenticating', () => {
    renderWithAuth({ status: 'authenticating' });

    expect(screen.getByRole('button', { name: /connecting/i })).toBeDisabled();
  });
});
