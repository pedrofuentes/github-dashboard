/**
 * SettingsOverlay — a single, accessible modal that consolidates the app's
 * scattered preference controls (previously a header Theme + Density toggle, a
 * toolbar Default-view toggle and an authenticated-as / Forget-token bar) into
 * one place, addressing the "controls everywhere" complaint.
 *
 * It is a centred `role="dialog"` / `aria-modal` panel labelled by its heading.
 * Accessibility mirrors {@link CustomizePanel} / {@link DrillDownDrawer}: focus
 * moves inside on open, Tab is trapped, `Esc` or a backdrop click closes, and
 * focus returns to the opener on unmount. It REUSES the existing
 * {@link ThemeToggle} / {@link DensityToggle} / {@link RepoOwnerToggle} /
 * {@link DefaultViewToggle} components unchanged. The Defaults + Account sections
 * only render when a user is authenticated (`user !== null`); Appearance is
 * always available. Auth requires a stored GitHub personal access token (PAT);
 * reduced-motion safe (no transitions).
 */
import { useEffect, useId, useRef } from 'react';
import type { KeyboardEvent, ReactElement } from 'react';

import { DefaultViewToggle } from './DefaultViewToggle';
import { DensityToggle } from './DensityToggle';
import { RepoOwnerToggle } from './RepoOwnerToggle';
import { ThemeToggle } from './ThemeToggle';
import type { FleetView } from '../lib/view-preference';
import type { AuthUser } from '../types/auth';

interface SettingsOverlayProps {
  /** The persisted default view, reflected by the Defaults control. */
  defaultView: FleetView;
  /** Persists a new default view and switches the live view to it. */
  onDefaultViewChange: (view: FleetView) => void;
  /** The signed-in identity, or `null` when unauthenticated (hides Account + Defaults). */
  user: AuthUser | null;
  /** Forgets the stored token (signs out). */
  onForget: () => void;
  /** Closes the overlay and returns focus to the opener. */
  onClose: () => void;
}

// Mirrors CustomizePanel's trap selector so the toggles, radios, inputs and the
// close/forget buttons all participate in the Tab focus cycle.
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function getFocusableElements(root: HTMLElement | null): HTMLElement[] {
  if (root === null) {
    return [];
  }
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
}

export function SettingsOverlay({
  defaultView,
  onDefaultViewChange,
  user,
  onForget,
  onClose,
}: SettingsOverlayProps): ReactElement {
  const titleId = useId();
  const appearanceLabelId = useId();
  const themeLabelId = useId();
  const densityLabelId = useId();
  const repoOwnerLabelId = useId();
  const accountLabelId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus();
    return () => {
      previouslyFocused?.focus?.();
    };
  }, []);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== 'Tab') {
      return;
    }
    const focusables = getFocusableElements(dialogRef.current);
    if (focusables.length === 0) {
      event.preventDefault();
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 sm:items-center">
      <div
        data-testid="settings-backdrop"
        aria-hidden="true"
        onClick={onClose}
        className="absolute inset-0 bg-[color-mix(in_srgb,var(--color-bg)_70%,transparent)]"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={handleKeyDown}
        className="relative flex max-h-[90vh] w-full max-w-md flex-col overflow-y-auto rounded-lg border border-border-strong bg-surface-overlay p-6 text-text shadow-xl"
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id={titleId} className="text-lg font-semibold text-text">
            Settings
          </h2>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            className="shrink-0 rounded p-1 text-text-muted hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            <span aria-hidden="true">✕</span>
          </button>
        </div>

        <div className="mt-4 flex flex-col gap-6">
          <section aria-labelledby={appearanceLabelId} className="flex flex-col gap-4">
            <h3
              id={appearanceLabelId}
              className="text-xs font-semibold uppercase tracking-wide text-text-muted"
            >
              Appearance
            </h3>
            <div className="flex flex-col gap-2">
              <span id={themeLabelId} className="text-sm font-medium text-text">
                Theme
              </span>
              <ThemeToggle />
            </div>
            <div className="flex flex-col gap-2">
              <span id={densityLabelId} className="text-sm font-medium text-text">
                Density
              </span>
              <DensityToggle />
            </div>
            <div className="flex flex-col gap-2">
              <span id={repoOwnerLabelId} className="text-sm font-medium text-text">
                Repository names
              </span>
              <RepoOwnerToggle />
            </div>
          </section>

          {user !== null ? (
            <>
              <section className="flex flex-col gap-3 border-t border-border pt-4">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                  Defaults
                </h3>
                <DefaultViewToggle value={defaultView} onChange={onDefaultViewChange} />
              </section>

              <section
                aria-labelledby={accountLabelId}
                className="flex flex-col gap-3 border-t border-border pt-4"
              >
                <h3
                  id={accountLabelId}
                  className="text-xs font-semibold uppercase tracking-wide text-text-muted"
                >
                  Account
                </h3>
                <div className="flex items-center gap-3">
                  {user.avatarUrl !== undefined ? (
                    <img
                      src={user.avatarUrl}
                      alt=""
                      width={32}
                      height={32}
                      className="h-8 w-8 rounded-full"
                    />
                  ) : (
                    <span
                      aria-hidden="true"
                      className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-raised text-sm font-semibold text-text-muted"
                    >
                      {user.login.slice(0, 1).toUpperCase()}
                    </span>
                  )}
                  <p className="text-sm text-text-muted">{`Authenticated as ${user.login}`}</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    onForget();
                    onClose();
                  }}
                  className="w-fit rounded border border-border-strong px-3 py-1 text-sm font-medium text-text hover:bg-surface-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                >
                  Forget token
                </button>
              </section>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
