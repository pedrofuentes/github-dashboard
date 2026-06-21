/**
 * React binding for the app theme (DESIGN-TILES §1.1). Initialises from the
 * persisted {@link ThemeChoice}, applies the resolved theme to `<html>` on
 * mount, and on every `setChoice` persists + re-applies. While the choice is
 * `'system'` it subscribes to the OS `prefers-color-scheme` media query so a
 * live OS switch re-applies without a reload; the listener is cleaned up on
 * unmount or when the choice becomes concrete.
 */
import { useCallback, useEffect, useState } from 'react';

import {
  applyTheme,
  loadThemePreference,
  resolveTheme,
  saveThemePreference,
} from '../lib/theme-preference';
import type { ResolvedTheme, ThemeChoice } from '../lib/theme-preference';

const DARK_QUERY = '(prefers-color-scheme: dark)';

/** Public shape returned by {@link useTheme}. */
export interface UseThemeResult {
  /** The user's current intent (`light` / `dark` / `system`). */
  choice: ThemeChoice;
  /** Persists + applies a new choice. */
  setChoice: (choice: ThemeChoice) => void;
  /** The concrete theme currently rendered (`'system'` resolved). */
  resolved: ResolvedTheme;
}

/** Manages the active theme and keeps React state in sync with the DOM class. */
export function useTheme(): UseThemeResult {
  const [choice, setChoiceState] = useState<ThemeChoice>(loadThemePreference);
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolveTheme(choice));

  // Keep the DOM class and the resolved state in lock-step with the choice.
  // Runs on mount (so React and the pre-paint bootstrap agree) and whenever the
  // choice changes.
  useEffect(() => {
    const next = resolveTheme(choice);
    setResolved(next);
    applyTheme(next);
  }, [choice]);

  // While following the OS, re-apply when its colour scheme flips live. No-op
  // for concrete choices and in environments without `matchMedia`.
  useEffect(() => {
    if (choice !== 'system' || typeof matchMedia !== 'function') {
      return;
    }
    const media = matchMedia(DARK_QUERY);
    const onChange = (event: MediaQueryListEvent): void => {
      const next: ResolvedTheme = event.matches ? 'dark' : 'light';
      setResolved(next);
      applyTheme(next);
    };
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [choice]);

  const setChoice = useCallback((next: ThemeChoice) => {
    saveThemePreference(next);
    setChoiceState(next);
  }, []);

  return { choice, setChoice, resolved };
}
