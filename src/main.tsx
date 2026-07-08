import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';

import { App } from './App';
import { applyTheme, loadThemePreference, resolveTheme } from './lib/theme-preference';
import './index.css';

// Apply the persisted theme before the first paint. index.html ships a meta CSP
// (`script-src 'self'`) so an inline bootstrap script is not permitted; doing it
// from the bundle entry avoids a flash of the wrong theme (FOUC) instead.
applyTheme(resolveTheme(loadThemePreference()));

// Register the service worker for install + offline app shell. Same reason as
// the theme bootstrap: the CSP forbids an inline registration script, so we
// register from the bundle. `autoUpdate` (see vite.config.ts) refreshes cached
// assets in the background; the in-app version.json banner prompts the reload.
registerSW({ immediate: true });

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Unable to mount the app: #root element was not found.');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
