/**
 * Accessible control for the user's configurable DEFAULT view — the view the
 * app opens to on every load. Deliberately distinct from the ephemeral
 * `ViewToggle` (which only switches the live view): this is a `radiogroup`
 * with a visible "Default view" label and `role="radio"`/`aria-checked`
 * options, each with a redundant text label (never colour alone), a visible
 * focus ring and tokenised colours so it meets WCAG AA in both themes.
 * Controlled: it reflects the persisted default passed as `value`.
 */
import { useId } from 'react';
import type { ReactElement } from 'react';

import type { FleetView } from '../lib/view-preference';

interface DefaultViewOption {
  value: FleetView;
  label: string;
}

const DEFAULT_VIEW_OPTIONS: ReadonlyArray<DefaultViewOption> = [
  { value: 'triage', label: 'Triage' },
  { value: 'matrix', label: 'Matrix' },
  { value: 'grid', label: 'Grid' },
  { value: 'dashboard', label: 'Boards' },
  { value: 'inbox', label: 'Inbox' },
];

const BASE_BUTTON =
  'inline-flex items-center rounded px-2.5 py-1 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';
const ACTIVE_BUTTON = 'bg-text text-surface';
const INACTIVE_BUTTON = 'text-text-muted hover:bg-surface-raised';

interface DefaultViewToggleProps {
  value: FleetView;
  onChange: (view: FleetView) => void;
}

export function DefaultViewToggle({ value, onChange }: DefaultViewToggleProps): ReactElement {
  const labelId = useId();
  return (
    <div className="inline-flex items-center gap-2">
      <span id={labelId} className="text-xs font-medium uppercase tracking-wide text-text-muted">
        Default view
      </span>
      <div
        role="radiogroup"
        aria-labelledby={labelId}
        className="inline-flex w-fit rounded-md border border-border-strong bg-surface p-0.5"
      >
        {DEFAULT_VIEW_OPTIONS.map((option) => {
          const isActive = value === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={isActive}
              onClick={() => onChange(option.value)}
              className={`${BASE_BUTTON} ${isActive ? ACTIVE_BUTTON : INACTIVE_BUTTON}`}
            >
              <span>{option.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
