import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * Dashboard-view screenshot capture (M10 FT-C, closes #138).
 *
 * Drives the *real* built app against a fully MOCKED GitHub API — every
 * `api.github.com` request is fulfilled with realistic, entirely fictional
 * fixtures (no repository here exists), first-party assets are served by the
 * preview server, and anything else is aborted so nothing ever leaves the
 * browser. It signs in with a dummy token, switches to the at-a-glance
 * **Dashboard** view, waits for the fleet summary + glanceable tiles to settle,
 * and writes `docs/screenshots/dashboard.png` for the README.
 *
 * The capture is deterministic — fixed viewport, reduced-motion, disabled
 * screenshot animations — but it only WRITES a committed docs asset when run
 * with `CAPTURE_SCREENSHOTS=1` (e.g. `CAPTURE_SCREENSHOTS=1 npm run test:e2e`).
 * On a normal CI run the body still executes end-to-end (proving the harness and
 * the Dashboard view stay healthy) but the PNG write is skipped so the suite
 * never depends on, or churns, a binary artifact.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = resolve(__dirname, '..', 'docs/screenshots/dashboard.png');
const OUT_PATH_DARK = resolve(__dirname, '..', 'docs/screenshots/dashboard-dark.png');
const SHOULD_WRITE = process.env.CAPTURE_SCREENSHOTS === '1';

/** A clearly-fake PAT used only to drive the authenticated view; never sent anywhere real. */
const DUMMY_TOKEN = 'ghp_TESTTOKEN0000000000000000000000000000';
const GITHUB_API_ORIGIN = 'https://api.github.com';

/** GitHub's REST API answers cross-origin browser calls with permissive CORS. */
const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
  'access-control-allow-headers':
    'Authorization, Accept, Content-Type, If-None-Match, X-GitHub-Api-Version',
  // A healthy rate-limit budget so a mocked 403 reads as "missing scope"
  // (access denied), not "rate limited".
  'x-ratelimit-limit': '5000',
  'x-ratelimit-remaining': '4999',
  'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600),
  'x-ratelimit-used': '1',
};

/** A 1x1 placeholder served for the avatar so no real image is ever fetched. */
const TINY_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>';

interface FleetEntry {
  owner: string;
  name: string;
  private: boolean;
  description: string;
  ci: 'failure' | 'success' | 'in_progress' | 'queued' | 'none';
  security: { critical: number; high: number; medium: number; low: number } | null;
  reviews: number;
  prsOpen: number;
  prsExternal: number;
  issues: number;
  stale: number;
}

/**
 * A representative — and entirely fictional — fleet. Owners `acme` / `octodemo`
 * are placeholders; none of these repositories exist. Each entry drives every
 * signal so the Dashboard tiles show the full spread of states (failing CI, an
 * `F` security grade, review requests, new-contributor PRs, triage-heavy
 * backlogs, stale items) alongside healthy, all-clear repos.
 */
const FLEET: FleetEntry[] = [
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
];

const byName = new Map(FLEET.map((entry) => [`${entry.owner}/${entry.name}`, entry]));

function originOf(value: string): string {
  return new URL(value).origin;
}

function isGithubUserContent(origin: string): boolean {
  const host = new URL(origin).hostname;
  return host === 'githubusercontent.com' || host.endsWith('.githubusercontent.com');
}

function appOriginFrom(baseURL: string | undefined): string {
  if (baseURL === undefined) {
    throw new Error('Playwright baseURL must be configured for the screenshot capture.');
  }
  return new URL(baseURL).origin;
}

function buildRepoStats(entry: FleetEntry): unknown {
  return {
    full_name: `${entry.owner}/${entry.name}`,
    description: entry.description,
    private: entry.private,
    visibility: entry.private ? 'private' : 'public',
    html_url: `https://github.com/${entry.owner}/${entry.name}`,
    stargazers_count: 0,
    forks_count: 0,
    watchers_count: 0,
    // The Issues signal subtracts the open-PR count from open_issues_count
    // (which includes PRs), so seed it as issues + open PRs.
    open_issues_count: entry.issues + entry.prsOpen,
    language: 'TypeScript',
    size: 2048,
    license: null,
    default_branch: 'main',
  };
}

function buildCiRuns(entry: FleetEntry): unknown {
  const html_url = `https://github.com/${entry.owner}/${entry.name}/actions/runs/5500123`;
  switch (entry.ci) {
    case 'failure':
      return {
        total_count: 1,
        workflow_runs: [
          {
            id: 5500123,
            name: 'CI',
            status: 'completed',
            conclusion: 'failure',
            head_branch: 'main',
            event: 'push',
            display_title: `CI for ${entry.name}`,
            run_number: 42,
            html_url,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ],
      };
    case 'success':
      return {
        total_count: 1,
        workflow_runs: [
          {
            id: 5500123,
            name: 'CI',
            status: 'completed',
            conclusion: 'success',
            head_branch: 'main',
            event: 'push',
            display_title: `CI for ${entry.name}`,
            run_number: 42,
            html_url,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ],
      };
    case 'in_progress':
      return {
        total_count: 1,
        workflow_runs: [
          {
            id: 5500123,
            name: 'CI',
            status: 'in_progress',
            conclusion: null,
            head_branch: 'main',
            event: 'push',
            display_title: `CI for ${entry.name}`,
            run_number: 42,
            html_url,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ],
      };
    case 'queued':
      return {
        total_count: 1,
        workflow_runs: [
          {
            id: 5500123,
            name: 'CI',
            status: 'queued',
            conclusion: null,
            head_branch: 'main',
            event: 'push',
            display_title: `CI for ${entry.name}`,
            run_number: 42,
            html_url,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ],
      };
    default:
      return { total_count: 0, workflow_runs: [] };
  }
}

function buildGraphQLRepo(entry: FleetEntry): unknown {
  const ciState =
    entry.ci === 'failure'
      ? 'FAILURE'
      : entry.ci === 'success'
        ? 'SUCCESS'
        : entry.ci === 'in_progress'
          ? 'PENDING'
          : entry.ci === 'queued'
            ? 'EXPECTED'
            : null;

  return {
    nameWithOwner: `${entry.owner}/${entry.name}`,
    isArchived: false,
    defaultBranchRef:
      ciState === null ? null : { target: { statusCheckRollup: { state: ciState } } },
    openIssues: { totalCount: entry.issues },
    myIssues: { totalCount: 0 },
    pullRequests: {
      nodes: buildPulls(entry).map((pull) => {
        const p = pull as {
          number: number;
          user: { login: string };
          author_association: string;
          draft: boolean;
          html_url: string;
        };
        return {
          number: p.number,
          title: `Pull request ${p.number} in ${entry.name}`,
          url: p.html_url,
          createdAt: '2026-06-20T12:00:00Z',
          isDraft: p.draft,
          authorAssociation: p.author_association,
          author: { login: p.user.login },
        };
      }),
    },
  };
}

function buildGraphQLBody(variables: Record<string, unknown>): string {
  const data: Record<string, unknown> = {
    viewer: { login: 'octodemo' },
    rateLimit: { cost: 1, remaining: 4999, resetAt: '2026-06-29T18:00:00Z', limit: 5000 },
  };

  for (let i = 0; typeof variables[`owner${i}`] === 'string'; i += 1) {
    const fullName = `${variables[`owner${i}`]}/${variables[`name${i}`]}`;
    const entry = byName.get(fullName);
    data[`r${i}`] = entry === undefined ? null : buildGraphQLRepo(entry);
    data[`stale_r${i}`] = {
      issueCount: entry?.stale ?? 0,
      nodes:
        entry === undefined
          ? []
          : Array.from({ length: entry.stale }, (_, index) => ({
              __typename: 'Issue',
              number: 2000 + index,
              title: `Stale issue ${index + 1} in ${entry.name}`,
              url: `https://github.com/${entry.owner}/${entry.name}/issues/${2000 + index}`,
              updatedAt: '2026-05-01T12:00:00Z',
            })),
    };
  }

  data.reviews = {
    issueCount: 0,
    pageInfo: { hasNextPage: false, endCursor: null },
    nodes: [],
  };

  return JSON.stringify({ data });
}

function buildDependabotAlerts(entry: FleetEntry): unknown[] {
  const security = entry.security;
  if (security === null) {
    return [];
  }
  const alerts: unknown[] = [];
  for (const severity of ['critical', 'high', 'medium', 'low'] as const) {
    for (let i = 0; i < security[severity]; i += 1) {
      alerts.push({ number: alerts.length + 1, state: 'open', security_advisory: { severity } });
    }
  }
  return alerts;
}

function buildPulls(entry: FleetEntry): unknown[] {
  const pulls: unknown[] = [];
  for (let i = 0; i < entry.prsOpen; i += 1) {
    const external = i < entry.prsExternal;
    const number = 1200 + i;
    pulls.push({
      number,
      draft: false,
      author_association: external ? 'FIRST_TIME_CONTRIBUTOR' : 'MEMBER',
      user: { login: external ? `new-contributor-${number}` : `acme-dev-${number}` },
      html_url: `https://github.com/${entry.owner}/${entry.name}/pull/${number}`,
    });
  }
  return pulls;
}

function buildReviewsSearch(): unknown {
  const items: unknown[] = [];
  for (const entry of FLEET) {
    for (let i = 0; i < entry.reviews; i += 1) {
      const number = 1300 + i;
      items.push({
        number,
        title: `Review request in ${entry.name}`,
        html_url: `https://github.com/${entry.owner}/${entry.name}/pull/${number}`,
        created_at: new Date().toISOString(),
        user: { login: 'teammate' },
        repository_url: `https://api.github.com/repos/${entry.owner}/${entry.name}`,
      });
    }
  }
  return { total_count: items.length, items };
}

async function fulfillGitHubApi(route: Route, url: string): Promise<void> {
  const { pathname, searchParams } = new URL(url);
  const json = (data: unknown, status = 200): Promise<void> =>
    route.fulfill({
      status,
      headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
      body: JSON.stringify(data),
    });

  if (pathname === '/user') {
    await json({ login: 'octodemo', name: 'Octo Demo', avatar_url: '' });
    return;
  }

  if (pathname === '/user/repos') {
    await json(
      FLEET.map((entry) => ({
        full_name: `${entry.owner}/${entry.name}`,
        name: entry.name,
        private: entry.private,
        description: entry.description,
        owner: { login: entry.owner },
        html_url: `https://github.com/${entry.owner}/${entry.name}`,
      })),
    );
    return;
  }

  if (pathname === '/search/issues') {
    const q = searchParams.get('q') ?? '';
    if (q.includes('review-requested')) {
      await json(buildReviewsSearch());
      return;
    }
    const repoMatch = q.match(/repo:(\S+)/);
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

  const repoMatch = pathname.match(/^\/repos\/([^/]+)\/([^/]+)(\/.*)?$/);
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

  // Anything unanticipated: answer with an empty, harmless body.
  await json({}, 200);
}

/**
 * Intercepts all network so the real built app can be driven into the
 * authenticated Dashboard view with a dummy token: GitHub API requests are
 * fulfilled with the fictional fleet fixtures, first-party assets are served by
 * the preview server, and anything else is aborted (so nothing can ever leave).
 */
async function mockAuthenticatedFleet(page: Page, appOrigin: string): Promise<void> {
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = request.url();
    const origin = originOf(url);

    if (origin === appOrigin) {
      await route.continue();
      return;
    }
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: CORS_HEADERS });
      return;
    }
    if (origin === GITHUB_API_ORIGIN) {
      if (new URL(url).pathname === '/graphql') {
        const postData = request.postDataJSON() as { variables?: Record<string, unknown> };
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: CORS_HEADERS,
          body: buildGraphQLBody(postData.variables ?? {}),
        });
        return;
      }
      await fulfillGitHubApi(route, url);
      return;
    }
    if (isGithubUserContent(origin)) {
      await route.fulfill({
        status: 200,
        contentType: 'image/svg+xml',
        headers: { 'access-control-allow-origin': '*' },
        body: TINY_SVG,
      });
      return;
    }
    await route.abort();
  });
}

// A stable, generous viewport so the full Dashboard (summary + tiles) is
// captured deterministically, with reduced motion to suppress all animation.
test.use({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });

test('captures the at-a-glance Dashboard view for the README', async ({ page, baseURL }) => {
  await mockAuthenticatedFleet(page, appOriginFrom(baseURL));

  // Start from the table grid regardless of any persisted preference.
  await page.addInitScript(() => {
    window.localStorage.setItem('fleet:default-view', 'grid');
  });

  await page.goto('/');
  await page.getByLabel('GitHub personal access token').fill(DUMMY_TOKEN);
  await page.getByRole('button', { name: 'Connect to GitHub' }).click();

  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByText('Authenticated as octodemo')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByText('Authenticated as octodemo')).toBeHidden();

  // Let the grid signals settle before switching, so the tiles render "ready".
  await expect(
    page.getByRole('button', { name: 'View details for acme/payments-service' }),
  ).toBeVisible();
  await page.waitForLoadState('networkidle');

  // Switch to the at-a-glance Dashboard/Boards view.
  await page.getByRole('button', { name: 'Boards' }).click();

  // The pinned fleet summary anchors the top; the tiles fill the grid below.
  await expect(page.getByRole('region', { name: 'Fleet summary' })).toBeVisible();
  await expect(page.getByRole('grid', { name: 'Dashboard tiles' })).toBeVisible();
  await expect(page.getByRole('link', { name: /^CI:.*acme\/payments-service$/i })).toBeVisible();

  // No per-cell skeletons left animating (all signals resolved).
  await expect(page.locator('.animate-pulse')).toHaveCount(0);
  await page.waitForLoadState('networkidle');

  // Move the pointer to a neutral corner so no tile is left in a hover state.
  await page.mouse.move(0, 0);

  if (SHOULD_WRITE) {
    await mkdir(dirname(OUT_PATH), { recursive: true });
    await page.screenshot({ path: OUT_PATH, fullPage: true, animations: 'disabled' });
  } else {
    // Still prove the capture path works without churning the committed asset.
    await page.screenshot({ fullPage: true, animations: 'disabled' });
  }

  // Capture the same Dashboard in the dark theme for the README's Appearance
  // section: switch the header Theme control to Dark and confirm the resolved
  // theme is applied before re-shooting.
  await page.getByRole('button', { name: 'Settings' }).click();
  const themeGroup = page.getByRole('radiogroup', { name: 'Theme' });
  await themeGroup.getByRole('radio', { name: 'Dark' }).click();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.classList.contains('dark')))
    .toBe(true);
  await page.keyboard.press('Escape');
  await expect(themeGroup).toBeHidden();
  await page.mouse.move(0, 0);

  if (SHOULD_WRITE) {
    await mkdir(dirname(OUT_PATH_DARK), { recursive: true });
    await page.screenshot({ path: OUT_PATH_DARK, fullPage: true, animations: 'disabled' });
  } else {
    await page.screenshot({ fullPage: true, animations: 'disabled' });
  }
});
