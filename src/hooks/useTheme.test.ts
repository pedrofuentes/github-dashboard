import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useTheme } from './useTheme';

const THEME_KEY = 'fleet:theme';

interface MediaQueryListStub {
  matches: boolean;
  media: string;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
  fireChange: (matches: boolean) => void;
}

function installMatchMedia(initialMatches: boolean): MediaQueryListStub {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const stub: MediaQueryListStub = {
    matches: initialMatches,
    media: '(prefers-color-scheme: dark)',
    addEventListener: vi.fn((_event: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.add(listener);
    }),
    removeEventListener: vi.fn((_event: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.delete(listener);
    }),
    fireChange(matches: boolean) {
      stub.matches = matches;
      const event = { matches, media: stub.media } as MediaQueryListEvent;
      listeners.forEach((listener) => listener(event));
    },
  };
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      matches: stub.matches,
      media: stub.media,
      addEventListener: stub.addEventListener,
      removeEventListener: stub.removeEventListener,
    })),
  );
  return stub;
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove('dark');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

afterEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove('dark');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('useTheme', () => {
  it('initialises from the stored preference', () => {
    localStorage.setItem(THEME_KEY, 'dark');
    installMatchMedia(false);
    const { result } = renderHook(() => useTheme());
    expect(result.current.choice).toBe('dark');
    expect(result.current.resolved).toBe('dark');
  });

  it('defaults to "system" and resolves via matchMedia', () => {
    installMatchMedia(true);
    const { result } = renderHook(() => useTheme());
    expect(result.current.choice).toBe('system');
    expect(result.current.resolved).toBe('dark');
  });

  it('applies the resolved theme to the document on mount', () => {
    localStorage.setItem(THEME_KEY, 'dark');
    installMatchMedia(false);
    renderHook(() => useTheme());
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('persists and applies a new choice via setChoice', () => {
    installMatchMedia(false);
    const { result } = renderHook(() => useTheme());

    act(() => {
      result.current.setChoice('dark');
    });

    expect(result.current.choice).toBe('dark');
    expect(result.current.resolved).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    // Assert persistence via the stored value (not a setItem spy — see #124).
    expect(localStorage.getItem(THEME_KEY)).toBe('dark');
  });

  it('re-applies live when the OS preference changes while in "system"', () => {
    const media = installMatchMedia(false);
    const { result } = renderHook(() => useTheme());
    expect(result.current.resolved).toBe('light');

    act(() => {
      media.fireChange(true);
    });

    expect(result.current.resolved).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('does not track the OS preference once a concrete choice is set', () => {
    const media = installMatchMedia(false);
    const { result } = renderHook(() => useTheme());

    act(() => {
      result.current.setChoice('light');
    });

    act(() => {
      media.fireChange(true);
    });

    expect(result.current.resolved).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('removes the matchMedia listener on unmount', () => {
    const media = installMatchMedia(false);
    const { unmount } = renderHook(() => useTheme());
    unmount();
    expect(media.removeEventListener).toHaveBeenCalled();
  });

  it('does not throw when matchMedia is present but throws (sandboxed iframe / override)', () => {
    // A present-but-hostile `matchMedia` (e.g. a sandboxed iframe or extension
    // override) throws when invoked. An exception escaping the live-update
    // effect would unmount the tree → blank dashboard (#197); the hook must
    // swallow it and still render from the persisted/default choice.
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => {
        throw new Error('matchMedia blocked');
      }),
    );

    let result: { current: ReturnType<typeof useTheme> } | undefined;
    expect(() => {
      result = renderHook(() => useTheme()).result;
    }).not.toThrow();

    // The app still renders: the hook resolves to a concrete, safe theme.
    expect(result?.current.choice).toBe('system');
    expect(result?.current.resolved).toBe('light');
  });
});
