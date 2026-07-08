/**
 * Apply a pending PWA update and reload with the fresh app shell.
 *
 * Once the service worker precaches the shell, a bare `location.reload()` is
 * served straight from the *old* cache — the app comes back on the same build
 * and the version.json-driven "new version available" banner never clears
 * (version.json is network-only, so it keeps reporting the newer deploy).
 *
 * This instead forces the browser to fetch the new service worker, tells it to
 * activate (`SKIP_WAITING` — the generated SW handles that message), and reloads
 * only once the fresh worker is in control so the new assets actually win. If
 * there is no service worker (dev, unsupported browser) it falls back to a plain
 * reload.
 */
let applying = false;

export async function applyUpdateAndReload(): Promise<void> {
  if (applying) {
    return;
  }
  applying = true;

  const hardReload = (): void => {
    window.location.reload();
  };

  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    hardReload();
    return;
  }

  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) {
    hardReload();
    return;
  }

  let reloaded = false;
  const reloadOnce = (): void => {
    if (reloaded) {
      return;
    }
    reloaded = true;
    hardReload();
  };

  // When the fresh worker takes control (it claims clients on activation), the
  // reloaded page will be served from its cache.
  navigator.serviceWorker.addEventListener('controllerchange', reloadOnce);

  const activate = (worker: ServiceWorker | null): boolean => {
    if (worker === null) {
      return false;
    }
    // Reload the moment the new worker is active even if it does not claim the
    // page — a fresh navigation is then served by it.
    worker.addEventListener('statechange', () => {
      if (worker.state === 'activated') {
        reloadOnce();
      }
    });
    worker.postMessage({ type: 'SKIP_WAITING' });
    return true;
  };

  // A new worker already installed and waiting?
  if (activate(registration.waiting)) {
    return;
  }

  // Otherwise watch for one to arrive from the forced update check below. Only
  // an *update* (there is already a controller) should reload — a first install
  // must not, or it would loop.
  registration.addEventListener('updatefound', () => {
    const installing = registration.installing;
    if (installing === null) {
      return;
    }
    installing.addEventListener('statechange', () => {
      if (installing.state === 'installed' && navigator.serviceWorker.controller !== null) {
        activate(installing);
      }
    });
  });

  try {
    await registration.update();
  } catch {
    // Network hiccup — fall through to the safety-net reload below.
  }

  if (activate(registration.waiting)) {
    return;
  }

  // No new worker surfaced (e.g. the latest SW is already active but the page is
  // still running older JS): a plain reload is now served by the current SW's
  // fresh cache. Give the update() check a moment to land first.
  window.setTimeout(reloadOnce, 2500);
}
