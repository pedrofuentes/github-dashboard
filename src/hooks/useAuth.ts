import { createContext, useContext } from 'react';

import type { AuthContextValue } from '../types/auth';

/**
 * Auth context. The default is `undefined` (rather than a stub value) so that
 * {@link useAuth} can detect "no provider above" and throw a helpful error
 * instead of silently handing back misleading defaults.
 *
 * Defined in this `.ts` module (separate from the provider component) so the
 * context object can be exported for testing without tripping the
 * `react-refresh/only-export-components` rule that applies to `.tsx` files.
 */
export const AuthContext = createContext<AuthContextValue | undefined>(undefined);

/** Access the auth state. Must be called within an {@link AuthProvider}. */
export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (value === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return value;
}
