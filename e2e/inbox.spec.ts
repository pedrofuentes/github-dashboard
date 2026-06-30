import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * Notifications Inbox end-to-end spec (M11) — run against the *real* built app
 * with a dummy token while every request is intercepted (`page.route('**\/*')`),
 * mirroring `e2e/privacy.spec.ts` and `e2e/a11y.spec.ts`:
 *   - allowlisted `api.github.com` requests are fulfilled with minimal,
 *     Zod-valid fixtures so the fleet renders without touching the real network;
 *   - first-party app assets are served by the preview server;
 *   - the avatar is a tiny first-party SVG; anything else is aborted.
 *
 * Unlike the other fixtures, the GraphQL pull-request batch answers with one
 * outside-contributor PR so the Inbox derives exactly one `new-pr` item — enough
 * to prove the live view:
 * signing in, switching to the **Inbox** via the `ViewToggle`, the derived item
 * rendering with its unread badge, dismissing it down to the "all caught up"
 * empty state, and that the whole flow stays on GitHub-owned origins with no
 * uncaught errors.
 */

/** A clearly-fake PAT used only to drive the authenticated view; never sent anywhere real. */
const DUMMY_TOKEN = 'ghp_TESTTOKEN0000000000000000000000000000';

const GITHUB_API_ORIGIN = 'https://api.github.com';
const GITHUB_WEB_ORIGIN = 'https://github.com';

/** The single repo the fleet fixtures expose. */
const REPO_FULL_NAME = 'octo-org/hello-world';

/** An outside-contributor PR, so the Inbox derives exactly one `new-pr` item. */
const EXTERNAL_PR_NUMBER = 4242;
const EXTERNAL_PR_TITLE = 'New contributor PR';
const EXTERNAL_PR_URL = `https://github.com/${REPO_FULL_NAME}/pull/${EXTERNAL_PR_NUMBER}`;
const EXTERNAL_PR_CREATED_AT = '2026-06-20T12:00:00Z';

/** GitHub's REST API answers cross-origin browser calls with permissive CORS. */
const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
  'access-control-allow-headers':
    'Authorization, Accept, Content-Type, If-None-Match, X-GitHub-Api-Version',
};

/** A 1x1 placeholder served for the avatar so no real image is ever fetched. */
const TINY_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>';

/** A single intercepted request, recorded for the network-origin assertions. */
interface RecordedRequest {
  url: string;
  method: string;
  origin: string;
}

/** A single console error, kept with its source URL so favicon noise can be excluded. */
interface RecordedConsoleError {
  text: string;
  url: string;
}

function originOf(value: string): string {
  return new URL(value).origin;
}

function appOriginFrom(baseURL: string | undefined): string {
  if (baseURL === undefined) {
    throw new Error('Playwright baseURL must be configured for the inbox test.');
  }
  return new URL(baseURL).origin;
}

/** True for `githubusercontent.com` and any of its sub-domains (avatars, etc.). */
function isGithubUserContent(origin: string): boolean {
  const host = new URL(origin).hostname;
  return host === 'githubusercontent.com' || host.endsWith('.githubusercontent.com');
}

function isAllowlistedGitHubOrigin(origin: string): boolean {
  return (
    origin === GITHUB_API_ORIGIN || origin === GITHUB_WEB_ORIGIN || isGithubUserContent(origin)
  );
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
    return JSON.stringify([{ full_name: REPO_FULL_NAME, private: false, description: null }]);
  }
  if (pathname === `/repos/${REPO_FULL_NAME}`) {
    // Repo stats (open-issue count) — the issues signal reads this object, so it
    // must be a full repository payload, not the array list-endpoint fallback.
    return JSON.stringify({
      stargazers_count: 0,
      open_issues_count: 0,
      forks_count: 0,
      watchers_count: 0,
      full_name: REPO_FULL_NAME,
      description: null,
      visibility: 'public',
      html_url: `https://github.com/${REPO_FULL_NAME}`,
      language: null,
      size: 0,
      license: null,
      default_branch: 'main',
    });
  }
  if (pathname.includes('/actions/runs')) {
    return JSON.stringify({
      total_count: 0,
      workflow_runs: [],
    });
  }
  if (pathname.startsWith('/search/')) {
    return JSON.stringify({ total_count: 0, incomplete_results: false, items: [] });
  }
  // Pulls, dependabot alerts, code-scanning alerts and any other list endpoint.
  return JSON.stringify([]);
}

function graphQLBody(): string {
  return JSON.stringify({
    data: {
      viewer: { login: 'testuser' },
      rateLimit: { cost: 1, remaining: 4999, resetAt: '2026-06-29T18:00:00Z', limit: 5000 },
      r0: {
        nameWithOwner: REPO_FULL_NAME,
        isArchived: false,
        defaultBranchRef: { target: { statusCheckRollup: { state: 'SUCCESS' } } },
        openIssues: { totalCount: 0 },
        myIssues: { totalCount: 0 },
        pullRequests: {
          nodes: [
            {
              number: EXTERNAL_PR_NUMBER,
              title: EXTERNAL_PR_TITLE,
              url: EXTERNAL_PR_URL,
              createdAt: EXTERNAL_PR_CREATED_AT,
              isDraft: false,
              authorAssociation: 'FIRST_TIME_CONTRIBUTOR',
              author: { login: 'new-contributor' },
            },
          ],
        },
      },
      stale_r0: { issueCount: 0, nodes: [] },
      reviews: {
        issueCount: 0,
        pageInfo: { hasNextPage: false, endCursor: null },
        nodes: [],
      },
    },
  });
}

/**
 * Intercepts all network so the real built app can be driven into the
 * authenticated fleet view with a dummy token. The optional `onRequest` callback
 * records every attempt for the origin-allowlist assertions.
 */
async function installFleetRoutes(
  page: Page,
  appOrigin: string,
  onRequest?: (record: RecordedRequest) => void,
): Promise<void> {
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = request.url();
    const origin = originOf(url);
    onRequest?.({ url, method: request.method(), origin });

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
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: CORS_HEADERS,
          body: graphQLBody(),
        });
        return;
      }
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
    // Anything else (including a stray github.com web hit) is blocked so nothing leaves.
    await route.abort();
  });
}

/** The Inbox button inside the shared view-mode toggle; its name grows the unread badge. */
function inboxTab(page: Page): Locator {
  return page.getByRole('group', { name: 'View mode' }).getByRole('button', { name: /Inbox/ });
}

/** Signs in with the dummy token and waits for the authenticated fleet shell. */
async function signIn(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByLabel('GitHub personal access token').fill(DUMMY_TOKEN);
  await page.getByRole('button', { name: 'Connect to GitHub' }).click();
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByText('Authenticated as testuser')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByText('Authenticated as testuser')).toBeHidden();
}

/** Switches to the Inbox view via the toggle and returns the inbox region locator. */
async function openInbox(page: Page): Promise<Locator> {
  await inboxTab(page).click();
  const inbox = page.getByRole('region', { name: 'Notifications inbox' });
  await expect(inbox).toBeVisible();
  return inbox;
}

test.describe('notifications inbox', () => {
  test('switches to the Inbox view and renders the derived item with an unread badge', async ({
    page,
    baseURL,
  }) => {
    await installFleetRoutes(page, appOriginFrom(baseURL));
    await signIn(page);

    // The outside-contributor PR derives one unread item, so the toggle grows a badge —
    // a web-first assertion that waits for the new-PR signal to settle.
    const tab = inboxTab(page);
    await expect(tab).toContainText('1');
    await expect(tab).toHaveAccessibleName(/unread/);

    const inbox = await openInbox(page);

    // The single derived `new-pr` item renders, attributed to its repo.
    const items = inbox.getByRole('listitem');
    await expect(items).toHaveCount(1);
    await expect(items.first()).toContainText(EXTERNAL_PR_TITLE);
    await expect(items.first()).toContainText(REPO_FULL_NAME);

    // The header surfaces the same filter-independent unread count.
    await expect(inbox.getByText('1 unread')).toBeVisible();
  });

  test('dismissing the only item empties the Inbox and clears the unread badge', async ({
    page,
    baseURL,
  }) => {
    await installFleetRoutes(page, appOriginFrom(baseURL));
    await signIn(page);
    const inbox = await openInbox(page);

    const item = inbox.getByRole('listitem');
    await expect(item).toHaveCount(1);
    await expect(item.first()).toContainText(EXTERNAL_PR_TITLE);

    await inbox.getByRole('button', { name: `Dismiss ${EXTERNAL_PR_TITLE}` }).click();

    // Dismissed items are hidden by default, so the queue empties to the positive
    // "all caught up" empty state (never a blank panel).
    await expect(inbox.getByRole('listitem')).toHaveCount(0);
    await expect(inbox.getByText('All caught up — nothing needs your attention.')).toBeVisible();

    // With nothing left unread, the toggle badge disappears.
    await expect(inboxTab(page)).toHaveAccessibleName('Inbox');
  });

  test('keeps focus on the dismiss control reachable by keyboard', async ({ page, baseURL }) => {
    await installFleetRoutes(page, appOriginFrom(baseURL));
    await signIn(page);
    const inbox = await openInbox(page);
    await expect(inbox.getByRole('listitem')).toHaveCount(1);

    // The per-item dismiss control is a real, labelled button reachable in tab
    // order (not a colour-only affordance) — focus it directly and confirm.
    const dismiss = inbox.getByRole('button', { name: `Dismiss ${EXTERNAL_PR_TITLE}` });
    await dismiss.focus();
    await expect(dismiss).toBeFocused();
  });

  test('drives the whole Inbox flow with no console errors and no non-GitHub network', async ({
    page,
    baseURL,
  }) => {
    const appOrigin = appOriginFrom(baseURL);
    const requests: RecordedRequest[] = [];
    const consoleErrors: RecordedConsoleError[] = [];
    const pageErrors: string[] = [];

    page.on('console', (message) => {
      if (message.type() === 'error') {
        consoleErrors.push({ text: message.text(), url: message.location().url });
      }
    });
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await installFleetRoutes(page, appOrigin, (record) => requests.push(record));
    await signIn(page);
    const inbox = await openInbox(page);
    await expect(inbox.getByRole('listitem')).toHaveCount(1);
    await inbox.getByRole('button', { name: `Dismiss ${EXTERNAL_PR_TITLE}` }).click();
    await expect(inbox.getByText('All caught up — nothing needs your attention.')).toBeVisible();
    await page.waitForLoadState('networkidle');

    // Network: every request is either a first-party asset or an allowlisted
    // GitHub origin — nothing ever targets a non-GitHub origin.
    const offenders = requests
      .filter(
        (request) => request.origin !== appOrigin && !isAllowlistedGitHubOrigin(request.origin),
      )
      .map((request) => `${request.method} ${request.url}`);
    expect(offenders).toEqual([]);

    // No uncaught exceptions anywhere in the sign-in → inbox → dismiss flow.
    expect(pageErrors).toEqual([]);

    // No console errors either. The favicon is intentionally not bundled (no
    // `public/`), so a first-party `/favicon.ico` 404 is the one expected,
    // Inbox-unrelated console message and is excluded.
    const significantConsoleErrors = consoleErrors.filter(
      (error) => !/favicon/i.test(error.url) && !/favicon/i.test(error.text),
    );
    expect(significantConsoleErrors).toEqual([]);
  });
});
