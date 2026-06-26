/**
 * FullWindowOverlay — an immersive, chrome-less surface that fills the browser
 * window so a single view (Deck, Matrix, …) can be read full-bleed, e.g. on a
 * wall display. It is a *mode*, not a modal dialog: a labelled landmark region
 * (`role="region"`) fixed over the app, with a thin top bar carrying the view
 * label + an Exit control (and optional view-specific controls), and the view
 * itself in a scrollable body below.
 *
 * Accessibility: the bar exposes an "Exit full window" button; `Esc` also exits.
 * Focus moves to the Exit button on open and is restored to the opener on close,
 * mirroring the drill-down drawer. All styling is token-based so it flips with
 * the theme, and there is no animation (reduced-motion safe).
 */
import { useEffect, useRef } from 'react';
import type { KeyboardEvent, ReactElement, ReactNode } from 'react';

interface FullWindowOverlayProps {
  /** The active view's human label (e.g. `Deck`), shown in the bar + region name. */
  label: string;
  /** Leaves full-window mode (wired to the Exit button and the `Esc` key). */
  onExit: () => void;
  /** Optional view-specific controls rendered in the bar (e.g. the deck size control). */
  controls?: ReactNode;
  /** The view surface to render full-bleed. */
  children: ReactNode;
}

const EXIT_ICON_PROPS = {
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

function ExitFullWindowIcon(): ReactElement {
  return (
    <svg {...EXIT_ICON_PROPS}>
      <path d="M9 9 4 4m0 0v4m0-4h4" />
      <path d="M15 9l5-5m0 0v4m0-4h-4" />
      <path d="M9 15l-5 5m0 0v-4m0 4h4" />
      <path d="M15 15l5 5m0 0v-4m0 4h-4" />
    </svg>
  );
}

export function FullWindowOverlay({
  label,
  onExit,
  controls,
  children,
}: FullWindowOverlayProps): ReactElement {
  const exitRef = useRef<HTMLButtonElement>(null);

  // Move focus into the overlay on open and restore it to the opener on close,
  // so keyboard users land on the Exit control and return where they were.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    exitRef.current?.focus();
    return () => {
      previouslyFocused?.focus?.();
    };
  }, []);

  function handleKeyDown(event: KeyboardEvent<HTMLElement>): void {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onExit();
    }
  }

  return (
    <section
      role="region"
      aria-label={`${label} — full window`}
      onKeyDown={handleKeyDown}
      className="fixed inset-0 z-40 flex flex-col bg-bg text-text"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface px-4 py-2">
        <h2 className="text-sm font-semibold text-text">{label}</h2>
        <div className="flex flex-wrap items-center gap-3">
          {controls}
          <button
            ref={exitRef}
            type="button"
            onClick={onExit}
            className="inline-flex items-center gap-1.5 rounded-md border border-border-strong bg-surface px-3 py-1 text-sm font-medium text-text hover:bg-surface-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            <ExitFullWindowIcon />
            <span>Exit full window</span>
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4">{children}</div>
    </section>
  );
}
