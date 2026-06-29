import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useCommandPalette } from './useCommandPalette';

function dispatchHotkey(init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key: 'k', cancelable: true, ...init });
  act(() => {
    window.dispatchEvent(event);
  });
  return event;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useCommandPalette', () => {
  it('starts closed and exposes open/close/toggle controls', () => {
    const { result } = renderHook(() => useCommandPalette());

    expect(result.current.open).toBe(false);

    act(() => result.current.openPalette());
    expect(result.current.open).toBe(true);

    act(() => result.current.closePalette());
    expect(result.current.open).toBe(false);

    act(() => result.current.toggle());
    expect(result.current.open).toBe(true);
    act(() => result.current.toggle());
    expect(result.current.open).toBe(false);
  });

  it('toggles open on Cmd+K (metaKey)', () => {
    const { result } = renderHook(() => useCommandPalette());

    dispatchHotkey({ metaKey: true });
    expect(result.current.open).toBe(true);

    dispatchHotkey({ metaKey: true });
    expect(result.current.open).toBe(false);
  });

  it('toggles open on Ctrl+K and prevents the default browser action', () => {
    const { result } = renderHook(() => useCommandPalette());

    const event = dispatchHotkey({ ctrlKey: true });

    expect(result.current.open).toBe(true);
    expect(event.defaultPrevented).toBe(true);
  });

  it('ignores a bare "k" without a modifier', () => {
    const { result } = renderHook(() => useCommandPalette());

    dispatchHotkey({});

    expect(result.current.open).toBe(false);
  });

  it('removes its keydown listener on unmount', () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const { unmount } = renderHook(() => useCommandPalette());

    unmount();

    expect(removeSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
  });

  it('does not toggle after unmount', () => {
    const { result, unmount } = renderHook(() => useCommandPalette());
    unmount();

    dispatchHotkey({ metaKey: true });

    expect(result.current.open).toBe(false);
  });
});
