/**
 * Accessible 2-state density control (DESIGN-TILES §density). A segmented
 * `radiogroup` of Balanced / Glanceable, each with a redundant icon + text
 * label (never colour alone), a `focus`-token focus ring, and tokenised colours
 * so it meets WCAG AA in both themes. Wired to {@link useDensity}, which
 * persists the choice. Tiles consume the density in a later task.
 */
import type { ReactElement, ReactNode } from 'react';

import { useDensity } from '../hooks/useDensity';
import type { Density } from '../lib/density-preference';

interface DensityOption {
  value: Density;
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

const BalancedIcon = (): ReactElement => (
  <svg {...ICON_PROPS}>
    <rect x="3" y="4" width="18" height="7" rx="1.5" />
    <rect x="3" y="13" width="18" height="7" rx="1.5" />
  </svg>
);

const GlanceableIcon = (): ReactElement => (
  <svg {...ICON_PROPS}>
    <rect x="3" y="4" width="18" height="4" rx="1" />
    <rect x="3" y="10" width="18" height="4" rx="1" />
    <rect x="3" y="16" width="18" height="4" rx="1" />
  </svg>
);

const DENSITY_OPTIONS: ReadonlyArray<DensityOption> = [
  { value: 'balanced', label: 'Balanced', icon: <BalancedIcon /> },
  { value: 'glanceable', label: 'Glanceable', icon: <GlanceableIcon /> },
];

const BASE_BUTTON =
  'inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';
const ACTIVE_BUTTON = 'bg-text text-surface';
const INACTIVE_BUTTON = 'text-text-muted hover:bg-surface-raised';

export function DensityToggle(): ReactElement {
  const { density, setDensity } = useDensity();

  return (
    <div
      role="radiogroup"
      aria-label="Density"
      className="inline-flex w-fit rounded-md border border-border-strong bg-surface p-0.5"
    >
      {DENSITY_OPTIONS.map((option) => {
        const isActive = density === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={isActive}
            onClick={() => setDensity(option.value)}
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
