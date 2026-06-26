import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const packageJson = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as { version?: string };

const version = packageJson.version ?? 'dev';
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
    __APP_VERSION__: JSON.stringify(version),
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
  ],
});
