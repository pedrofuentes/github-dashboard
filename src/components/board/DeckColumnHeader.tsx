/**
 * DeckColumnHeader — the draggable signal-column header strip for the Deck
 * matrix's edit mode. Renders one sortable header per signal column (in the
 * current column order) that can be reordered by pointer or keyboard, setting a
 * global column order applied across every repo row.
 *
 * It aligns with the matrix columns by reusing the same per-column grid template
 * (`rowStyle`) and, when the rows show a leading drag grip, a matching leading
 * spacer. Each header is a real `<button>` carrying the sortable
 * `attributes`/`listeners` with an accessible name naming the signal.
 *
 * The component renders the headers but NOT the `DndContext`/`SortableContext` —
 * those are owned by {@link BoardView}, which hosts a single context for both the
 * row and column sortable axes.
 */
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { CSSProperties } from 'react';

import { deckColumnId } from '../../lib/deck-reorder';
import { SIGNAL_LABELS } from '../../lib/grid-keyboard';
import type { TileSignalType } from '../../types/dashboard';

const FOCUS_RING =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';

const HEADER_CLASS = `inline-flex h-7 w-full cursor-grab items-center justify-center gap-1 truncate rounded border border-border-strong bg-surface px-1.5 text-xs font-medium text-text-muted hover:text-text active:cursor-grabbing ${FOCUS_RING}`;

function ColumnHeaderButton({ signal }: { signal: TileSignalType }) {
  const id = deckColumnId(signal);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : undefined,
    opacity: isDragging ? 0.85 : undefined,
  };
  const label = SIGNAL_LABELS[signal];
  return (
    <button
      ref={setNodeRef}
      type="button"
      style={style}
      aria-label={`Reorder ${label} column`}
      className={HEADER_CLASS}
      {...attributes}
      {...listeners}
    >
      <span aria-hidden="true" className="truncate">
        {label}
      </span>
    </button>
  );
}

export interface DeckColumnHeaderProps {
  /** Signal columns in their current order. */
  signals: readonly TileSignalType[];
  /** The per-column grid template (model C) — aligns headers with the cells. */
  rowStyle: CSSProperties;
  /** Render a leading spacer matching the rows' drag grip, to keep alignment. */
  gutter: boolean;
}

export function DeckColumnHeader({ signals, rowStyle, gutter }: DeckColumnHeaderProps) {
  return (
    <div role="group" aria-label="Reorder signal columns" className="flex items-center gap-2">
      {gutter ? <span aria-hidden="true" className="h-7 w-5 shrink-0" /> : null}
      <div className="grid flex-1 gap-3" style={rowStyle}>
        {signals.map((signal) => (
          <ColumnHeaderButton key={signal} signal={signal} />
        ))}
      </div>
    </div>
  );
}
