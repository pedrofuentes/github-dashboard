import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  applyTheme,
  loadThemePreference,
  resolveTheme,
  saveThemePreference,
} from './theme-preference';

const THEME_KEY = 'fleet:theme';

beforeEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove('dark');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

afterEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove('dark');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function stubMatchMedia(matches: boolean): void {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockReturnValue({
      matches,
      media: '(prefers-color-scheme: dark)',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  );
}

describe('loadThemePreference', () => {
  it('defaults to "system" when nothing is stored', () => {
    expect(loadThemePreference()).toBe('system');
  });

  it('reads a stored "light" preference', () => {
    localStorage.setItem(THEME_KEY, 'light');
    expect(loadThemePreference()).toBe('light');
  });

  it('reads a stored "dark" preference', () => {
    localStorage.setItem(THEME_KEY, 'dark');
    expect(loadThemePreference()).toBe('dark');
  });

  it('reads a stored "system" preference', () => {
    localStorage.setItem(THEME_KEY, 'system');
    expect(loadThemePreference()).toBe('system');
  });

  it('defaults to "system" for an unrecognised value', () => {
    localStorage.setItem(THEME_KEY, 'sepia');
    expect(loadThemePreference()).toBe('system');
  });

  it('survives localStorage.getItem throwing', () => {
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(loadThemePreference()).toBe('system');
  });
});

describe('saveThemePreference', () => {
  it('persists the choice', () => {
    saveThemePreference('dark');
    expect(localStorage.getItem(THEME_KEY)).toBe('dark');
  });

  it('round-trips through loadThemePreference', () => {
    saveThemePreference('light');
    expect(loadThemePreference()).toBe('light');
  });

  it('swallows localStorage.setItem throwing', () => {
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });
    expect(() => saveThemePreference('dark')).not.toThrow();
  });
});

describe('resolveTheme', () => {
  it('resolves "light" to "light"', () => {
    expect(resolveTheme('light')).toBe('light');
  });

  it('resolves "dark" to "dark"', () => {
    expect(resolveTheme('dark')).toBe('dark');
  });

  it('resolves "system" to "dark" when the OS prefers dark', () => {
    stubMatchMedia(true);
    expect(resolveTheme('system')).toBe('dark');
  });

  it('resolves "system" to "light" when the OS prefers light', () => {
    stubMatchMedia(false);
    expect(resolveTheme('system')).toBe('light');
  });

  it('resolves "system" to "light" when matchMedia is unavailable', () => {
    vi.stubGlobal('matchMedia', undefined);
    expect(resolveTheme('system')).toBe('light');
  });
});

describe('applyTheme', () => {
  it('adds the "dark" class for the dark theme', () => {
    applyTheme('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('removes the "dark" class for the light theme', () => {
    document.documentElement.classList.add('dark');
    applyTheme('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('is idempotent across repeated applications', () => {
    applyTheme('dark');
    applyTheme('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    applyTheme('light');
    applyTheme('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });
});
