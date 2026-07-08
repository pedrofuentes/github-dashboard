import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * These tests exercise the service-worker update dance in isolation. The module
 * keeps a one-shot `applying` guard, so each test re-imports it fresh via
 * `vi.resetModules()` to get a clean instance.
 */

const reload = vi.fn();

interface FakeWorker {
  state: string;
  postMessage: ReturnType<typeof vi.fn>;
  addEventListener: (type: string, cb: () => void) => void;
  emit: (type: string) => void;
}

function makeWorker(state = 'installed'): FakeWorker {
  const listeners = new Map<string, (() => void)[]>();
  return {
    state,
    postMessage: vi.fn(),
    addEventListener(type, cb) {
      const list = listeners.get(type) ?? [];
      list.push(cb);
      listeners.set(type, list);
    },
    emit(type) {
      for (const cb of listeners.get(type) ?? []) {
        cb();
      }
    },
  };
}

function stubServiceWorker(registration: unknown): void {
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      controller: {},
      getRegistration: vi.fn().mockResolvedValue(registration),
      addEventListener: vi.fn(),
    },
  });
}

function removeServiceWorker(): void {
  // Delete (not set undefined) so `'serviceWorker' in navigator` is false.
  Reflect.deleteProperty(navigator, 'serviceWorker');
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  vi.resetModules();
  reload.mockReset();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { reload },
  });
});

afterEach(() => {
  Reflect.deleteProperty(navigator, 'serviceWorker');
});

describe('applyUpdateAndReload', () => {
  it('falls back to a plain reload when service workers are unavailable', async () => {
    removeServiceWorker();
    const { applyUpdateAndReload } = await import('./pwa-update');

    await applyUpdateAndReload();

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('activates a waiting worker and reloads only once it becomes active', async () => {
    const waiting = makeWorker('installed');
    stubServiceWorker({
      waiting,
      installing: null,
      update: vi.fn().mockResolvedValue(undefined),
      addEventListener: vi.fn(),
    });
    const { applyUpdateAndReload } = await import('./pwa-update');

    void applyUpdateAndReload();
    await flush();

    // It tells the fresh worker to take over, but does NOT reload yet (that would
    // just re-serve the stale cache before the new worker is in control).
    expect(waiting.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    expect(reload).not.toHaveBeenCalled();

    // Once the new worker is active, the page reloads exactly once.
    waiting.state = 'activated';
    waiting.emit('statechange');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('forces an update check when no worker is waiting yet', async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    stubServiceWorker({
      waiting: null,
      installing: null,
      update,
      addEventListener: vi.fn(),
    });
    const { applyUpdateAndReload } = await import('./pwa-update');

    void applyUpdateAndReload();
    await flush();

    expect(update).toHaveBeenCalledTimes(1);
  });
});
