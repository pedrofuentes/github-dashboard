import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { forgetToken, getToken, setToken } from '../lib/token-storage';
import type { ValidateTokenResult } from '../lib/validate-token';
import { validateToken } from '../lib/validate-token';
import { AuthProvider } from './AuthProvider';
import { useAuth } from './useAuth';

vi.mock('../lib/validate-token', () => ({
  validateToken: vi.fn(),
}));

const mockValidate = vi.mocked(validateToken);

const VALID: ValidateTokenResult = {
  ok: true,
  login: 'octocat',
  avatarUrl: 'https://avatars.githubusercontent.com/u/1',
};

function wrapper({ children }: { children: ReactNode }): ReactElement {
  return <AuthProvider>{children}</AuthProvider>;
}

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

describe('useAuth', () => {
  it('throws a helpful error when used outside an AuthProvider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(() => renderHook(() => useAuth())).toThrow(/AuthProvider/);

    spy.mockRestore();
  });
});

describe('AuthProvider', () => {
  it('starts idle with no token and no user', () => {
    const { result } = renderHook(() => useAuth(), { wrapper });

    expect(result.current.status).toBe('idle');
    expect(result.current.token).toBeNull();
    expect(result.current.user).toBeNull();
    expect(result.current.error).toBeNull();
    expect(mockValidate).not.toHaveBeenCalled();
  });

  it('exposes an authenticating status while validation is in flight', async () => {
    let resolve!: (value: ValidateTokenResult) => void;
    mockValidate.mockReturnValue(
      new Promise<ValidateTokenResult>((r) => {
        resolve = r;
      }),
    );

    const { result } = renderHook(() => useAuth(), { wrapper });

    let pending!: Promise<void>;
    act(() => {
      pending = result.current.signIn('ghp_x', 'none');
    });
    expect(result.current.status).toBe('authenticating');

    await act(async () => {
      resolve(VALID);
      await pending;
    });
    expect(result.current.status).toBe('authenticated');
  });

  it('signIn validates, captures the user and persists per the chosen mode', async () => {
    mockValidate.mockResolvedValue(VALID);
    const { result } = renderHook(() => useAuth(), { wrapper });

    await act(async () => {
      await result.current.signIn('ghp_valid', 'session');
    });

    expect(mockValidate).toHaveBeenCalledWith('ghp_valid');
    expect(result.current.status).toBe('authenticated');
    expect(result.current.user).toEqual({
      login: 'octocat',
      avatarUrl: 'https://avatars.githubusercontent.com/u/1',
    });
    expect(result.current.token).toBe('ghp_valid');
    expect(result.current.error).toBeNull();
    expect(getToken()).toBe('ghp_valid');
    expect(sessionStorage.length).toBe(1);
    expect(localStorage.length).toBe(0);
  });

  it('signIn failure surfaces an error and persists nothing', async () => {
    mockValidate.mockResolvedValue({ ok: false, error: 'Invalid or expired token' });
    const { result } = renderHook(() => useAuth(), { wrapper });

    await act(async () => {
      await result.current.signIn('ghp_bad', 'local');
    });

    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe('Invalid or expired token');
    expect(result.current.user).toBeNull();
    expect(result.current.token).toBeNull();
    expect(getToken()).toBeNull();
    expect(localStorage.length).toBe(0);
  });

  it('forget clears the token, user and any persisted copy', async () => {
    mockValidate.mockResolvedValue(VALID);
    const { result } = renderHook(() => useAuth(), { wrapper });

    await act(async () => {
      await result.current.signIn('ghp_valid', 'local');
    });
    expect(getToken()).toBe('ghp_valid');

    act(() => {
      result.current.forget();
    });

    expect(result.current.status).toBe('idle');
    expect(result.current.token).toBeNull();
    expect(result.current.user).toBeNull();
    expect(result.current.error).toBeNull();
    expect(getToken()).toBeNull();
    expect(localStorage.length).toBe(0);
  });

  it('re-validates a remembered token on mount and authenticates', async () => {
    setToken('ghp_remembered', 'local');
    mockValidate.mockResolvedValue({ ...VALID, login: 'mona' });

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => {
      expect(result.current.status).toBe('authenticated');
    });
    expect(mockValidate).toHaveBeenCalledWith('ghp_remembered');
    expect(result.current.user?.login).toBe('mona');
  });

  it('silently forgets a remembered token that no longer validates on mount', async () => {
    setToken('ghp_expired', 'local');
    mockValidate.mockResolvedValue({ ok: false, error: 'Invalid or expired token' });

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => {
      expect(result.current.status).toBe('idle');
    });
    expect(result.current.error).toBeNull();
    expect(getToken()).toBeNull();
    expect(localStorage.length).toBe(0);
  });

  it('ignores a slow mount revalidation that resolves after a newer signIn', async () => {
    setToken('ghp_stored', 'local');

    let resolveStored!: (value: ValidateTokenResult) => void;
    const storedPending = new Promise<ValidateTokenResult>((r) => {
      resolveStored = r;
    });
    mockValidate.mockImplementation((candidate: string) =>
      candidate === 'ghp_stored'
        ? storedPending
        : Promise.resolve<ValidateTokenResult>({ ...VALID, login: 'newuser' }),
    );

    const { result } = renderHook(() => useAuth(), { wrapper });

    await act(async () => {
      await result.current.signIn('ghp_new', 'local');
    });

    expect(result.current.status).toBe('authenticated');
    expect(result.current.user?.login).toBe('newuser');
    expect(result.current.token).toBe('ghp_new');
    expect(getToken()).toBe('ghp_new');

    await act(async () => {
      resolveStored({ ok: false, error: 'Invalid or expired token' });
      await storedPending;
    });

    expect(result.current.status).toBe('authenticated');
    expect(result.current.user?.login).toBe('newuser');
    expect(result.current.token).toBe('ghp_new');
    expect(result.current.error).toBeNull();
    expect(getToken()).toBe('ghp_new');
    expect(localStorage.getItem('github-dashboard.pat')).toBe('ghp_new');
  });

  it('does not call forgetToken when unmounted before mount revalidation resolves', async () => {
    setToken('ghp_stored', 'local');

    let resolveStored!: (value: ValidateTokenResult) => void;
    const storedPending = new Promise<ValidateTokenResult>((r) => {
      resolveStored = r;
    });
    mockValidate.mockReturnValue(storedPending);

    const forgetTokenSpy = vi.spyOn(await import('../lib/token-storage'), 'forgetToken');

    const { unmount } = renderHook(() => useAuth(), { wrapper });

    expect(mockValidate).toHaveBeenCalledWith('ghp_stored');

    unmount();

    await act(async () => {
      resolveStored({ ok: false, error: 'Invalid or expired token' });
      await storedPending;
    });

    expect(forgetTokenSpy).not.toHaveBeenCalled();
    expect(getToken()).toBe('ghp_stored');
    expect(localStorage.getItem('github-dashboard.pat')).toBe('ghp_stored');

    forgetTokenSpy.mockRestore();
  });
});
