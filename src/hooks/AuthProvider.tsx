import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';

import { forgetToken, getToken, setToken } from '../lib/token-storage';
import { validateToken } from '../lib/validate-token';
import type { AuthContextValue, AuthStatus, AuthUser, PersistenceMode } from '../types/auth';
import { AuthContext } from './useAuth';

interface AuthProviderProps {
  children: ReactNode;
}

/**
 * Owns the auth state machine for the app (DECISION #3 / ADR-003).
 *
 * The token is held in React state for rendering and, in parallel, in the
 * `token-storage` module which decides whether/where it persists. On mount, a
 * remembered token (session/local) is re-validated against `api.github.com` so
 * the identity (login + avatar) can be restored; an invalid one is silently
 * forgotten rather than surfaced as an error the user didn't trigger.
 */
export function AuthProvider({ children }: AuthProviderProps): ReactElement {
  const [token, setTokenState] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<AuthStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  /**
   * Monotonic id stamped on every validation operation (sign-in, mount
   * revalidation, forget). A resolving validation only mutates state when its
   * stamp is still the latest, so a slow operation can never clobber — or
   * `forgetToken()` — the result of a newer one (the auth-state race).
   */
  const generationRef = useRef(0);

  const signIn = useCallback(async (candidate: string, mode: PersistenceMode): Promise<void> => {
    const generation = (generationRef.current += 1);
    setStatus('authenticating');
    setError(null);

    const result = await validateToken(candidate);
    if (generation !== generationRef.current) {
      return;
    }
    if (!result.ok) {
      forgetToken();
      setTokenState(null);
      setUser(null);
      setStatus('error');
      setError(result.error);
      return;
    }

    setToken(candidate, mode);
    setTokenState(candidate);
    setUser({ login: result.login, avatarUrl: result.avatarUrl });
    setStatus('authenticated');
    setError(null);
  }, []);

  const forget = useCallback((): void => {
    generationRef.current += 1;
    forgetToken();
    setTokenState(null);
    setUser(null);
    setStatus('idle');
    setError(null);
  }, []);

  useEffect(() => {
    const stored = getToken();
    if (stored === null) {
      return;
    }

    const generation = (generationRef.current += 1);
    setStatus('authenticating');
    void validateToken(stored).then((result) => {
      if (generation !== generationRef.current) {
        return;
      }
      if (result.ok) {
        setTokenState(stored);
        setUser({ login: result.login, avatarUrl: result.avatarUrl });
        setStatus('authenticated');
      } else {
        forgetToken();
        setStatus('idle');
      }
    });
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ token, user, status, error, signIn, forget }),
    [token, user, status, error, signIn, forget],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
