import { expect, test, type Page } from '@playwright/test';

/**
 * Default-view smoke spec — run against the real built app to prove, in a
 * browser, the configurable default-view behaviour (#309): with empty storage
 * the app opens on the Triage view, and when a user has persisted a
 * different default under `fleet:default-view` the app opens straight onto it.
 *
 * The Dashboard and its toolbar controls live behind auth (`App.tsx` renders
 * `<FleetPanel>` only when authenticated), so each test mocks the network and
 * connects with a dummy PAT using the same lean authenticated harness as
 * `e2e/a11y.spec.ts` (copied inline — each spec owns its own harness).
 */

/** A clearly-fake PAT used only to drive the authenticated view; never sent anywhere real. */
const DUMMY_TOKEN = 'ghp_TESTTOKEN0000000000000000000000000000';
const GITHUB_API_ORIGIN = 'https://api.github.com';

/** GitHub's REST API answers cross-origin browser calls with permissive CORS. */
const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
  'access-control-allow-headers':
    'Authorization, Accept, Content-Type, If-None-Match, X-GitHub-Api-Version',
};

/** A 1x1 placeholder served for the avatar so no real image is ever fetched. */
const TINY_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>';

function originOf(value: string): string {
  return new URL(value).origin;
}

function appOriginFrom(baseURL: string | undefined): string {
  if (baseURL === undefined) {
    throw new Error('Playwright baseURL must be configured for the contrast test.');
  }
  return new URL(baseURL).origin;
}

/** True for `githubusercontent.com` and any of its sub-domains (avatars, etc.). */
function isGithubUserContent(origin: string): boolean {
  const host = new URL(origin).hostname;
  return host === 'githubusercontent.com' || host.endsWith('.githubusercontent.com');
}

/** Minimal, Zod-valid fixtures for each api.github.com endpoint the fleet flow hits. */
function githubApiBody(url: string): string {
  const { pathname } = new URL(url);
  if (pathname === '/user') {
    return JSON.stringify({
      login: 'testuser',
      avatar_url: 'https://avatars.githubusercontent.com/u/1?v=4',
    });
  }
  if (pathname === '/user/repos') {
    return JSON.stringify([
      { full_name: 'octo-org/hello-world', private: false, description: null },
    ]);
  }
  if (pathname.includes('/actions/runs')) {
    return JSON.stringify({ total_count: 0, workflow_runs: [] });
  }
  if (pathname.startsWith('/search/')) {
    return JSON.stringify({ total_count: 0, incomplete_results: false, items: [] });
  }
  // Pulls, dependabot alerts, code-scanning alerts and any other list endpoint.
  return JSON.stringify([]);
}

/**
 * Intercepts all network so the real built app can be driven into the
 * authenticated fleet view with a dummy token: allowlisted GitHub requests are
 * fulfilled with minimal fixtures, first-party assets are served by the preview
 * server, and anything else is aborted (so nothing can ever leave).
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
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: CORS_HEADERS,
        body: githubApiBody(url),
      });
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

test.use({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });

test('opens on the Triage view by default with empty storage', async ({ page, baseURL }) => {
  await mockAuthenticatedFleet(page, appOriginFrom(baseURL));

  await page.goto('/');
  await page.getByLabel('GitHub personal access token').fill(DUMMY_TOKEN);
  await page.getByRole('button', { name: 'Connect to GitHub' }).click();

  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByText('Authenticated as testuser')).toBeVisible();

  // Triage is the out-of-the-box default: its region renders and the grid table
  // does not (AC1).
  await expect(page.getByRole('region', { name: 'Triage' })).toBeVisible();
  await expect(page.getByRole('table')).toHaveCount(0);

  // The "Default view" control reflects Triage as the checked default (AC4).
  const defaultGroup = page.getByRole('radiogroup', { name: 'Default view' });
  await expect(defaultGroup.getByRole('radio', { name: 'Triage' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await page.keyboard.press('Escape');
  await expect(page.getByText('Authenticated as testuser')).toBeHidden();
});

test('opens on the configured default (Grid) when one is persisted', async ({ page, baseURL }) => {
  await mockAuthenticatedFleet(page, appOriginFrom(baseURL));

  await page.addInitScript(() => {
    window.localStorage.setItem('fleet:default-view', 'grid');
  });

  await page.goto('/');
  await page.getByLabel('GitHub personal access token').fill(DUMMY_TOKEN);
  await page.getByRole('button', { name: 'Connect to GitHub' }).click();

  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByText('Authenticated as testuser')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByText('Authenticated as testuser')).toBeHidden();

  await expect(page.getByRole('table')).toBeVisible();
});
