import { execSync } from 'node:child_process';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const builtAt = new Date().toISOString();

function resolveBuildSha(): string {
  const githubSha = process.env.GITHUB_SHA?.slice(0, 7);
  if (githubSha) {
    return githubSha;
  }

  try {
    return execSync('git rev-parse --short HEAD').toString().trim();
  } catch {
    return 'dev';
  }
}

const sha = resolveBuildSha();

// GitHub Pages serves this project under /github-dashboard/.
export default defineConfig({
  base: '/github-dashboard/',
  define: {
    __BUILD_SHA__: JSON.stringify(sha),
    __BUILD_TIME__: JSON.stringify(builtAt),
  },
  plugins: [
    react(),
    {
      name: 'emit-version-json',
      apply: 'build',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'version.json',
          source: JSON.stringify({ sha, builtAt }),
        });
      },
    },
    // Installable PWA + offline app shell. Icons are pre-generated into `public/`
    // (`npm run generate-pwa-assets`), so the build needs no image toolchain.
    VitePWA({
      // Prompt, not autoUpdate: the app owns the update UX via the version.json
      // banner (useUpdateAvailable) with an explicit Reload button, so the SW
      // must NOT silently reload the page. The new worker installs and waits;
      // applyUpdateAndReload() activates it (SKIP_WAITING) and reloads.
      registerType: 'prompt',
      // The strict CSP (`script-src 'self'`, no inline) forbids an injected inline
      // registration snippet — we call registerSW() from the bundle in main.tsx.
      injectRegister: false,
      includeAssets: ['favicon.ico', 'apple-touch-icon-180x180.png', 'app-icon.svg'],
      manifest: {
        name: 'GitHub Dashboard',
        short_name: 'Dashboard',
        description:
          'A fast, private dashboard for your GitHub repositories — CI, pull requests, reviews, security, and activity at a glance.',
        id: '/github-dashboard/',
        // Relative to the manifest URL (served under the /github-dashboard/ base),
        // so start_url/scope/icons resolve correctly on GitHub Pages.
        start_url: '.',
        scope: '.',
        display: 'standalone',
        theme_color: '#0d1117',
        background_color: '#0d1117',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        // version.json must stay live so the update checker sees fresh deploys —
        // keep it out of the precache and serve it network-only at runtime.
        globIgnores: ['**/version.json'],
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/version\.json$/],
        runtimeCaching: [{ urlPattern: /\/version\.json$/, handler: 'NetworkOnly' }],
        // Single same-origin sw.js (no importScripts) — cleanest under the CSP.
        inlineWorkboxRuntime: true,
        cleanupOutdatedCaches: true,
        // Take control of the page as soon as the freshly activated worker is
        // ready, so applyUpdateAndReload()'s reload is served from the new cache.
        clientsClaim: true,
      },
    }),
  ],
});
