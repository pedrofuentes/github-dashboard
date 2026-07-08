import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The module keeps global state and attaches window listeners at import time, so
 * each test re-imports it fresh via `vi.resetModules()` + dynamic import.
 */

type InstallModule = typeof import('./install-prompt');

/** Build a synthetic beforeinstallprompt event with the platform extras. */
function makePromptEvent(outcome: 'accepted' | 'dismissed' = 'accepted'): Event {
  const event = new Event('beforeinstallprompt');
  Object.assign(event, {
    platforms: ['web'],
    prompt: vi.fn().mockResolvedValue(undefined),
    userChoice: Promise.resolve({ outcome, platform: 'web' }),
  });
  return event;
}

async function load(): Promise<InstallModule> {
  return import('./install-prompt');
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('install-prompt', () => {
  it('reports no install available by default', async () => {
    const mod = await load();
    expect(mod.getInstallState()).toEqual({ canInstall: false, installed: false });
  });

  it('promptInstall resolves "unavailable" when no prompt was captured', async () => {
    const mod = await load();
    await expect(mod.promptInstall()).resolves.toBe('unavailable');
  });

  it('captures beforeinstallprompt, notifies subscribers, and enables installing', async () => {
    const mod = await load();
    const onChange = vi.fn();
    mod.subscribe(onChange);

    window.dispatchEvent(makePromptEvent());

    expect(onChange).toHaveBeenCalled();
    expect(mod.getInstallState().canInstall).toBe(true);
  });

  it('fires the native prompt once and returns the outcome', async () => {
    const mod = await load();
    const event = makePromptEvent('accepted');
    window.dispatchEvent(event);

    await expect(mod.promptInstall()).resolves.toBe('accepted');
    expect((event as unknown as { prompt: () => void }).prompt).toHaveBeenCalledTimes(1);

    // The deferred prompt is single-use: it is cleared after firing.
    expect(mod.getInstallState().canInstall).toBe(false);
    await expect(mod.promptInstall()).resolves.toBe('unavailable');
  });

  it('marks the app installed on appinstalled and clears the prompt', async () => {
    const mod = await load();
    window.dispatchEvent(makePromptEvent());
    expect(mod.getInstallState().canInstall).toBe(true);

    window.dispatchEvent(new Event('appinstalled'));

    expect(mod.getInstallState()).toEqual({ canInstall: false, installed: true });
  });
});
