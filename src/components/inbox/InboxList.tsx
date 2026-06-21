/**
 * InboxList — the accessible list wrapper for Inbox rows (DESIGN-INBOX §6.2, §7).
 *
 * Presentational: it lays the derived items out as a semantic list (`role="list"`
 * of `listitem` rows) in the order it receives them (the hook already sorts
 * newest-first, §4.1) and forwards each row's triage callbacks. It renders no
 * empty/loading/error copy — those states live in {@link InboxView} — so an empty
 * `items` array simply yields a list with no rows.
 */
import type { ReactElement } from 'react';

import type { InboxItemView } from '../../hooks/useInbox';
import { InboxItemRow } from './InboxItemRow';

export interface InboxListProps {
  /** Filtered, newest-first items to render. */
  items: InboxItemView[];
  /** Marks one item read (fired on open/click). */
  onMarkRead: (id: string) => void;
  /** Dismisses (archives) one item. */
  onDismiss: (id: string) => void;
  /** Restores a previously dismissed item. */
  onRestore: (id: string) => void;
}

export function InboxList({
  items,
  onMarkRead,
  onDismiss,
  onRestore,
}: InboxListProps): ReactElement {
  return (
    <ul role="list" aria-label="Inbox items" className="flex flex-col gap-2">
      {items.map((item) => (
        <InboxItemRow
          key={item.id}
          item={item}
          onMarkRead={onMarkRead}
          onDismiss={onDismiss}
          onRestore={onRestore}
        />
      ))}
    </ul>
  );
}
