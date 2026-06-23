/**
 * InboxBulkBar — the multi-select bulk-action bar (DESIGN-INBOX §7, T-f5-inbox-bulk).
 *
 * Presentational: it renders the count of currently-selected Inbox items and the
 * batch triage controls (Mark read / Dismiss / Restore) plus Select all / Clear
 * selection, reporting intent through callbacks. It owns no state and triages
 * nothing itself — {@link InboxView} holds the selection set and wires these
 * actions to the hook's `markReadMany` / `dismissMany` / `restoreMany`.
 *
 * It is an accessible `role="toolbar"` region (`aria-label="Bulk actions"`) so
 * assistive tech announces it as a grouped, keyboard-operable control cluster,
 * and the live selection count is surfaced as text (not colour alone). Each
 * action is disabled when it cannot meaningfully apply to the current selection
 * (e.g. Restore is enabled only when at least one dismissed item is selected).
 * All colour comes from semantic theme tokens, so it recolours with a single
 * `.dark` flip and respects reduced motion.
 */
import type { ReactElement } from 'react';

export interface InboxBulkBarProps {
  /** Number of currently-selected items. */
  count: number;
  /** Enable Mark read (at least one selected item is unread). */
  canMarkRead: boolean;
  /** Enable Dismiss (at least one selected item is not dismissed). */
  canDismiss: boolean;
  /** Enable Restore (at least one selected item is dismissed). */
  canRestore: boolean;
  /** Mark every selected item read. */
  onMarkRead: () => void;
  /** Dismiss every selected item. */
  onDismiss: () => void;
  /** Restore every selected dismissed item. */
  onRestore: () => void;
  /** Select every currently-visible item. */
  onSelectAll: () => void;
  /** Clear the selection. */
  onClear: () => void;
}

const PRIMARY_BUTTON_CLASS =
  'rounded border border-border-strong px-2.5 py-1 text-xs font-medium text-text hover:bg-surface-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-50';

const GHOST_BUTTON_CLASS =
  'rounded px-2.5 py-1 text-xs font-medium text-text-muted hover:text-text hover:bg-surface-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';

export function InboxBulkBar({
  count,
  canMarkRead,
  canDismiss,
  canRestore,
  onMarkRead,
  onDismiss,
  onRestore,
  onSelectAll,
  onClear,
}: InboxBulkBarProps): ReactElement {
  return (
    <div
      role="toolbar"
      aria-label="Bulk actions"
      className="flex flex-wrap items-center gap-2 rounded-md border border-border-strong bg-surface-raised px-3 py-2"
    >
      <span className="text-sm font-medium text-text">{`${count} selected`}</span>
      <span aria-hidden="true" className="h-4 w-px bg-border" />
      <button
        type="button"
        onClick={onMarkRead}
        disabled={!canMarkRead}
        className={PRIMARY_BUTTON_CLASS}
      >
        Mark read
      </button>
      <button
        type="button"
        onClick={onDismiss}
        disabled={!canDismiss}
        className={PRIMARY_BUTTON_CLASS}
      >
        Dismiss
      </button>
      <button
        type="button"
        onClick={onRestore}
        disabled={!canRestore}
        className={PRIMARY_BUTTON_CLASS}
      >
        Restore
      </button>
      <span aria-hidden="true" className="h-4 w-px bg-border" />
      <button type="button" onClick={onSelectAll} className={GHOST_BUTTON_CLASS}>
        Select all
      </button>
      <button type="button" onClick={onClear} className={GHOST_BUTTON_CLASS}>
        Clear selection
      </button>
    </div>
  );
}
