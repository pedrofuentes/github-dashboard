/**
 * useKeyboardShortcuts — a headless hook that wires the pure
 * {@link matchShortcut} state machine to a single global `keydown` listener and
 * the caller's handler map. It adds the power-user `g`-prefix navigation
 * sequences (e.g. `g i` → Inbox), `?` → help, and `,` → Settings.
 *
 * Guards (so shortcuts never hijack typing or browser/OS chords):
 * - while any modal is open (an element with `aria-modal="true"`, e.g. the help
 *   or settings overlay or the ⌘K palette), all shortcuts are suppressed so they
 *   never act on the content behind the modal;
 * - events whose target is an `<input>`, `<textarea>`, `<select>` or a
 *   `contenteditable` element are ignored — EXCEPT `Escape`, which always
 *   resets a half-typed sequence;
 * - events carrying `metaKey`, `ctrlKey` or `altKey` are ignored, so ⌘K / Ctrl-K
 *   (owned by `useCommandPalette`) and browser chords pass through untouched.
 *   `?` arrives as Shift + `/`, and a bare `shiftKey` is allowed.
 *
 * The `g` prefix resets after ~1s of inactivity. The listener and its timer are
 * torn down on unmount, and the latest handlers are read through a ref so the
 * effect stays mounted once (no re-registration churn).
 */
import { useEffect, useRef } from 'react';

import { matchShortcut, NAVIGATION_TARGETS } from '../lib/keyboard-shortcuts';
import type { FleetView } from '../lib/view-preference';

/** The actions {@link useKeyboardShortcuts} can invoke. */
export interface KeyboardShortcutHandlers {
  /** Switch the live fleet view (driven by the `g …` navigation sequences). */
  navigate: (view: FleetView) => void;
  /** Open the keyboard-shortcuts help overlay (`?`). */
  openHelp: () => void;
  /** Open the settings overlay (`,`); optional — only bound when provided. */
  openSettings?: () => void;
}

/** How long (ms) a pending `g` prefix waits for its second key before resetting. */
const SEQUENCE_TIMEOUT_MS = 1000;

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
    return true;
  }
  // `isContentEditable` reflects effective editability in real browsers; also
  // check the attribute directly (`""`/`"true"`) since jsdom under-implements it.
  const contentEditable = target.getAttribute('contenteditable');
  if (contentEditable !== null && contentEditable !== 'false') {
    return true;
  }
  return target.isContentEditable;
}

/** Installs the global shortcut listener for the lifetime of the component. */
export function useKeyboardShortcuts(handlers: KeyboardShortcutHandlers): void {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    let pending: string | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    function clearTimer(): void {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    }

    function handleKeyDown(event: KeyboardEvent): void {
      // While any modal is open (help/settings overlays or the ⌘K palette, all
      // of which set `aria-modal="true"`), suppress global shortcuts so they
      // never act on the content behind the modal. The pending `g` prefix is
      // reset so a half-typed sequence cannot survive across the modal.
      if (document.querySelector('[aria-modal="true"]') !== null) {
        pending = null;
        clearTimer();
        return;
      }
      // Escape always cancels a half-typed sequence, even from within an input.
      if (event.key === 'Escape') {
        pending = null;
        clearTimer();
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      if (isEditableTarget(event.target)) {
        return;
      }

      const result = matchShortcut(pending, event.key);

      clearTimer();
      pending = result.pending;
      if (pending !== null) {
        timer = setTimeout(() => {
          pending = null;
          timer = null;
        }, SEQUENCE_TIMEOUT_MS);
      }

      if (result.action === undefined) {
        return;
      }

      event.preventDefault();
      if (result.action === 'open-help') {
        handlersRef.current.openHelp();
        return;
      }
      if (result.action === 'open-settings') {
        handlersRef.current.openSettings?.();
        return;
      }
      handlersRef.current.navigate(NAVIGATION_TARGETS[result.action]);
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      clearTimer();
    };
  }, []);
}
