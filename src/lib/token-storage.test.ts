import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { forgetToken, getStoredMode, getToken, setToken, STORAGE_KEY } from './token-storage';

describe('token-storage', () => {
  beforeEach(() => {
    forgetToken();
    sessionStorage.clear();
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    forgetToken();
    sessionStorage.clear();
    localStorage.clear();
  });

  it("'none' keeps the token in memory only and persists nothing", () => {
    setToken('ghp_inmemory', 'none');

    expect(getToken()).toBe('ghp_inmemory');
    expect(sessionStorage.length).toBe(0);
    expect(localStorage.length).toBe(0);
    expect(getStoredMode()).toBe('none');
  });

  it("'session' persists the token to sessionStorage only", () => {
    setToken('ghp_session', 'session');

    expect(getToken()).toBe('ghp_session');
    expect(sessionStorage.getItem(STORAGE_KEY)).toBe('ghp_session');
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(getStoredMode()).toBe('session');
  });

  it("'local' persists the token to localStorage only", () => {
    setToken('ghp_local', 'local');

    expect(getToken()).toBe('ghp_local');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('ghp_local');
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(getStoredMode()).toBe('local');
  });

  it('hydrates the in-memory token from sessionStorage on first read', () => {
    sessionStorage.setItem(STORAGE_KEY, 'ghp_from_session');

    expect(getToken()).toBe('ghp_from_session');
  });

  it('hydrates from localStorage when sessionStorage is empty', () => {
    localStorage.setItem(STORAGE_KEY, 'ghp_from_local');

    expect(getToken()).toBe('ghp_from_local');
  });

  it('returns null when no token is stored anywhere', () => {
    expect(getToken()).toBeNull();
    expect(getStoredMode()).toBe('none');
  });

  it('switching from local to session leaves no copy in localStorage', () => {
    setToken('ghp_x', 'local');
    setToken('ghp_x', 'session');

    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(sessionStorage.getItem(STORAGE_KEY)).toBe('ghp_x');
    expect(getStoredMode()).toBe('session');
  });

  it('forgetToken clears in-memory, sessionStorage and localStorage', () => {
    setToken('ghp_x', 'local');
    sessionStorage.setItem(STORAGE_KEY, 'ghp_y');

    forgetToken();

    expect(getToken()).toBeNull();
    expect(sessionStorage.length).toBe(0);
    expect(localStorage.length).toBe(0);
  });

  it('does not throw when writing to storage fails (e.g. private mode)', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });

    expect(() => setToken('ghp_x', 'local')).not.toThrow();
    // The in-memory copy still works even though persistence failed.
    expect(getToken()).toBe('ghp_x');
  });

  it('returns null when reading from storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });

    expect(getToken()).toBeNull();
    expect(getStoredMode()).toBe('none');
  });

  it('does not throw when clearing storage fails', () => {
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });

    expect(() => forgetToken()).not.toThrow();
    expect(getToken()).toBeNull();
  });
});
