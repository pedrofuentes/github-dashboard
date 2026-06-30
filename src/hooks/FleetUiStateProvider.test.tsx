import { act, renderHook } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { FleetUiStateProvider } from './FleetUiStateProvider';
import { useFleetSelection } from './useFleetSelection';

function wrapper({ children }: { children: ReactNode }): ReactElement {
  return <FleetUiStateProvider>{children}</FleetUiStateProvider>;
}

describe('useFleetSelection', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('throws a helpful error when used outside a FleetUiStateProvider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => renderHook(() => useFleetSelection())).toThrow(/FleetUiStateProvider/);
  });

  it('starts empty', () => {
    const { result } = renderHook(() => useFleetSelection(), { wrapper });
    expect(result.current.selectedCount).toBe(0);
    expect(result.current.selected.size).toBe(0);
    expect(result.current.isSelected('a/x')).toBe(false);
  });

  it('toggle adds then removes an id', () => {
    const { result } = renderHook(() => useFleetSelection(), { wrapper });

    act(() => result.current.toggle('a/x'));
    expect(result.current.isSelected('a/x')).toBe(true);
    expect(result.current.selectedCount).toBe(1);

    act(() => result.current.toggle('a/x'));
    expect(result.current.isSelected('a/x')).toBe(false);
    expect(result.current.selectedCount).toBe(0);
  });

  it('selectAll replaces the selection with the given ids', () => {
    const { result } = renderHook(() => useFleetSelection(), { wrapper });

    act(() => result.current.toggle('a/x'));
    act(() => result.current.selectAll(['b/y', 'c/z']));

    expect(result.current.isSelected('a/x')).toBe(false);
    expect(result.current.isSelected('b/y')).toBe(true);
    expect(result.current.isSelected('c/z')).toBe(true);
    expect(result.current.selectedCount).toBe(2);
  });

  it('selectAll deduplicates repeated ids', () => {
    const { result } = renderHook(() => useFleetSelection(), { wrapper });

    act(() => result.current.selectAll(['a/x', 'a/x', 'b/y']));

    expect(result.current.selectedCount).toBe(2);
    expect(result.current.isSelected('a/x')).toBe(true);
    expect(result.current.isSelected('b/y')).toBe(true);
  });

  it('invert selects the currently-unselected and deselects the currently-selected within the id universe', () => {
    const { result } = renderHook(() => useFleetSelection(), { wrapper });
    const universe = ['a/x', 'b/y', 'c/z'];

    act(() => result.current.toggle('a/x'));
    act(() => result.current.invert(universe));

    expect(result.current.isSelected('a/x')).toBe(false);
    expect(result.current.isSelected('b/y')).toBe(true);
    expect(result.current.isSelected('c/z')).toBe(true);
    expect(result.current.selectedCount).toBe(2);
  });

  it('invert leaves ids outside the given universe untouched', () => {
    const { result } = renderHook(() => useFleetSelection(), { wrapper });

    act(() => result.current.selectAll(['out/side', 'a/x']));
    act(() => result.current.invert(['a/x', 'b/y']));

    expect(result.current.isSelected('out/side')).toBe(true);
    expect(result.current.isSelected('a/x')).toBe(false);
    expect(result.current.isSelected('b/y')).toBe(true);
    expect(result.current.selectedCount).toBe(2);
  });

  it('clear empties the selection', () => {
    const { result } = renderHook(() => useFleetSelection(), { wrapper });

    act(() => result.current.selectAll(['a/x', 'b/y']));
    act(() => result.current.clear());

    expect(result.current.selectedCount).toBe(0);
    expect(result.current.selected.size).toBe(0);
  });

  it('does not mutate the ids array passed to selectAll', () => {
    const { result } = renderHook(() => useFleetSelection(), { wrapper });
    const ids = ['a/x', 'b/y'];
    const snapshot = [...ids];

    act(() => result.current.selectAll(ids));

    expect(ids).toEqual(snapshot);
  });

  it('does not mutate the ids array passed to invert', () => {
    const { result } = renderHook(() => useFleetSelection(), { wrapper });
    const ids = ['a/x', 'b/y'];
    const snapshot = [...ids];

    act(() => result.current.invert(ids));

    expect(ids).toEqual(snapshot);
  });

  it('does not mutate the previous selected set when toggling', () => {
    const { result } = renderHook(() => useFleetSelection(), { wrapper });

    act(() => result.current.toggle('a/x'));
    const previous = result.current.selected;

    act(() => result.current.toggle('b/y'));

    expect(previous).not.toBe(result.current.selected);
    expect(previous.has('b/y')).toBe(false);
    expect(previous.size).toBe(1);
  });

  it('does not mutate the previous selected set when inverting', () => {
    const { result } = renderHook(() => useFleetSelection(), { wrapper });

    act(() => result.current.toggle('a/x'));
    const previous = result.current.selected;

    act(() => result.current.invert(['a/x', 'b/y', 'c/z']));

    expect(previous).not.toBe(result.current.selected);
    expect(previous.has('a/x')).toBe(true);
    expect(previous.has('b/y')).toBe(false);
    expect(previous.size).toBe(1);
  });
});
