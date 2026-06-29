import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

  it('explains the Security grade permission requirements', () => {
    renderWithAuth();

    expect(screen.getByText(/security grade/i)).toHaveTextContent(/security_events/i);
    expect(screen.getByText(/security grade/i)).toHaveTextContent(/security shows n\/a/i);
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

describe('TokenInput — dark-shell color tokens (#173)', () => {
  // Symmetry with App.contrast.test.tsx: TokenInput got the same PR #169 recolor
  // (hardcoded slate-*/sky-*/red-*/white → semantic CSS-variable-backed tokens)
  // but shipped with zero color-class guards. Assert the migrated tokens are
  // present AND the pre-migration palette is absent, so a revert/mis-apply that
  // reintroduces sub-AA dark-mode colour can't slip through green.

  it('uses semantic border + focus-ring tokens on the token field (not slate/sky)', () => {
    renderWithAuth();
    const className = tokenField().getAttribute('class') ?? '';

    expect(className).toContain('border-border-strong');
    expect(className).toContain('focus-visible:outline-focus');
    expect(className).not.toMatch(/border-slate-\d/);
    expect(className).not.toMatch(/outline-sky-\d/);
  });

  it('uses the inverted bg-text/text-surface fill + focus token on the Connect button', () => {
    renderWithAuth();
    const className = submitButton().getAttribute('class') ?? '';

    // DESIGN-TILES §1.5: solid fills must not carry white text in dark mode — the
    // button inks with `text-surface` (white in light, near-black in dark) over
    // the inverted `bg-text` fill, clearing AA in both themes.
    expect(className).toContain('bg-text');
    expect(className).toContain('text-surface');
    expect(className).toContain('focus-visible:outline-focus');
    expect(className).not.toMatch(/bg-slate-\d/);
    expect(className).not.toContain('text-white');
    expect(className).not.toMatch(/outline-sky-\d/);
  });

  it('uses the semantic failure-ink token on the error alert (not hardcoded red-*)', () => {
    renderWithAuth({ status: 'error', error: 'Invalid or expired token' });
    const className = screen.getByRole('alert').getAttribute('class') ?? '';

    expect(className).toContain('text-accent-failure');
    expect(className).not.toMatch(/text-red-\d/);
  });

  it('uses semantic text + focus tokens on the PAT help link (not slate/sky)', () => {
    renderWithAuth();
    const className = screen.getByRole('link', { name: /token/i }).getAttribute('class') ?? '';

    expect(className).toContain('text-text');
    expect(className).toContain('focus-visible:outline-focus');
    expect(className).not.toMatch(/text-slate-\d/);
    expect(className).not.toMatch(/outline-sky-\d/);
  });

  it('uses the muted-text token on the persistence legend (not slate)', () => {
    renderWithAuth();
    const className = screen.getByText(/remember this token/i).getAttribute('class') ?? '';

    expect(className).toContain('text-text-muted');
    expect(className).not.toMatch(/text-slate-\d/);
  });
});
