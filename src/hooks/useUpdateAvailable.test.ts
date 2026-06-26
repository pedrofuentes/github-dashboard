import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const buildInfoMock = vi.hoisted(() => ({
  value: {
    version: '1.0.0',
    sha: 'abc1234',
    builtAt: '2026-06-25T00:00:00.000Z',
  },
}));

vi.mock('../lib/build-info', () => ({
  get buildInfo() {
    return buildInfoMock.value;
  },
}));

import { UPDATE_CHECK_INTERVAL_MS, useUpdateAvailable } from './useUpdateAvailable';

function mockVersionResponse(body: unknown, ok = true): Response {
  return {
    ok,
    json: () => Promise.resolve(body),
  } as Response;
}

function setVisibility(hidden: boolean): void {
  Object.defineProperty(document, 'hidden', {
    configurable: true,
    get: () => hidden,
  });
}

async function flushPromises(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('useUpdateAvailable', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    buildInfoMock.value = {
      version: '1.0.0',
      sha: 'abc1234',
      builtAt: '2026-06-25T00:00:00.000Z',
    };
    setVisibility(false);
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('reports an update when the deployed SHA differs from this build', async () => {
    vi.mocked(fetch).mockResolvedValue(mockVersionResponse({ sha: 'def5678', builtAt: 'now' }));

    const { result } = renderHook(() => useUpdateAvailable());

    await flushPromises();

    expect(result.current.updateAvailable).toBe(true);
    expect(result.current.deployedSha).toBe('def5678');
    expect(fetch).toHaveBeenCalledWith(`${import.meta.env.BASE_URL}version.json`, {
      cache: 'no-store',
    });
  });

  it('stays false when the deployed SHA matches this build', async () => {
    vi.mocked(fetch).mockResolvedValue(mockVersionResponse({ sha: 'abc1234', builtAt: 'now' }));

    const { result } = renderHook(() => useUpdateAvailable());

    await flushPromises();

    expect(result.current.deployedSha).toBe('abc1234');
    expect(result.current.updateAvailable).toBe(false);
  });

  it('stays silent on fetch rejection, non-ok responses, and invalid payloads', async () => {
    for (const response of [
      Promise.reject(new Error('offline')),
      Promise.resolve(mockVersionResponse({ sha: 'def5678', builtAt: 'now' }, false)),
      Promise.resolve(mockVersionResponse({ sha: 42, builtAt: 'now' })),
    ]) {
      vi.mocked(fetch).mockReset();
      vi.mocked(fetch).mockReturnValue(response);
      const { result, unmount } = renderHook(() => useUpdateAvailable());

      await flushPromises();

      expect(result.current).toEqual({ updateAvailable: false, deployedSha: null });
      unmount();
    }
  });

  it('does not fetch in local development builds', () => {
    buildInfoMock.value = {
      version: 'dev',
      sha: 'dev',
      builtAt: '',
    };

    const { result } = renderHook(() => useUpdateAvailable());

    expect(result.current).toEqual({ updateAvailable: false, deployedSha: null });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('checks again on the polling interval', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(mockVersionResponse({ sha: 'abc1234', builtAt: 'old' }))
      .mockResolvedValueOnce(mockVersionResponse({ sha: 'def5678', builtAt: 'new' }));

    const { result } = renderHook(() => useUpdateAvailable());
    await flushPromises();
    expect(result.current.deployedSha).toBe('abc1234');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS);
    });
    await flushPromises();

    expect(result.current.updateAvailable).toBe(true);
    expect(result.current.deployedSha).toBe('def5678');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('checks again when the window focuses or the visible tab returns', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(mockVersionResponse({ sha: 'abc1234', builtAt: 'old' }))
      .mockResolvedValueOnce(mockVersionResponse({ sha: 'focus1', builtAt: 'focus' }))
      .mockResolvedValueOnce(mockVersionResponse({ sha: 'focus2', builtAt: 'visible' }));

    const { result } = renderHook(() => useUpdateAvailable());
    await flushPromises();
    expect(result.current.deployedSha).toBe('abc1234');

    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    await flushPromises();
    expect(result.current.deployedSha).toBe('focus1');

    setVisibility(true);
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(fetch).toHaveBeenCalledTimes(2);

    setVisibility(false);
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await flushPromises();

    expect(result.current.deployedSha).toBe('focus2');
    expect(result.current.updateAvailable).toBe(true);
  });
});
