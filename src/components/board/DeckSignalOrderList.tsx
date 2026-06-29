/**
 * DeckSignalOrderList — the drawer's drag-to-reorder list for the Deck's signal
 * columns. The on-grid header strip no longer fits the packed repo-block layout
 * (multiple repos per line), so signal-column order is set here instead: a
 * vertical sortable list whose order applies globally to every repo block.
 *
 * Index logic lives in the pure {@link reorderIndices} helper so it's unit-
 * testable without simulating real pointer/keyboard drag (unreliable in jsdom);
 * each row is a grip `<button>` naming its signal. Pointer + keyboard sensors
 * give Space-pickup / arrow-move / Space-drop with announcements.
 */
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { CSSProperties } from 'react';

import { reorderIndices } from '../../lib/deck-reorder';
import { SIGNAL_LABELS } from '../../lib/grid-keyboard';
import type { TileSignalType } from '../../types/dashboard';

const FOCUS_RING =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';

const ROW_CLASS = `flex w-full cursor-grab items-center gap-2 rounded border border-border-strong bg-surface px-2 py-1.5 text-sm font-medium text-text active:cursor-grabbing ${FOCUS_RING}`;

function SignalRow({ signal }: { signal: TileSignalType }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: signal,
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
      aria-label={`Reorder ${label}`}
      className={ROW_CLASS}
      {...attributes}
      {...listeners}
    >
      <span aria-hidden="true">⠿</span>
      <span>{label}</span>
    </button>
  );
}

export interface DeckSignalOrderListProps {
  /** Signal columns in their current order. */
  signalOrder: readonly TileSignalType[];
  /** Reorders the signal column at `from` to `to` (global order). */
  onMoveSignal: (from: number, to: number) => void;
}

export function DeckSignalOrderList({ signalOrder, onMoveSignal }: DeckSignalOrderListProps) {
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const handleDragEnd = (event: DragEndEvent): void => {
    const move = reorderIndices(signalOrder, event.active.id, event.over?.id);
    if (move !== null) {
      onMoveSignal(move.from, move.to);
    }
  };
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={[...signalOrder]} strategy={verticalListSortingStrategy}>
        <div className="flex flex-col gap-1">
          {signalOrder.map((signal) => (
            <SignalRow key={signal} signal={signal} />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
