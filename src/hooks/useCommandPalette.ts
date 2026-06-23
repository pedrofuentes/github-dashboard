/**
 * useCommandPalette — owns the open/closed state of the ⌘K command palette and
 * installs a single global keydown listener that toggles it on ⌘K (macOS) or
 * Ctrl-K (other platforms). Because the shortcut requires a modifier it is safe
 * to fire even while a text input is focused, so the listener is unconditional;
 * it calls `preventDefault` to suppress the browser's own ⌘K binding. The
 * listener is torn down on unmount.
 */
import { useCallback, useEffect, useState } from 'react';

/** Public shape returned by {@link useCommandPalette}. */
export interface UseCommandPaletteResult {
  /** Whether the palette is currently open. */
  open: boolean;
  /** Opens the palette. */
  openPalette: () => void;
  /** Closes the palette. */
  closePalette: () => void;
  /** Toggles the palette open/closed. */
  toggle: () => void;
}

/** Manages command-palette visibility and the global ⌘K / Ctrl-K shortcut. */
export function useCommandPalette(): UseCommandPaletteResult {
  const [open, setOpen] = useState(false);

  const openPalette = useCallback(() => setOpen(true), []);
  const closePalette = useCallback(() => setOpen(false), []);
  const toggle = useCallback(() => setOpen((current) => !current), []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        toggle();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggle]);

  return { open, openPalette, closePalette, toggle };
}
