/**
 * Theme persistence + resolution (DESIGN-TILES §1.1). Mirrors the defensive
 * pattern in `view-preference.ts`: every read is validated and every failure
 * (unavailable / corrupt storage, missing `matchMedia`) degrades to a safe
 * default rather than throwing. Resolving + applying the theme is kept here so
 * the same logic powers both the React `useTheme` hook and the pre-paint
 * bootstrap in `main.tsx` (CSP-safe FOUC avoidance — no inline script).
 */

/** The user's theme intent. `'system'` follows the OS `prefers-color-scheme`. */
export type ThemeChoice = 'light' | 'dark' | 'system';

/** The concrete theme actually rendered once `'system'` is resolved. */
export type ResolvedTheme = 'light' | 'dark';

const THEME_KEY = 'fleet:theme';

/** Follow the OS by default so first-run respects the user's environment. */
const DEFAULT_CHOICE: ThemeChoice = 'system';

/** The media query whose match means "the OS prefers a dark colour scheme". */
const DARK_QUERY = '(prefers-color-scheme: dark)';

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Persistence is best-effort: ignore quota / disabled-storage failures.
  }
}

function isThemeChoice(value: string | null): value is ThemeChoice {
  return value === 'light' || value === 'dark' || value === 'system';
}

/** Reads the stored choice, defaulting to `'system'` on any problem. */
export function loadThemePreference(): ThemeChoice {
  const raw = safeGet(THEME_KEY);
  return isThemeChoice(raw) ? raw : DEFAULT_CHOICE;
}

/** Persists the active choice (best-effort). */
export function saveThemePreference(choice: ThemeChoice): void {
  safeSet(THEME_KEY, choice);
}

/** True when the OS currently prefers a dark colour scheme. */
export function prefersDark(): boolean {
  if (typeof matchMedia !== 'function') {
    return false;
  }
  try {
    return matchMedia(DARK_QUERY).matches;
  } catch {
    return false;
  }
}

/**
 * Resolves a {@link ThemeChoice} to the concrete theme to render. `'system'`
 * consults `prefers-color-scheme`, guarding for environments without
 * `matchMedia` (→ `'light'`).
 */
export function resolveTheme(choice: ThemeChoice): ResolvedTheme {
  if (choice === 'system') {
    return prefersDark() ? 'dark' : 'light';
  }
  return choice;
}

/** Toggles the `dark` class on `<html>` to match the resolved theme. */
export function applyTheme(resolved: ResolvedTheme): void {
  document.documentElement.classList.toggle('dark', resolved === 'dark');
}
