import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Regression coverage for the Web Storage shim installed by `src/test/setup.ts`.
 *
 * On CI's Node 20, jsdom supplies an *exotic* `Storage` whose named-property
 * setter swallows `vi.spyOn(localStorage, 'setItem')` — the underlying write
 * still succeeds, but the spy records **zero** calls, silently breaking any test
 * that asserts on the spy (see #124 and LEARNINGS.md). The setup must therefore
 * ALWAYS install the plain-object memory `Storage`, on which a spy behaves
 * normally. These tests FAIL on Node 20 without that fix.
 */
describe('test setup: Web Storage shim', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });

  it('records a setItem call when localStorage is spied', () => {
    const spy = vi.spyOn(localStorage, 'setItem');

    localStorage.setItem('shim-key', 'shim-value');

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('shim-key', 'shim-value');
    expect(localStorage.getItem('shim-key')).toBe('shim-value');
  });

  it('records a setItem call when sessionStorage is spied', () => {
    const spy = vi.spyOn(sessionStorage, 'setItem');

    sessionStorage.setItem('shim-key', 'shim-value');

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('shim-key', 'shim-value');
    expect(sessionStorage.getItem('shim-key')).toBe('shim-value');
  });
});
