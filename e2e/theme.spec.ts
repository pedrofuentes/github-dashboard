import { expect, test, type Page } from '@playwright/test';

/**
 * Dark/light theme end-to-end coverage for the dark-theme milestone. Runs
 * against the real built app and exercises the header `ThemeToggle`
 * (`role="radiogroup"`, name "Theme") in a browser:
 *
 *  - toggling **Dark** flips the `dark` class on `<html>` and persists the
 *    choice to `localStorage['fleet:theme']`, surviving a reload;
 *  - **Light** clears the class and persists `'light'`;
 *  - the structural accessibility invariants (landmarks, the sole `h1`, the
 *    skip-to-content keyboard flow, and the labelled radiogroup with named
 *    radios) hold **in dark mode** too — both on the sign-in surface and on the
 *    authenticated fleet view.
 *
 * Why a structural sweep and not an axe run: `@axe-core/playwright` is not a
 * project dependency, and this milestone-finalisation task forbids adding new
 * dependencies. These assertions are the dependency-free stand-in for "no new
 * a11y violations in dark mode" — they re-verify, under the dark theme, the same
 * landmark/heading/keyboard invariants the light-theme a11y spec proves. If axe
 * is adopted later (its own approved change), this file is where a dark-mode
 * `AxeBuilder(...).analyze()` assertion would slot in.
 */

const THEME_KEY = 'fleet:theme';

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
    throw new Error('Playwright baseURL must be configured for the theme test.');
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
    // A richer fleet than a single repo so the authenticated dark-mode sweep
    // renders several tiles (public/private, described/undescribed, plus a fork
    // and an archived repo via passthrough fields). All Zod-valid per
    // UserRepoResponseSchema (full_name/private/description + passthrough).
    return JSON.stringify([
      {
        full_name: 'octo-org/hello-world',
        private: false,
        description: 'The flagship demo service.',
        fork: false,
        archived: false,
        pushed_at: '2026-06-20T12:00:00Z',
      },
      {
        full_name: 'octo-org/internal-tools',
        private: true,
        description: null,
        fork: false,
        archived: false,
        pushed_at: '2026-06-19T09:30:00Z',
      },
      {
        full_name: 'octo-org/legacy-api',
        private: false,
        description: 'Deprecated REST gateway, kept for back-compat.',
        fork: false,
        archived: true,
        pushed_at: '2026-04-01T08:00:00Z',
      },
      {
        full_name: 'octocat/spoon-knife',
        private: false,
        description: 'A forked sandbox repo.',
        fork: true,
        archived: false,
        pushed_at: '2026-06-18T16:45:00Z',
      },
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

/** Reads the persisted theme choice from the page's `localStorage`. */
function storedThemeChoice(page: Page): Promise<string | null> {
  return page.evaluate((key) => window.localStorage.getItem(key), THEME_KEY);
}

/** True when the resolved dark theme is applied (the `.dark` class on `<html>`). */
function htmlHasDarkClass(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.classList.contains('dark'));
}

/**
 * Re-verifies the dependency-free structural accessibility invariants — the
 * stand-in for an axe sweep — so they are proven to hold under the dark theme.
 */
async function assertStructuralA11y(page: Page): Promise<void> {
  // Landmarks plus exactly one h1 on the page. This asserts cardinality only
  // (not which landmark the h1 sits in); the light-theme a11y spec proves the
  // heading's placement and the natural tab order.
  await expect(page.getByRole('banner')).toBeVisible();
  await expect(page.getByRole('main')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);

  // The theme control is a labelled radiogroup whose every radio has a name.
  const themeGroup = page.getByRole('radiogroup', { name: 'Theme' });
  await expect(themeGroup).toBeVisible();
  for (const name of ['Light', 'Dark', 'System']) {
    await expect(themeGroup.getByRole('radio', { name })).toBeVisible();
  }

  // The skip-to-content control must still move focus into main under the dark
  // theme. The natural tab-order reachability is proven in the light-theme a11y
  // spec; here we re-verify the skip mechanism itself works in dark mode without
  // depending on the global sequential-focus start point (selecting a theme just
  // left focus on a radio).
  const skipLink = page.getByRole('link', { name: 'Skip to main content' });
  await skipLink.focus();
  await expect(skipLink).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#main-content$/);
  await expect(page.getByRole('main')).toBeFocused();
}

test.describe('theme toggle: dark mode + persistence', () => {
  test('selecting Dark flips the html class, persists, and survives a reload', async ({ page }) => {
    await page.goto('/');

    const themeGroup = page.getByRole('radiogroup', { name: 'Theme' });
    const darkRadio = themeGroup.getByRole('radio', { name: 'Dark' });
    const lightRadio = themeGroup.getByRole('radio', { name: 'Light' });

    await darkRadio.click();

    // The resolved theme is applied to <html> and the choice is persisted.
    await expect(darkRadio).toHaveAttribute('aria-checked', 'true');
    expect(await htmlHasDarkClass(page)).toBe(true);
    expect(await storedThemeChoice(page)).toBe('dark');

    // The persisted choice is restored before paint on a fresh load (no FOUC):
    // the page comes back dark without re-toggling.
    await page.reload();
    expect(await htmlHasDarkClass(page)).toBe(true);
    expect(await storedThemeChoice(page)).toBe('dark');
    await expect(
      page.getByRole('radiogroup', { name: 'Theme' }).getByRole('radio', { name: 'Dark' }),
    ).toHaveAttribute('aria-checked', 'true');

    // Switching back to Light clears the class and persists 'light'.
    await lightRadio.click();
    await expect(lightRadio).toHaveAttribute('aria-checked', 'true');
    expect(await htmlHasDarkClass(page)).toBe(false);
    expect(await storedThemeChoice(page)).toBe('light');
  });
});

test.describe('theme toggle: accessibility holds in dark mode', () => {
  test('the sign-in surface keeps its a11y invariants after switching to Dark', async ({
    page,
  }) => {
    await page.goto('/');

    await page
      .getByRole('radiogroup', { name: 'Theme' })
      .getByRole('radio', { name: 'Dark' })
      .click();
    await expect.poll(() => htmlHasDarkClass(page)).toBe(true);

    await assertStructuralA11y(page);
  });

  test('the authenticated fleet view keeps its a11y invariants in dark mode', async ({
    page,
    baseURL,
  }) => {
    await mockAuthenticatedFleet(page, appOriginFrom(baseURL));

    await page.goto('/');
    await page
      .getByRole('radiogroup', { name: 'Theme' })
      .getByRole('radio', { name: 'Dark' })
      .click();
    await expect.poll(() => htmlHasDarkClass(page)).toBe(true);

    await page.getByLabel('GitHub personal access token').fill(DUMMY_TOKEN);
    await page.getByRole('button', { name: 'Connect to GitHub' }).click();
    await expect(page.getByText('Authenticated as testuser')).toBeVisible();

    // The fleet UI rendered under the dark theme; the structural invariants and
    // the persisted choice still hold.
    await expect.poll(() => htmlHasDarkClass(page)).toBe(true);
    expect(await storedThemeChoice(page)).toBe('dark');
    await assertStructuralA11y(page);
  });
});
