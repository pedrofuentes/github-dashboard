import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_LAYOUT } from '../lib/dashboard-layout';
import type { GetRowData, Repo } from '../types/fleet';

/**
 * react-grid-layout never fires `onLayoutChange` from a real pointer drag in
 * jsdom (it reports a 0px container). To exercise DashboardView's drag-to-persist
 * wiring we mock the grid with a stub that re-emits the prop on demand: one
 * button triggers a geometry change, another re-emits the *current* geometry (a
 * no-op, as on mount / breakpoint switch).
 */
interface MockGridProps {
  children: ReactElement[];
  layouts: { lg: Array<{ i: string; x: number; y: number; w: number; h: number }> };
  onLayoutChange: (
    layout: Array<{ i: string; x: number; y: number; w: number; h: number }>,
    layouts: unknown,
  ) => void;
}

vi.mock('react-grid-layout/legacy', () => ({
  Responsive: () => null,
  WidthProvider: () =>
    function MockGrid(props: MockGridProps): ReactElement {
      const current = props.layouts.lg;
      const moved = current.map((item, index) =>
        index === 0 ? { ...item, x: 6, y: 4, w: 4, h: 3 } : item,
      );
      return (
        <div>
          <button type="button" onClick={() => props.onLayoutChange(moved, props.layouts)}>
            move-first-tile
          </button>
          <button type="button" onClick={() => props.onLayoutChange(current, props.layouts)}>
            emit-unchanged
          </button>
          {props.children}
        </div>
      );
    },
}));

// Imported after the mock so DashboardView picks up the stubbed grid.
const { DashboardView } = await import('./DashboardView');

const STORAGE_KEY = 'fleet:dashboard-layout';

function makeRepo(nameWithOwner: string): Repo {
  const [owner, name] = nameWithOwner.split('/');
  return { nameWithOwner, owner, name, isPrivate: false };
}

const emptyData: GetRowData = () => ({});

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
  vi.useRealTimers();
});

describe('DashboardView onLayoutChange wiring', () => {
  it('persists a pointer layout change, debounced into a single write', () => {
    vi.useFakeTimers();
    const setItemSpy = vi.spyOn(localStorage, 'setItem');
    render(
      <DashboardView
        repos={[makeRepo('octo/a')]}
        getRowData={emptyData}
        onRepoActivate={vi.fn()}
        editing
      />,
    );

    fireEvent.click(screen.getByText('move-first-tile'));
    // The write is deferred until the debounce settles.
    expect(setItemSpy).not.toHaveBeenCalledWith(STORAGE_KEY, expect.anything());

    act(() => {
      vi.advanceTimersByTime(300);
    });

    const writes = setItemSpy.mock.calls.filter(([key]) => key === STORAGE_KEY);
    expect(writes).toHaveLength(1);
    const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    const first = persisted.find(
      (t: { i: string }) => t.i === DEFAULT_LAYOUT([makeRepo('octo/a')])[0].i,
    );
    expect(first).toMatchObject({ x: 6, y: 4, w: 4, h: 3 });
  });

  it('ignores a no-op onLayoutChange (no geometry change → no write)', () => {
    vi.useFakeTimers();
    const setItemSpy = vi.spyOn(localStorage, 'setItem');
    render(
      <DashboardView
        repos={[makeRepo('octo/a')]}
        getRowData={emptyData}
        onRepoActivate={vi.fn()}
        editing
      />,
    );

    fireEvent.click(screen.getByText('emit-unchanged'));
    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(setItemSpy).not.toHaveBeenCalledWith(STORAGE_KEY, expect.anything());
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});
