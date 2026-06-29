/**
 * DeckSignalOrderList tests — rendering + onMoveSignal callback path (#650).
 *
 * Real @dnd-kit drag is unreliable in jsdom (the component comment calls this
 * out explicitly). Instead we use a seam: the DndContext is replaced by a
 * transparent shim that captures `onDragEnd` while still rendering children
 * normally. dnd-kit ships default context values for InternalContext and
 * SortableContext, so useSortable keeps safe no-drag defaults without a real
 * DndContext provider.
 */
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DragEndEvent } from '@dnd-kit/core';

import { DECK_SIGNALS } from '../../lib/deck-visibility';
import { SIGNAL_LABELS } from '../../lib/grid-keyboard';
import { DeckSignalOrderList } from './DeckSignalOrderList';

const mockSignalDragCapture = {
  fn: undefined as ((event: DragEndEvent) => void) | undefined,
};

vi.mock('@dnd-kit/core', async (importActual) => {
  const actual = await importActual<typeof import('@dnd-kit/core')>();
  return {
    ...actual,
    DndContext: (props: Parameters<typeof actual.DndContext>[0]) => {
      mockSignalDragCapture.fn = props.onDragEnd;
      return props.children ?? null;
    },
  };
});

beforeEach(() => {
  mockSignalDragCapture.fn = undefined;
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('DeckSignalOrderList — rendering', () => {
  it('renders one accessible row button per signal in order', () => {
    render(<DeckSignalOrderList signalOrder={[...DECK_SIGNALS]} onMoveSignal={vi.fn()} />);

    for (const signal of DECK_SIGNALS) {
      expect(
        screen.getByRole('button', {
          name: new RegExp(`Reorder ${SIGNAL_LABELS[signal]}`, 'i'),
        }),
      ).toBeInTheDocument();
    }
  });
});

describe('DeckSignalOrderList — onMoveSignal callback path (#650)', () => {
  it('calls onMoveSignal with the correct (from, to) indices when a valid drag ends', () => {
    const onMoveSignal = vi.fn();
    render(<DeckSignalOrderList signalOrder={[...DECK_SIGNALS]} onMoveSignal={onMoveSignal} />);

    // Simulate: drag 'ci' (index 0) over 'stale' (index 5) via the captured handler.
    mockSignalDragCapture.fn?.({
      active: { id: 'ci' },
      over: { id: 'stale' },
    } as unknown as DragEndEvent);

    expect(onMoveSignal).toHaveBeenCalledTimes(1);
    expect(onMoveSignal).toHaveBeenCalledWith(0, 5);
  });

  it('calls onMoveSignal for a mid-list move (security → reviews)', () => {
    const onMoveSignal = vi.fn();
    render(<DeckSignalOrderList signalOrder={[...DECK_SIGNALS]} onMoveSignal={onMoveSignal} />);

    // security is at index 1, reviews at index 2 in DECK_SIGNALS.
    mockSignalDragCapture.fn?.({
      active: { id: 'security' },
      over: { id: 'reviews' },
    } as unknown as DragEndEvent);

    expect(onMoveSignal).toHaveBeenCalledWith(1, 2);
  });

  it('does not call onMoveSignal for a no-op drag (same source and target)', () => {
    const onMoveSignal = vi.fn();
    render(<DeckSignalOrderList signalOrder={[...DECK_SIGNALS]} onMoveSignal={onMoveSignal} />);

    mockSignalDragCapture.fn?.({
      active: { id: 'ci' },
      over: { id: 'ci' },
    } as unknown as DragEndEvent);

    expect(onMoveSignal).not.toHaveBeenCalled();
  });

  it('does not call onMoveSignal when dropped outside the list (over is null)', () => {
    const onMoveSignal = vi.fn();
    render(<DeckSignalOrderList signalOrder={[...DECK_SIGNALS]} onMoveSignal={onMoveSignal} />);

    mockSignalDragCapture.fn?.({
      active: { id: 'ci' },
      over: null,
    } as unknown as DragEndEvent);

    expect(onMoveSignal).not.toHaveBeenCalled();
  });
});
