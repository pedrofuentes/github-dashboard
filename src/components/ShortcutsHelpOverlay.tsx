/**
 * ShortcutsHelpOverlay — the discoverable "press ?" cheat-sheet. It renders the
 * canonical {@link SHORTCUTS} catalogue grouped by `group`, plus a short pointer
 * to the ⌘K command palette and Saved Views, so every new navigation surface is
 * self-documenting.
 *
 * Accessibility mirrors {@link SettingsOverlay}: a centred `role="dialog"` /
 * `aria-modal` panel labelled by its heading, focus moves inside on open, Tab is
 * trapped, `Esc` or a backdrop click closes, and focus returns to the opener on
 * unmount. The parent guards rendering (mounted only while open), matching the
 * SettingsOverlay convention. Tokens only and reduced-motion safe (no
 * transitions). Keys render as `<kbd>`-style chips.
 */
import { Fragment, useEffect, useId, useMemo, useRef } from 'react';
import type { KeyboardEvent, ReactElement } from 'react';

import { SHORTCUTS } from '../lib/keyboard-shortcuts';
import type { ShortcutDefinition, ShortcutGroup } from '../lib/keyboard-shortcuts';

interface ShortcutsHelpOverlayProps {
  /** Closes the overlay and returns focus to the opener. */
  onClose: () => void;
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// The order groups are presented in the overlay.
const GROUP_ORDER: readonly ShortcutGroup[] = ['Navigation', 'General'];

function getFocusableElements(root: HTMLElement | null): HTMLElement[] {
  if (root === null) {
    return [];
  }
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
}

function groupShortcuts(
  shortcuts: readonly ShortcutDefinition[],
): Array<{ group: ShortcutGroup; items: ShortcutDefinition[] }> {
  return GROUP_ORDER.map((group) => ({
    group,
    items: shortcuts.filter((shortcut) => shortcut.group === group),
  })).filter((section) => section.items.length > 0);
}

/** Renders a shortcut's display keys as tokenised `<kbd>` chips. */
function ShortcutKeys({ keys }: { keys: string }): ReactElement {
  const tokens = keys.split(' ');
  return (
    <span className="flex items-center gap-1">
      {tokens.map((token, index) =>
        token === '/' ? (
          <span key={`sep-${index}`} aria-hidden="true" className="text-text-muted">
            /
          </span>
        ) : (
          <kbd
            key={`${token}-${index}`}
            className="inline-flex min-w-[1.5rem] items-center justify-center rounded border border-border-strong bg-surface-raised px-1.5 py-0.5 text-xs font-medium text-text"
          >
            {token}
          </kbd>
        ),
      )}
    </span>
  );
}

export function ShortcutsHelpOverlay({ onClose }: ShortcutsHelpOverlayProps): ReactElement {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const sections = useMemo(() => groupShortcuts(SHORTCUTS), []);

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
        data-testid="shortcuts-help-backdrop"
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
            Keyboard shortcuts
          </h2>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Close keyboard shortcuts"
            className="shrink-0 rounded p-1 text-text-muted hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            <span aria-hidden="true">✕</span>
          </button>
        </div>

        <div className="mt-4 flex flex-col gap-6">
          {sections.map((section) => {
            const sectionLabelId = `${titleId}-${section.group}`;
            return (
              <section key={section.group} aria-labelledby={sectionLabelId}>
                <h3
                  id={sectionLabelId}
                  className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted"
                >
                  {section.group}
                </h3>
                <dl className="flex flex-col gap-1.5">
                  {section.items.map((shortcut) => (
                    <Fragment key={shortcut.id}>
                      <div className="flex items-center justify-between gap-4">
                        <dt className="text-sm text-text">{shortcut.description}</dt>
                        <dd>
                          <ShortcutKeys keys={shortcut.keys} />
                        </dd>
                      </div>
                    </Fragment>
                  ))}
                </dl>
              </section>
            );
          })}
        </div>

        <p className="mt-6 border-t border-border pt-4 text-sm text-text-muted">
          Press{' '}
          <kbd className="rounded border border-border-strong bg-surface-raised px-1 py-0.5 text-xs">
            ⌘K
          </kbd>{' '}
          to open the command palette, and use Saved Views for filter + view presets.
        </p>
      </div>
    </div>
  );
}
