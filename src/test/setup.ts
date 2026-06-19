import '@testing-library/jest-dom';

/**
 * Web Storage polyfill for the Vitest jsdom environment.
 *
 * jsdom implements `localStorage`/`sessionStorage`, but it exposes them as
 * prototype getters on its `window`. Vitest's global-population step copies own
 * properties (plus a fixed key list) from the jsdom window onto the test global,
 * so these prototype getters are skipped and the test global ends up with a
 * non-functional `{}` for each. Without this shim any browser-storage code is
 * untestable (`localStorage.setItem is not a function`).
 *
 * The shim is feature-detected, so a real (working) implementation is never
 * clobbered, and it is intentionally minimal and spec-faithful.
 */
function createMemoryStorage(): Storage {
  const entries = new Map<string, string>();

  return {
    get length(): number {
      return entries.size;
    },
    clear(): void {
      entries.clear();
    },
    getItem(key: string): string | null {
      return entries.has(key) ? (entries.get(key) ?? null) : null;
    },
    key(index: number): string | null {
      return Array.from(entries.keys())[index] ?? null;
    },
    removeItem(key: string): void {
      entries.delete(key);
    },
    setItem(key: string, value: string): void {
      entries.set(key, String(value));
    },
  };
}

function ensureWebStorage(name: 'localStorage' | 'sessionStorage'): void {
  const current = (globalThis as Record<string, unknown>)[name] as Partial<Storage> | undefined;
  if (current && typeof current.setItem === 'function') {
    return;
  }

  Object.defineProperty(globalThis, name, {
    value: createMemoryStorage(),
    configurable: true,
    writable: true,
  });
}

ensureWebStorage('localStorage');
ensureWebStorage('sessionStorage');
