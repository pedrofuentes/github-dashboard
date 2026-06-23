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
 * The shim installs a plain-object memory `Storage` unconditionally. jsdom (and
 * native Node ≥21) may already expose an *exotic* `Storage` whose named-property
 * setter swallows `vi.spyOn(storage, 'setItem')` (the write succeeds but the spy
 * records zero calls — see #124, LEARNINGS.md), so we always replace it with a
 * spy-friendly plain object. The implementation is minimal and spec-faithful.
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
  Object.defineProperty(globalThis, name, {
    value: createMemoryStorage(),
    configurable: true,
    writable: true,
  });
}

ensureWebStorage('localStorage');
ensureWebStorage('sessionStorage');

/**
 * `ResizeObserver` polyfill for the jsdom environment.
 *
 * jsdom does not implement `ResizeObserver`, but react-grid-layout's
 * `WidthProvider` instantiates one to track its container width. The shim is a
 * no-op observer (jsdom reports a 0px layout anyway), enough to let the grid
 * mount in component tests without throwing.
 */
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

if (typeof (globalThis as Record<string, unknown>).ResizeObserver === 'undefined') {
  (globalThis as Record<string, unknown>).ResizeObserver = ResizeObserverStub;
}

/**
 * `Element.prototype.scrollIntoView` stub for the jsdom environment.
 *
 * jsdom does not implement `scrollIntoView` (it is `undefined` and throws when
 * called). The `aria-activedescendant` listboxes (CommandPalette,
 * FacetedRepoFilter) call it to keep the active option within the scroll
 * viewport (WCAG 2.4.7). The no-op stub lets those effects run under test
 * without crashing; individual tests spy on it (`vi.spyOn`) to assert the
 * scroll contract.
 */
if (typeof Element.prototype.scrollIntoView !== 'function') {
  Element.prototype.scrollIntoView = function scrollIntoView(): void {};
}
