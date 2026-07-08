import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config';

// Generates the PWA icon set from a single source SVG into `public/`.
// Run once via `npm run generate-pwa-assets`; the emitted PNG/ICO files are
// committed so the production build (and CI) needs no image toolchain.
//
// The `minimal-2023` preset emits: pwa-64x64.png, pwa-192x192.png,
// pwa-512x512.png (transparent "any"), maskable-icon-512x512.png,
// apple-touch-icon-180x180.png, and favicon.ico.
export default defineConfig({
  preset: minimal2023Preset,
  images: ['public/app-icon.svg'],
});
