import type { PersistenceMode } from '../types/auth';

/** Key under which the PAT is stored in `sessionStorage` / `localStorage`. */
export const STORAGE_KEY = 'github-dashboard.pat';

/**
 * In-memory copy of the token — the runtime source of truth, and the only place
 * the token lives when the persistence mode is `none` (the default). It is a
 * module-level value so it is shared by every consumer within a browser tab and
 * is wiped on a full page reload (when persistence is `none`).
 */
let inMemoryToken: string | null = null;

function safeGet(storage: Storage): string | null {
  try {
    return storage.getItem(STORAGE_KEY);
  } catch {
    // Storage can be unavailable (private mode, disabled cookies). Treat as empty.
    return null;
  }
}

function safeSet(storage: Storage, value: string): void {
  try {
    storage.setItem(STORAGE_KEY, value);
  } catch {
    // Persistence is best-effort; the in-memory copy still works.
  }
}

function safeRemove(storage: Storage): void {
  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore — see safeSet.
  }
}

/**
 * Stores the token in memory and, depending on `mode`, in exactly one browser
 * store. The non-chosen stores are always cleared, so a token never lingers in a
 * more-persistent store than the user selected.
 */
export function setToken(token: string, mode: PersistenceMode): void {
  inMemoryToken = token;

  if (mode === 'session') {
    safeSet(sessionStorage, token);
    safeRemove(localStorage);
  } else if (mode === 'local') {
    safeSet(localStorage, token);
    safeRemove(sessionStorage);
  } else {
    safeRemove(sessionStorage);
    safeRemove(localStorage);
  }
}

/**
 * Returns the active token, hydrating the in-memory copy from a persistent store
 * on the first read after a reload. `sessionStorage` takes precedence over
 * `localStorage`. Returns `null` when no token is available anywhere.
 */
export function getToken(): string | null {
  if (inMemoryToken !== null) {
    return inMemoryToken;
  }

  const fromSession = safeGet(sessionStorage);
  if (fromSession !== null) {
    inMemoryToken = fromSession;
    return fromSession;
  }

  const fromLocal = safeGet(localStorage);
  if (fromLocal !== null) {
    inMemoryToken = fromLocal;
    return fromLocal;
  }

  return null;
}

/** Reports which persistent store currently holds the token, if any. */
export function getStoredMode(): PersistenceMode {
  if (safeGet(sessionStorage) !== null) {
    return 'session';
  }
  if (safeGet(localStorage) !== null) {
    return 'local';
  }
  return 'none';
}

/** Clears the token from memory and from both browser stores. */
export function forgetToken(): void {
  inMemoryToken = null;
  safeRemove(sessionStorage);
  safeRemove(localStorage);
}
