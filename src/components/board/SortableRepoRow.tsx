/**
 * SortableRepoRow — one draggable repo row for the Deck matrix's edit mode.
 *
 * Wraps a repo's signal-key cells with `@dnd-kit/sortable` so the whole row can
 * be reordered by pointer or keyboard. The drag affordance is a dedicated grip
 * `<button>` carrying the sortable `attributes`/`listeners` (so only the grip
 * starts a drag — the keys themselves stay independently focusable), with an
 * accessible name naming the repo. The grid of cells keeps the matrix's
 * `data-repo-row` seam + per-column template so column alignment is unchanged.
 */
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { CSSProperties, ReactNode } from 'react';

const FOCUS_RING =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';

const GRIP_CLASS = `inline-flex h-7 w-5 shrink-0 cursor-grab items-center justify-center rounded text-text-muted hover:text-text active:cursor-grabbing ${FOCUS_RING}`;

const REMOVE_CLASS = `inline-flex h-7 w-5 shrink-0 items-center justify-center rounded text-text-muted hover:text-text ${FOCUS_RING}`;

export interface SortableRepoRowProps {
  /** Sortable id — the repo's `nameWithOwner`. */
  id: string;
  /** Human label for the grip's accessible name (the repo's `nameWithOwner`). */
  label: string;
  /** The per-column grid template for the row's signal cells (model C). */
  rowStyle: CSSProperties;
  /** The repo's signal-key cells. */
  children: ReactNode;
  /**
   * When supplied, renders a remove (✕) control after the drag grip that hides
   * the whole repo row. The control is a plain sibling button — it never carries
   * the sortable drag listeners, so removing and dragging stay independent.
   */
  onRemove?: () => void;
  /** Accessible name for the remove control (required when `onRemove` is set). */
  removeLabel?: string;
}

export function SortableRepoRow({
  id,
  label,
  rowStyle,
  children,
  onRemove,
  removeLabel,
}: SortableRepoRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    // Lift the dragged row above its siblings; reduced-motion users still get the
    // transform (no animation) since dnd-kit drives it directly, not via CSS keyframes.
    zIndex: isDragging ? 10 : undefined,
    opacity: isDragging ? 0.85 : undefined,
  };

  return (
    <div ref={setNodeRef} style={style} className="flex items-center gap-2">
      <button
        type="button"
        aria-label={`Reorder ${label}`}
        className={GRIP_CLASS}
        {...attributes}
        {...listeners}
      >
        <svg width={14} height={14} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="9" cy="6" r="1.6" />
          <circle cx="15" cy="6" r="1.6" />
          <circle cx="9" cy="12" r="1.6" />
          <circle cx="15" cy="12" r="1.6" />
          <circle cx="9" cy="18" r="1.6" />
          <circle cx="15" cy="18" r="1.6" />
        </svg>
      </button>
      {onRemove !== undefined ? (
        <button type="button" aria-label={removeLabel} onClick={onRemove} className={REMOVE_CLASS}>
          <span aria-hidden="true">✕</span>
        </button>
      ) : null}
      <div data-repo-row={id} className="grid flex-1 gap-3" style={rowStyle}>
        {children}
      </div>
    </div>
  );
}
