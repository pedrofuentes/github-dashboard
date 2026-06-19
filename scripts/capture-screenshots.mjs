/**
 * Throwaway screenshot capture for the README.
 *
 * Serves the production build with `vite preview`, then drives the app with
 * Playwright against a fully MOCKED GitHub API (`page.route` fulfils every
 * `api.github.com` request with realistic FAKE data) so the screenshots show a
 * representative fleet WITHOUT exposing anyone's real private repositories. No
 * network request ever leaves the machine and no real token is used.
 *
 * Usage: `npm run build` first, then `node scripts/capture-screenshots.mjs`.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @license MIT
 */
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

/*
 * This script runs in Node (the orchestration) and, inside
 * `page.waitForFunction`, briefly in the browser (`document`). Declare the
 * platform globals so the repo's flat ESLint config doesn't flag `no-undef`.
 */
/* global URL, fetch, setTimeout, console, process, document */

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const PORT = 4178;
const BASE_URL = `http://localhost:${PORT}/github-dashboard/`;
const OUT_DIR = resolve(ROOT, 'docs/screenshots');

/**
 * A representative — and entirely fictional — fleet. Owners `acme` / `octodemo`
 * are placeholders; none of these repositories exist. Each entry drives every
 * signal column so the grid shows the full spread of states (failing CI, an `F`
 * security grade, review requests, new-contributor PRs, triage-heavy backlogs,
 * stale items) alongside healthy, all-clear repos.
 */
const FLEET = [
  {
    owner: 'acme',
    name: 'payments-service',
    private: true,
    description: 'Billing and payments API',
    ci: 'failure',
    security: { critical: 1, high: 2, medium: 1, low: 0 }, // grade F
    reviews: 2,
    prsOpen: 8,
    prsExternal: 2,
    issues: 24, // over the triage threshold (>= 20)
    stale: 5,
  },
  {
    owner: 'acme',
    name: 'web-app',
    private: false,
    description: 'Customer-facing web application',
    ci: 'success',
    security: { critical: 0, high: 0, medium: 0, low: 0 }, // grade A, clear
    reviews: 0,
    prsOpen: 5,
    prsExternal: 1,
    issues: 12,
    stale: 1,
  },
  {
    owner: 'acme',
    name: 'mobile-ios',
    private: true,
    description: 'Native iOS client',
    ci: 'in_progress',
    security: { critical: 0, high: 0, medium: 3, low: 0 }, // grade C
    reviews: 1,
    prsOpen: 3,
    prsExternal: 0,
    issues: 7,
    stale: 0,
  },
  {
    owner: 'acme',
    name: 'infra',
    private: true,
    description: 'Terraform + Kubernetes infrastructure',
    ci: 'failure',
    security: { critical: 0, high: 2, medium: 0, low: 0 }, // grade D
    reviews: 3,
    prsOpen: 2,
    prsExternal: 0,
    issues: 4,
    stale: 6,
  },
  {
    owner: 'acme',
    name: 'design-system',
    private: false,
    description: 'Shared React component library',
    ci: 'success',
    security: { critical: 0, high: 0, medium: 0, low: 2 }, // grade B
    reviews: 0,
    prsOpen: 6,
    prsExternal: 3,
    issues: 15,
    stale: 2,
  },
  {
    owner: 'acme',
    name: 'data-pipeline',
    private: true,
    description: 'Batch + streaming ETL jobs',
    ci: 'queued',
    security: { critical: 0, high: 0, medium: 0, low: 0 }, // grade A, clear
    reviews: 0,
    prsOpen: 1,
    prsExternal: 0,
    issues: 3,
    stale: 0,
  },
  {
    owner: 'octodemo',
    name: 'docs',
    private: false,
    description: 'Public documentation site',
    ci: 'success',
    security: { critical: 0, high: 0, medium: 0, low: 0 }, // grade A, clear
    reviews: 1,
    prsOpen: 2,
    prsExternal: 1,
    issues: 9,
    stale: 7,
  },
  {
    owner: 'octodemo',
    name: 'cli',
    private: false,
    description: 'Command-line tools',
    ci: 'none',
    security: null, // no alert access -> "n/a"
    reviews: 0,
    prsOpen: 0,
    prsExternal: 0,
    issues: 0,
    stale: 0,
  },
];

const byName = new Map(FLEET.map((e) => [`${e.owner}/${e.name}`, e]));

function buildRepoStats(e) {
  return {
    full_name: `${e.owner}/${e.name}`,
    description: e.description,
    private: e.private,
    visibility: e.private ? 'private' : 'public',
    html_url: `https://github.com/${e.owner}/${e.name}`,
    stargazers_count: 0,
    forks_count: 0,
    watchers_count: 0,
    // The Issues signal subtracts the open-PR count from open_issues_count
    // (which includes PRs), so seed it as issues + open PRs.
    open_issues_count: e.issues + e.prsOpen,
    language: 'TypeScript',
    size: 2048,
    license: null,
    default_branch: 'main',
  };
}

function buildCiRuns(e) {
  const html_url = `https://github.com/${e.owner}/${e.name}/actions/runs/5500123`;
  let run;
  switch (e.ci) {
    case 'failure':
      run = { status: 'completed', conclusion: 'failure', html_url, name: 'CI' };
      break;
    case 'success':
      run = { status: 'completed', conclusion: 'success', html_url, name: 'CI' };
      break;
    case 'in_progress':
      run = { status: 'in_progress', conclusion: null, html_url, name: 'CI' };
      break;
    case 'queued':
      run = { status: 'queued', conclusion: null, html_url, name: 'CI' };
      break;
    default:
      return { total_count: 0, workflow_runs: [] };
  }
  return { total_count: 1, workflow_runs: [run] };
}

function buildDependabotAlerts(e) {
  const alerts = [];
  for (const severity of ['critical', 'high', 'medium', 'low']) {
    for (let i = 0; i < e.security[severity]; i++) {
      alerts.push({ number: alerts.length + 1, state: 'open', security_advisory: { severity } });
    }
  }
  return alerts;
}

function buildPulls(e) {
  const pulls = [];
  for (let i = 0; i < e.prsOpen; i++) {
    const external = i < e.prsExternal;
    const number = 1200 + i;
    pulls.push({
      number,
      draft: false,
      author_association: external ? 'FIRST_TIME_CONTRIBUTOR' : 'MEMBER',
      user: { login: external ? `new-contributor-${number}` : `acme-dev-${number}` },
      html_url: `https://github.com/${e.owner}/${e.name}/pull/${number}`,
    });
  }
  return pulls;
}

function buildReviewsSearch() {
  const items = [];
  for (const e of FLEET) {
    for (let i = 0; i < e.reviews; i++) {
      const number = 1300 + i;
      items.push({
        number,
        title: `Review request in ${e.name}`,
        html_url: `https://github.com/${e.owner}/${e.name}/pull/${number}`,
        created_at: new Date().toISOString(),
        user: { login: 'teammate' },
        repository_url: `https://api.github.com/repos/${e.owner}/${e.name}`,
      });
    }
  }
  return { total_count: items.length, items };
}

const BASE_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers':
    'Authorization, Accept, Content-Type, X-GitHub-Api-Version, If-None-Match',
  // A healthy rate-limit budget so a mocked 403 reads as "missing scope"
  // (access denied), not "rate limited".
  'x-ratelimit-limit': '5000',
  'x-ratelimit-remaining': '4999',
  'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600),
  'x-ratelimit-used': '1',
};

async function handleGitHub(route, request) {
  if (request.method() === 'OPTIONS') {
    await route.fulfill({ status: 204, headers: BASE_HEADERS, body: '' });
    return;
  }

  const url = new URL(request.url());
  const path = url.pathname;
  const json = (data, status = 200) =>
    route.fulfill({
      status,
      headers: { ...BASE_HEADERS, 'content-type': 'application/json' },
      body: JSON.stringify(data),
    });

  if (path === '/user') {
    await json({ login: 'octodemo', name: 'Octo Demo', avatar_url: '' });
    return;
  }

  if (path === '/user/repos') {
    await json(
      FLEET.map((e) => ({
        full_name: `${e.owner}/${e.name}`,
        name: e.name,
        private: e.private,
        description: e.description,
        owner: { login: e.owner },
        html_url: `https://github.com/${e.owner}/${e.name}`,
      })),
    );
    return;
  }

  if (path === '/search/issues') {
    const q = url.searchParams.get('q') ?? '';
    if (q.includes('review-requested')) {
      await json(buildReviewsSearch());
      return;
    }
    const repoMatch = q.match(/repo:([^\s]+)/);
    const entry = repoMatch ? byName.get(repoMatch[1]) : undefined;
    if (q.includes('updated:<')) {
      await json({ total_count: entry ? entry.stale : 0, items: [] });
      return;
    }
    if (q.includes('type:pr')) {
      await json({ total_count: entry ? entry.prsOpen : 0, items: [] });
      return;
    }
    if (q.includes('type:issue')) {
      await json({ total_count: entry ? entry.issues : 0, items: [] });
      return;
    }
    await json({ total_count: 0, items: [] });
    return;
  }

  const repoMatch = path.match(/^\/repos\/([^/]+)\/([^/]+)(\/.*)?$/);
  if (repoMatch) {
    const full = `${repoMatch[1]}/${repoMatch[2]}`;
    const sub = repoMatch[3] ?? '';
    const entry = byName.get(full);

    if (sub.startsWith('/actions/runs')) {
      await json(entry ? buildCiRuns(entry) : { total_count: 0, workflow_runs: [] });
      return;
    }
    if (sub.startsWith('/dependabot/alerts')) {
      if (!entry || entry.security === null) {
        await json({ message: 'Dependabot alerts are disabled for this repository.' }, 403);
        return;
      }
      await json(buildDependabotAlerts(entry));
      return;
    }
    if (sub.startsWith('/code-scanning/alerts')) {
      if (!entry || entry.security === null) {
        await json({ message: 'no analysis found' }, 404);
        return;
      }
      await json([]);
      return;
    }
    if (sub.startsWith('/pulls')) {
      await json(entry ? buildPulls(entry) : []);
      return;
    }
    if (sub === '' || sub === '/') {
      await json(entry ? buildRepoStats(entry) : { message: 'Not Found' }, entry ? 200 : 404);
      return;
    }
    await json({}, 200);
    return;
  }

  // Anything unanticipated: log it so the fixture can be extended, and answer
  // with an empty, harmless body.
  console.warn(`[capture] unhandled GitHub request: ${request.method()} ${path}`);
  await json({}, 200);
}

function startPreview() {
  const bin = resolve(ROOT, 'node_modules/.bin/vite');
  const child = spawn(bin, ['preview', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    stdio: 'inherit',
  });
  return child;
}

async function waitForServer(url, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Preview server did not start at ${url}`);
}

async function settleSignals(page) {
  // Repos arrive first; then per-cell skeletons (animate-pulse) resolve.
  await page
    .getByRole('button', { name: 'View details for acme/payments-service' })
    .waitFor({ timeout: 15000 });
  await page.waitForLoadState('networkidle');
  await page.waitForFunction(() => document.querySelectorAll('.animate-pulse').length === 0, {
    timeout: 15000,
  });
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const preview = startPreview();
  let browser;
  try {
    await waitForServer(BASE_URL);

    browser = await chromium.launch();
    const context = await browser.newContext({
      viewport: { width: 1280, height: 880 },
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    await page.route('**://api.github.com/**', handleGitHub);

    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { level: 1, name: 'github-dashboard' }).waitFor();

    // 1) Token-entry screen (privacy-first persistence + required scopes).
    // Clip to the content so the sign-in card isn't lost in empty space.
    const lastScope = page.getByRole('listitem').last();
    const scopeBox = await lastScope.boundingBox();
    await page.screenshot({
      path: resolve(OUT_DIR, 'token-entry.png'),
      clip: {
        x: 0,
        y: 0,
        width: 1280,
        height: Math.ceil((scopeBox?.y ?? 600) + (scopeBox?.height ?? 0) + 28),
      },
    });

    // Sign in with a dummy token (validated against the mocked /user route).
    await page.getByLabel('GitHub personal access token').fill('github_pat_demo_FAKE_TOKEN_0000');
    await page.getByRole('button', { name: 'Connect to GitHub' }).click();

    // 2) Fleet overview grid. Move the pointer to a neutral corner first so no
    // row is left in a hover state, then clip to the table's extent.
    await settleSignals(page);
    await page.mouse.move(0, 0);
    const table = page.getByRole('table', { name: 'Repository fleet health' });
    const tableBox = await table.boundingBox();
    await page.screenshot({
      path: resolve(OUT_DIR, 'fleet-grid.png'),
      clip: {
        x: 0,
        y: 0,
        width: 1280,
        height: Math.ceil((tableBox?.y ?? 0) + (tableBox?.height ?? 700) + 32),
      },
    });

    // 3) Row drill-down drawer.
    await page.getByRole('button', { name: 'View details for acme/payments-service' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor();
    await dialog.getByText('Conclusion: Failing').waitFor({ timeout: 5000 });
    await page.screenshot({ path: resolve(OUT_DIR, 'drill-down-drawer.png') });

    await browser.close();
    browser = undefined;
    console.log('Screenshots written to docs/screenshots/');
  } finally {
    if (browser) await browser.close();
    preview.kill('SIGTERM');
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
