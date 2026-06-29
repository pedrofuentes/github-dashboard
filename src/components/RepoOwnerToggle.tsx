/**
 * Accessible 2-state repo-name control (mirrors {@link DensityToggle}). A
 * segmented `radiogroup` of Show owner / Name only, each with a redundant icon +
 * text label (never colour alone), a `focus`-token focus ring, and tokenised
 * colours so it meets WCAG AA in both themes. Wired to {@link useRepoOwner}, a
 * shared store, so the choice is persisted and applied live across every
 * consumer (the repo labels, the ⌘K command, and this toggle).
 *
 * Keyboard (WAI-ARIA APG radio-group pattern): a single roving tab stop — only
 * the checked radio is in the tab order (`tabindex="0"`); the other is
 * `tabindex="-1"` and reached with the arrow keys. `ArrowRight`/`ArrowDown`
 * select the next option and `ArrowLeft`/`ArrowUp` the previous (both wrap),
 * `Home`/`End` jump to the first/last, and selection moves focus with it.
 * `Space`/`Enter` activate the focused radio via its native button semantics.
 */
import type { KeyboardEvent, ReactElement, ReactNode } from 'react';
import { useRef } from 'react';

import { useRepoOwner } from '../hooks/useRepoOwner';
import type { RepoOwnerDisplay } from '../lib/repo-owner-preference';

interface RepoOwnerOption {
  value: RepoOwnerDisplay;
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

// Two segments split by a slash — evokes the full `owner/repo` label.
const ShowOwnerIcon = (): ReactElement => (
  <svg {...ICON_PROPS}>
    <rect x="2.5" y="8.5" width="7" height="7" rx="1.5" />
    <path d="M11 16 13 8" />
    <rect x="14.5" y="8.5" width="7" height="7" rx="1.5" />
  </svg>
);

// A single segment — the bare repo name with the owner dropped.
const NameOnlyIcon = (): ReactElement => (
  <svg {...ICON_PROPS}>
    <rect x="6" y="8.5" width="12" height="7" rx="1.5" />
  </svg>
);

const REPO_OWNER_OPTIONS: ReadonlyArray<RepoOwnerOption> = [
  { value: 'show', label: 'Show owner', icon: <ShowOwnerIcon /> },
  { value: 'hide', label: 'Name only', icon: <NameOnlyIcon /> },
];

const BASE_BUTTON =
  'inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';
const ACTIVE_BUTTON = 'bg-text text-surface';
const INACTIVE_BUTTON = 'text-text-muted hover:bg-surface-raised';

export function RepoOwnerToggle(): ReactElement {
  const { display, setDisplay } = useRepoOwner();
  const radioRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // WAI-ARIA APG radio-group keyboard model: arrows move selection AND focus
  // (wrapping), Home/End jump to the ends. Selecting an option also moves the
  // roving tab stop to it (only the checked radio stays `tabindex="0"`).
  function focusOption(index: number): void {
    const next = REPO_OWNER_OPTIONS[index];
    setDisplay(next.value);
    radioRefs.current[index]?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number): void {
    const last = REPO_OWNER_OPTIONS.length - 1;
    let nextIndex: number;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        nextIndex = index === last ? 0 : index + 1;
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        nextIndex = index === 0 ? last : index - 1;
        break;
      case 'Home':
        nextIndex = 0;
        break;
      case 'End':
        nextIndex = last;
        break;
      default:
        return;
    }
    event.preventDefault();
    focusOption(nextIndex);
  }

  return (
    <div
      role="radiogroup"
      aria-label="Repository names"
      className="inline-flex w-fit rounded-md border border-border-strong bg-surface p-0.5"
    >
      {REPO_OWNER_OPTIONS.map((option, index) => {
        const isActive = display === option.value;
        return (
          <button
            key={option.value}
            ref={(node) => {
              radioRefs.current[index] = node;
            }}
            type="button"
            role="radio"
            aria-checked={isActive}
            tabIndex={isActive ? 0 : -1}
            onClick={() => setDisplay(option.value)}
            onKeyDown={(event) => handleKeyDown(event, index)}
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
