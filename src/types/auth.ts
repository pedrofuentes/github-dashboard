/**
 * Where a validated Personal Access Token may be kept (DECISION #3 / ADR-003).
 *
 * - `none`    — in-memory only (the privacy-preserving default); nothing persisted.
 * - `session` — `sessionStorage`; cleared when the browser tab closes.
 * - `local`   — `localStorage`; persists across sessions until explicitly forgotten.
 */
export type PersistenceMode = 'none' | 'session' | 'local';

/** Lifecycle of the auth flow. */
export type AuthStatus = 'idle' | 'authenticating' | 'authenticated' | 'error';

/**
 * Classification of the current auth `error`, mirrored from
 * {@link ValidateTokenFailureKind}. `network`/`auth`/`server` are outage-shaped
 * (a GitHub incident can produce them), so the sign-in surface shows a
 * githubstatus.com hint; `other` and `null` do not.
 */
export type AuthErrorKind = 'network' | 'auth' | 'server' | 'other';

/** Minimal GitHub identity captured from `GET /user`. */
export interface AuthUser {
  login: string;
  /** Absent when the avatar URL failed the GitHub-owned host allowlist (ADR-004). */
  avatarUrl?: string;
}

/** Value exposed by the auth context and the `useAuth` hook. */
export interface AuthContextValue {
  token: string | null;
  user: AuthUser | null;
  status: AuthStatus;
  error: string | null;
  /** Classification of `error` (or `null` when there is no error). */
  errorKind: AuthErrorKind | null;
  signIn: (token: string, mode: PersistenceMode) => Promise<void>;
  forget: () => void;
}
