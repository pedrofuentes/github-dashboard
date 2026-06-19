import { expect, test, type Page } from '@playwright/test';

/**
 * Privacy network-interception spec (DoD #19) — the executable proof that the
 * user's PAT and data never leave the browser except to GitHub's own origins.
 *
 * The whole authenticated flow is driven against the *real* built app with a
 * dummy token, while every request is intercepted (`page.route('**\/*')`):
 *   - allowlisted GitHub requests are fulfilled with minimal fixtures so the app
 *     renders without ever touching the real network;
 *   - first-party app assets are served from the preview server;
 *   - anything else is aborted (it can never leave) *and* recorded so the
 *     enumerated assertions below fail loudly.
 */

/** A clearly-fake, classic-shaped PAT used as a sentinel we scan the wire for. */
const DUMMY_TOKEN = 'ghp_TESTTOKEN0000000000000000000000000000';

const GITHUB_API_ORIGIN = 'https://api.github.com';
const GITHUB_WEB_ORIGIN = 'https://github.com';

/** GitHub's REST API answers cross-origin browser calls with permissive CORS. */
const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
  'access-control-allow-headers':
    'Authorization, Accept, Content-Type, If-None-Match, X-GitHub-Api-Version',
};

/** A 1x1 placeholder served for the avatar so no real image is fetched. */
const TINY_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>';

/** Common analytics / telemetry hosts that must never be contacted. */
const ANALYTICS_HOSTS = [
  'google-analytics.com',
  'analytics.google.com',
  'googletagmanager.com',
  'stats.g.doubleclick.net',
  'doubleclick.net',
  'segment.io',
  'segment.com',
  'sentry.io',
  'mixpanel.com',
  'amplitude.com',
  'hotjar.com',
  'datadoghq.com',
  'plausible.io',
  'facebook.com',
];

/**
 * Resource types a privacy-respecting, client-only app may fetch from its own
 * origin: navigation + static assets only. The browser data channels
 * (`xhr`, `fetch`, `websocket`, `eventsource`) are deliberately excluded — a
 * same-origin one would be a backend / exfiltration path this app must not have.
 */
const STATIC_ASSET_RESOURCE_TYPES = new Set([
  'document',
  'script',
  'stylesheet',
  'font',
  'image',
  'manifest',
  'other',
]);

interface RecordedRequest {
  url: string;
  method: string;
  origin: string;
  resourceType: string;
  headers: Record<string, string>;
  postData: string | null;
}

function hostnameOf(value: string): string {
  try {
    return new URL(value).hostname;
  } catch {
    return '';
  }
}

function originOf(value: string): string {
  try {
    return new URL(value).origin;
  } catch {
    return value;
  }
}

/** True for `githubusercontent.com` and any of its sub-domains (avatars, etc.). */
function isGithubUserContent(origin: string): boolean {
  const host = hostnameOf(origin);
  return host === 'githubusercontent.com' || host.endsWith('.githubusercontent.com');
}

function isAllowlistedGitHubOrigin(origin: string): boolean {
  return (
    origin === GITHUB_API_ORIGIN || origin === GITHUB_WEB_ORIGIN || isGithubUserContent(origin)
  );
}

function appOriginFrom(baseURL: string | undefined): string {
  if (baseURL === undefined) {
    throw new Error('Playwright baseURL must be configured for the privacy test.');
  }
  return new URL(baseURL).origin;
}

/** Minimal, Zod-valid fixtures for each api.github.com endpoint the flow hits. */
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

function parsePolicy(policy: string): Map<string, string[]> {
  const directives = new Map<string, string[]>();
  for (const segment of policy.split(';')) {
    const tokens = segment.trim().split(/\s+/).filter(Boolean);
    const name = tokens[0];
    if (name === undefined) {
      continue;
    }
    directives.set(name.toLowerCase(), tokens.slice(1));
  }
  return directives;
}

/**
 * Installs the interceptor, drives the full sign-in → fleet → signals flow with
 * the dummy token, and returns every request the page attempted.
 */
async function recordPrivacyFlow(page: Page, appOrigin: string): Promise<RecordedRequest[]> {
  const requests: RecordedRequest[] = [];

  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = request.url();
    const method = request.method();
    const origin = originOf(url);

    requests.push({
      url,
      method,
      origin,
      resourceType: request.resourceType(),
      headers: await request.allHeaders(),
      postData: request.postData(),
    });

    // First-party app assets: serve the real built files from the preview server.
    if (origin === appOrigin) {
      await route.continue();
      return;
    }

    // CORS preflight for an allowlisted GitHub origin.
    if (method === 'OPTIONS') {
      if (isAllowlistedGitHubOrigin(origin)) {
        await route.fulfill({ status: 204, headers: CORS_HEADERS });
        return;
      }
      await route.abort();
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

    if (origin === GITHUB_WEB_ORIGIN) {
      await route.fulfill({
        status: 200,
        contentType: 'text/plain',
        headers: CORS_HEADERS,
        body: '',
      });
      return;
    }

    // Any other origin is a privacy violation: block it so nothing can leave.
    await route.abort();
  });

  await page.goto('/');
  await page.getByLabel('GitHub personal access token').fill(DUMMY_TOKEN);
  await page.getByRole('button', { name: 'Connect to GitHub' }).click();

  // Wait for the authenticated dashboard, the repo row (signals fired) and the
  // avatar (the *.githubusercontent.com path), then let the network settle.
  await expect(page.getByText('Authenticated as testuser')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'View details for octo-org/hello-world' }),
  ).toBeVisible();
  await expect(page.locator('header img')).toBeVisible();
  await page.waitForLoadState('networkidle');

  return requests;
}

test('contacts only GitHub-owned origins across the whole authenticated flow', async ({
  page,
  baseURL,
}) => {
  const appOrigin = appOriginFrom(baseURL);
  const requests = await recordPrivacyFlow(page, appOrigin);

  // Sanity: the flow genuinely exercised the network (auth + repos + a signal).
  expect(requests.some((r) => r.url === `${GITHUB_API_ORIGIN}/user`)).toBe(true);
  expect(requests.some((r) => r.url.startsWith(`${GITHUB_API_ORIGIN}/user/repos`))).toBe(true);
  expect(requests.some((r) => r.url.startsWith(`${GITHUB_API_ORIGIN}/repos/`))).toBe(true);

  // Core assertion — an enumerated check, not a soft filter: every request that
  // is not a first-party app asset MUST target an allowlisted GitHub origin.
  const offenders = requests
    .filter((r) => r.origin !== appOrigin && !isAllowlistedGitHubOrigin(r.origin))
    .map((r) => `${r.method} ${r.url}`);
  expect(offenders).toEqual([]);

  // DoD #80 — the app's own origin ('self') is permitted only as a navigation /
  // static-asset channel, never a same-origin data-exfiltration path. Every
  // first-party request must therefore be a GET for a document/script/style/
  // font/image (no XHR/fetch/websocket) and carry NO request body.
  const appRequests = requests.filter((r) => r.origin === appOrigin);
  expect(appRequests.length).toBeGreaterThan(0);
  const appOriginOffenders = appRequests
    .filter(
      (r) =>
        r.method !== 'GET' ||
        (r.postData ?? '') !== '' ||
        !STATIC_ASSET_RESOURCE_TYPES.has(r.resourceType),
    )
    .map((r) => `${r.method} [${r.resourceType}] ${r.url} postData=${JSON.stringify(r.postData)}`);
  expect(appOriginOffenders).toEqual([]);

  // Defense-in-depth: explicitly assert no analytics/telemetry host was hit.
  const contactedHosts = [...new Set(requests.map((r) => hostnameOf(r.url)))];
  const analyticsHit = contactedHosts.filter((host) =>
    ANALYTICS_HOSTS.some((bad) => host === bad || host.endsWith(`.${bad}`)),
  );
  expect(analyticsHit).toEqual([]);

  // The avatar really exercised the githubusercontent allowlist entry.
  expect(requests.some((r) => isGithubUserContent(r.origin))).toBe(true);
});

test('sends the PAT only as an Authorization header to api.github.com', async ({
  page,
  baseURL,
}) => {
  const appOrigin = appOriginFrom(baseURL);
  const requests = await recordPrivacyFlow(page, appOrigin);

  for (const request of requests) {
    // The token must never appear in a URL / query string, on any origin.
    expect(request.url, `token leaked in URL: ${request.url}`).not.toContain(DUMMY_TOKEN);
    // …nor in any request body, on any origin.
    expect(request.postData ?? '', `token leaked in body to ${request.origin}`).not.toContain(
      DUMMY_TOKEN,
    );

    const headersCarryingToken = Object.entries(request.headers)
      .filter(([, value]) => value.includes(DUMMY_TOKEN))
      .map(([name]) => name.toLowerCase());

    if (request.origin === GITHUB_API_ORIGIN) {
      // Only the Authorization header may carry the token — nothing else.
      for (const headerName of headersCarryingToken) {
        expect(headerName, `unexpected token-bearing header "${headerName}"`).toBe('authorization');
      }
    } else {
      // No non-api.github.com origin may receive the token in any header.
      expect(
        headersCarryingToken,
        `token leaked to ${request.origin} via header(s): ${headersCarryingToken.join(', ')}`,
      ).toEqual([]);
    }
  }

  // Positive control: the identity probe DID carry the token as a Bearer header
  // to api.github.com (otherwise the leak checks above would pass vacuously).
  const authProbe = requests.find(
    (r) => r.method === 'GET' && r.url === `${GITHUB_API_ORIGIN}/user`,
  );
  expect(authProbe).toBeDefined();
  expect(authProbe?.headers['authorization']).toBe(`Bearer ${DUMMY_TOKEN}`);
});

test('ships a GitHub-locked Content-Security-Policy (defense in depth)', async ({ page }) => {
  await page.goto('/');

  const content = await page
    .locator('meta[http-equiv="Content-Security-Policy"]')
    .getAttribute('content');
  expect(content).toBeTruthy();

  const directives = parsePolicy(content ?? '');
  const connectSrc = directives.get('connect-src') ?? [];
  expect(connectSrc).toEqual(
    expect.arrayContaining([
      "'self'",
      'https://api.github.com',
      'https://github.com',
      'https://*.githubusercontent.com',
    ]),
  );
  expect(connectSrc).not.toContain('*');
  expect(directives.get('default-src')).toContain("'self'");
  expect(directives.get('object-src')).toContain("'none'");
});
