/**
 * Captures the browser's PWA install prompt and exposes it to the app.
 *
 * Chromium fires a `beforeinstallprompt` event (once, early — often before React
 * mounts) that lets a site trigger its own install UI. This module registers the
 * listeners at import time so the event is never missed, stashes the deferred
 * event, and lets the app show an "Install" affordance and fire the native prompt
 * on demand. Browsers without the event (Safari, Firefox) simply report
 * `canInstall: false`; the app falls back to written "add to home screen" steps.
 */

/** The non-standard event Chromium fires; not in the DOM lib typings. */
interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  prompt: () => Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export type InstallOutcome = 'accepted' | 'dismissed' | 'unavailable';

export interface InstallState {
  /** A native install prompt is available to fire. */
  canInstall: boolean;
  /** The app is already running as an installed / standalone app. */
  installed: boolean;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let installed = detectStandalone();
const subscribers = new Set<() => void>();

/** True when the document is running as an installed / standalone PWA. */
function detectStandalone(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  const standaloneDisplay =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(display-mode: standalone)').matches;
  // iOS Safari exposes navigator.standalone instead of display-mode.
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return standaloneDisplay || iosStandalone;
}

function notify(): void {
  for (const callback of subscribers) {
    callback();
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    // Stop the default mini-infobar so we can present our own Install affordance.
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    notify();
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    installed = true;
    notify();
  });
}

export function getInstallState(): InstallState {
  return { canInstall: deferredPrompt !== null, installed };
}

export function subscribe(callback: () => void): () => void {
  subscribers.add(callback);
  return () => {
    subscribers.delete(callback);
  };
}

/**
 * Fire the captured native install prompt. A deferred prompt can only be used
 * once, so it is cleared afterwards regardless of the user's choice. Returns
 * `'unavailable'` when there is no prompt to show (e.g. Safari/Firefox).
 */
export async function promptInstall(): Promise<InstallOutcome> {
  const prompt = deferredPrompt;
  if (prompt === null) {
    return 'unavailable';
  }
  deferredPrompt = null;
  notify();
  try {
    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    return outcome;
  } catch {
    return 'dismissed';
  }
}
