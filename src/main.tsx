import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import { applyTheme, loadThemePreference, resolveTheme } from './lib/theme-preference';
import './index.css';

// Apply the persisted theme before the first paint. index.html ships a meta CSP
// (`script-src 'self'`) so an inline bootstrap script is not permitted; doing it
// from the bundle entry avoids a flash of the wrong theme (FOUC) instead.
applyTheme(resolveTheme(loadThemePreference()));

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Unable to mount the app: #root element was not found.');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
