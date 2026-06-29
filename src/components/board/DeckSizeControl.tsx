/**
 * Accessible 4-state Deck tile-size control. A segmented `radiogroup` of
 * X-Small / Small / Medium / Large, each with a redundant icon + text label
 * (never colour alone), a `focus`-token focus ring, and tokenised colours so it
 * meets WCAG AA in both themes. Wired to {@link useDeckTileSize}, a shared store,
 * so the choice is persisted and applied live across every consumer (the toolbar
 * control, the {@link BoardView} grid, and the full-window bar).
 *
 * Keyboard (WAI-ARIA APG radio-group pattern): a single roving tab stop — only
 * the checked radio is tabbable; the others are reached with the arrow keys.
 * `ArrowRight`/`ArrowDown` select the next option and `ArrowLeft`/`ArrowUp` the
 * previous (both wrap), `Home`/`End` jump to the first/last, and selection moves
 * focus with it. `Space`/`Enter` activate via native button semantics.
 */
import type { KeyboardEvent, ReactElement, ReactNode } from 'react';
import { useRef } from 'react';

import { useDeckTileSize } from '../../hooks/useDeckTileSize';
import type { DeckTileSize } from '../../lib/deck-tile-size';

interface SizeOption {
  value: DeckTileSize;
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

/** A square glyph whose size hints at the tile scale (decorative; label carries meaning). */
const SizeIcon = ({ inset }: { inset: number }): ReactElement => {
  const dimension = 24 - inset * 2;
  return (
    <svg {...ICON_PROPS}>
      <rect x={inset} y={inset} width={dimension} height={dimension} rx="2" />
    </svg>
  );
};

const SIZE_OPTIONS: ReadonlyArray<SizeOption> = [
  { value: 'x-small', label: 'X-Small', icon: <SizeIcon inset={9} /> },
  { value: 'small', label: 'Small', icon: <SizeIcon inset={7} /> },
  { value: 'medium', label: 'Medium', icon: <SizeIcon inset={5} /> },
  { value: 'large', label: 'Large', icon: <SizeIcon inset={3} /> },
];

const BASE_BUTTON =
  'inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';
const ACTIVE_BUTTON = 'bg-text text-surface';
const INACTIVE_BUTTON = 'text-text-muted hover:bg-surface-raised';

export function DeckSizeControl(): ReactElement {
  const { size, setSize } = useDeckTileSize();
  const radioRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // WAI-ARIA APG radio-group keyboard model: arrows move selection AND focus
  // (wrapping), Home/End jump to the ends. Selecting an option also moves the
  // roving tab stop to it (only the checked radio stays `tabindex="0"`).
  function focusOption(index: number): void {
    const next = SIZE_OPTIONS[index];
    setSize(next.value);
    radioRefs.current[index]?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number): void {
    const last = SIZE_OPTIONS.length - 1;
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
      aria-label="Tile size"
      className="inline-flex w-fit rounded-md border border-border-strong bg-surface p-0.5"
    >
      {SIZE_OPTIONS.map((option, index) => {
        const isActive = size === option.value;
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
            onClick={() => setSize(option.value)}
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
