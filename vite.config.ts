import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// GitHub Pages serves this project under /github-dashboard/.
export default defineConfig({
  base: '/github-dashboard/',
  plugins: [react()],
});
