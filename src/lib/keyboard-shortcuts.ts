/**
 * keyboard-shortcuts — the PURE, framework-free core of the power-user keyboard
 * navigation feature. It owns the canonical {@link SHORTCUTS} catalogue (rendered
 * verbatim by {@link ShortcutsHelpOverlay}) and a tiny sequence matcher that the
 * headless {@link useKeyboardShortcuts} hook drives.
 *
 * Keeping this module DOM/React-free makes the `g`-prefix state machine trivially
 * unit-testable: {@link matchShortcut} takes the current pending prefix plus a
 * pressed key and returns the next pending state and/or the action to run.
 *
 * The ⌘K / Ctrl-K command palette is DOCUMENTED here (so the help overlay lists
 * it) but is NOT a bound action — `useCommandPalette` owns that listener and this
 * matcher never returns it.
 */
import type { FleetView } from './view-preference';

/** The buckets shortcuts are grouped under in the help overlay. */
export type ShortcutGroup = 'Navigation' | 'General';

/** Identifiers for the shortcuts this module can actually invoke. */
export type ShortcutActionId =
  | 'navigate-triage'
  | 'navigate-matrix'
  | 'navigate-grid'
  | 'navigate-dashboard'
  | 'navigate-inbox'
  | 'open-help'
  | 'open-settings';

/** A single documented shortcut. `id` doubles as the action id where bound. */
export interface ShortcutDefinition {
  /** Stable id — an action id for bound shortcuts, or `command-palette` (doc-only). */
  id: ShortcutActionId | 'command-palette';
  /** Human-readable key display, e.g. `'g t'`, `'?'`, or `'⌘K / Ctrl K'`. */
  keys: string;
  /** What the shortcut does, shown beside its keys. */
  description: string;
  /** The group heading the shortcut is listed under. */
  group: ShortcutGroup;
}

/** The result of feeding one key into the sequence matcher. */
export interface ShortcutMatch {
  /** The action to invoke, if the key completed a shortcut. */
  action?: ShortcutActionId;
  /** The pending prefix to carry forward (`'g'` mid-sequence, else `null`). */
  pending: string | null;
}

/** Maps each navigation action id to the fleet view it switches to. */
export const NAVIGATION_TARGETS: Record<
  Extract<ShortcutActionId, `navigate-${string}`>,
  FleetView
> = {
  'navigate-triage': 'triage',
  'navigate-matrix': 'matrix',
  'navigate-grid': 'grid',
  'navigate-dashboard': 'dashboard',
  'navigate-inbox': 'inbox',
};

/** The full catalogue, in the order it is presented in the help overlay. */
export const SHORTCUTS: readonly ShortcutDefinition[] = [
  { id: 'navigate-triage', keys: 'g t', description: 'Go to Triage', group: 'Navigation' },
  { id: 'navigate-matrix', keys: 'g m', description: 'Go to Matrix', group: 'Navigation' },
  { id: 'navigate-grid', keys: 'g g', description: 'Go to Grid', group: 'Navigation' },
  { id: 'navigate-dashboard', keys: 'g b', description: 'Go to Boards', group: 'Navigation' },
  { id: 'navigate-inbox', keys: 'g i', description: 'Go to Inbox', group: 'Navigation' },
  { id: 'open-help', keys: '?', description: 'Show keyboard shortcuts', group: 'General' },
  {
    id: 'command-palette',
    keys: '⌘K / Ctrl K',
    description: 'Open command palette',
    group: 'General',
  },
  { id: 'open-settings', keys: ',', description: 'Open Settings', group: 'General' },
];

// The second key of a `g …` sequence, mapped to its navigation action.
const G_SEQUENCE: Record<string, ShortcutActionId> = {
  t: 'navigate-triage',
  m: 'navigate-matrix',
  g: 'navigate-grid',
  b: 'navigate-dashboard',
  i: 'navigate-inbox',
};

// Single-key shortcuts that fire directly from the idle state.
const DIRECT: Record<string, ShortcutActionId> = {
  '?': 'open-help',
  ',': 'open-settings',
};

/**
 * Advances the `g`-prefix state machine by one key.
 *
 * - From idle, `g` starts the sequence (returns `pending: 'g'`, no action).
 * - From a pending `g`, a mapped second key fires its navigation action and
 *   resets; any unmapped key resets without an action.
 * - From idle, a direct single-key shortcut (`?`, `,`) fires immediately.
 * - Anything else resets to idle.
 *
 * Single-character keys are lower-cased so Caps Lock / Shift still matches.
 */
export function matchShortcut(pending: string | null, key: string): ShortcutMatch {
  const normalized = key.length === 1 ? key.toLowerCase() : key;

  if (pending === 'g') {
    const action = G_SEQUENCE[normalized];
    return action === undefined ? { pending: null } : { action, pending: null };
  }

  if (normalized === 'g') {
    return { pending: 'g' };
  }

  const direct = DIRECT[normalized];
  if (direct !== undefined) {
    return { action: direct, pending: null };
  }

  return { pending: null };
}
