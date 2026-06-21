/**
 * Accessible 3-state theme control (DESIGN-TILES §1.1). A segmented
 * `radiogroup` of Light / Dark / System, each with a redundant icon + text
 * label (never colour alone), a `focus`-token focus ring, and tokenised colours
 * so it meets WCAG AA in both themes. Wired to {@link useTheme}, which persists
 * the choice and flips the `.dark` class on `<html>`.
 */
import type { ReactElement, ReactNode } from 'react';

import { useTheme } from '../hooks/useTheme';
import type { ThemeChoice } from '../lib/theme-preference';

interface ThemeOption {
  value: ThemeChoice;
  label: string;
  icon: ReactNode;
}

const ICON_PROPS = {
  width: 16,
  height: 16,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

const SunIcon = (): ReactElement => (
  <svg {...ICON_PROPS}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
  </svg>
);

const MoonIcon = (): ReactElement => (
  <svg {...ICON_PROPS}>
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </svg>
);

const SystemIcon = (): ReactElement => (
  <svg {...ICON_PROPS}>
    <rect x="2" y="3" width="20" height="14" rx="2" />
    <path d="M8 21h8M12 17v4" />
  </svg>
);

const THEME_OPTIONS: ReadonlyArray<ThemeOption> = [
  { value: 'light', label: 'Light', icon: <SunIcon /> },
  { value: 'dark', label: 'Dark', icon: <MoonIcon /> },
  { value: 'system', label: 'System', icon: <SystemIcon /> },
];

const BASE_BUTTON =
  'inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';
const ACTIVE_BUTTON = 'bg-text text-surface';
const INACTIVE_BUTTON = 'text-text-muted hover:bg-surface-raised';

export function ThemeToggle(): ReactElement {
  const { choice, setChoice } = useTheme();

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="inline-flex w-fit rounded-md border border-border-strong bg-surface p-0.5"
    >
      {THEME_OPTIONS.map((option) => {
        const isActive = choice === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={isActive}
            onClick={() => setChoice(option.value)}
            className={`${BASE_BUTTON} ${isActive ? ACTIVE_BUTTON : INACTIVE_BUTTON}`}
          >
            {option.icon}
            <span>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
