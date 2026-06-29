import { expect, test, type Page } from '@playwright/test';

/**
 * Accessibility keyboard-navigation spec (#20) — run against the real built app
 * with no token and no network. It proves, in a browser, the landmark
 * structure, heading order and the skip-to-content keyboard flow that the unit
 * tests assert in jsdom: a sighted keyboard user can jump straight past the
 * banner into the main content.
 */

/** Parses a CSS `rgb()` / `rgba()` color string into its 8-bit channels. */
function parseRgb(color: string): [number, number, number] {
  const channels = color.match(/[\d.]+/g);
  if (channels === null || channels.length < 3) {
    throw new Error(`Unparseable color: ${color}`);
  }
  // A fully transparent color (alpha 0) has no visible boundary, so treating it
  // as opaque would let a non-text-contrast assertion pass vacuously. Reject it.
  if (channels.length >= 4 && Number(channels[3]) === 0) {
    throw new Error(`Fully transparent color has no visible border: ${color}`);
  }
  return [Number(channels[0]), Number(channels[1]), Number(channels[2])];
}

/** Linearises one 8-bit sRGB channel per the WCAG 2.x relative-luminance model. */
function channelLuminance(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);
}

/** WCAG contrast ratio of a CSS color against a white (#fff) surface. */
function contrastWithWhite(color: string): number {
  const whiteLuminance = 1;
  return (whiteLuminance + 0.05) / (relativeLuminance(parseRgb(color)) + 0.05);
}

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

test.describe('accessibility: landmarks and headings', () => {
  test('exposes banner and main landmarks with the sole h1 outside main', async ({ page }) => {
    await page.goto('/');

    const banner = page.getByRole('banner');
    const main = page.getByRole('main');
    await expect(banner).toBeVisible();
    await expect(main).toBeVisible();

    // The page title is the only h1 and belongs to the banner, not to main.
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(banner.getByRole('heading', { level: 1, name: 'github-dashboard' })).toBeVisible();
    await expect(main.getByRole('heading', { level: 1 })).toHaveCount(0);
  });
});

test.describe('accessibility: skip-to-content keyboard flow', () => {
  test('first Tab focuses the skip link and Enter moves focus into main', async ({ page }) => {
    await page.goto('/');

    const skipLink = page.getByRole('link', { name: 'Skip to main content' });

    // The skip link is the very first tabbable control on the page.
    await page.keyboard.press('Tab');
    await expect(skipLink).toBeFocused();

    // Activating it jumps the fragment and moves focus to the main landmark,
    // which is programmatically focusable via tabindex=-1.
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#main-content$/);
    await expect(page.getByRole('main')).toBeFocused();
  });

  test('the token form field is keyboard reachable via Tab and has an accessible name', async ({
    page,
  }) => {
    await page.goto('/');

    const tokenField = page.getByLabel('GitHub personal access token');

    // Real keyboard navigation — not a programmatic `.focus()`, which would pass
    // regardless of tab order. Starting from page load, Tab forward until the
    // PAT field receives focus, proving it is reachable in the natural tab order
    // (no focus trap, no positive-tabindex jump). The loop is bounded so an
    // unreachable field fails fast instead of hanging.
    const maxTabStops = 10;
    let reached = false;
    for (let step = 0; step < maxTabStops && !reached; step += 1) {
      await page.keyboard.press('Tab');
      reached = await tokenField.evaluate((element) => element === document.activeElement);
    }

    expect(reached, `the PAT field was not reachable within ${maxTabStops} Tab presses`).toBe(true);
    await expect(tokenField).toBeFocused();
    await expect(page.getByRole('button', { name: 'Connect to GitHub' })).toBeVisible();
  });
});

test.describe('accessibility: non-text contrast (WCAG 1.4.11)', () => {
  test('the token field border clears the 3:1 non-text contrast minimum', async ({ page }) => {
    await page.goto('/');

    const tokenField = page.getByLabel('GitHub personal access token');
    const borderColor = await tokenField.evaluate(
      (element) => getComputedStyle(element).borderTopColor,
    );

    // WCAG 1.4.11 requires ≥3:1 contrast between a control's visual boundary and
    // the adjacent surface so low-vision users can perceive the field edge. The
    // resting border is measured against white (its fill), matching how the
    // boundary is evaluated on the sign-in surface.
    expect(contrastWithWhite(borderColor)).toBeGreaterThanOrEqual(3);
  });

  test('the FleetGrid filter input border clears the 3:1 non-text contrast minimum', async ({
    page,
    baseURL,
  }) => {
    // The filter input lives in the authenticated fleet view (FleetGrid), so a
    // contrast regression there (e.g. reverting its border to slate-400, 2.56:1)
    // would otherwise ship undetected — the sign-in PAT field never exercises it.
    await mockAuthenticatedFleet(page, appOriginFrom(baseURL));

    // Start from the table grid regardless of the factory default view, so the
    // FleetGrid filter input this test asserts on renders on load.
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

    const filterInput = page.getByLabel('Filter repositories by name');
    await expect(filterInput).toBeVisible();

    const border = await filterInput.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        color: style.borderTopColor,
        width: Number.parseFloat(style.borderTopWidth),
        lineStyle: style.borderTopStyle,
      };
    });

    // Guard against a vacuous pass: a control with no rendered border (zero width
    // or `none` style) has no visible boundary to contrast at all.
    expect(border.width).toBeGreaterThan(0);
    expect(border.lineStyle).not.toBe('none');

    // The filter sits on a white fill, so its resting border must clear 3:1
    // against white for low-vision users to perceive the field edge.
    expect(contrastWithWhite(border.color)).toBeGreaterThanOrEqual(3);
  });
});

test.describe('color parsing: parseRgb alpha handling', () => {
  test('rejects a fully transparent color so a borderless control cannot pass vacuously', () => {
    // A transparent border (alpha 0) has no visible boundary; parsing it as an
    // opaque RGB triple would let a non-text-contrast assertion pass vacuously.
    expect(() => parseRgb('rgba(100, 116, 139, 0)')).toThrow();
    // An opaque color (alpha 1, or no alpha channel) still parses to its RGB.
    expect(parseRgb('rgba(100, 116, 139, 1)')).toEqual([100, 116, 139]);
    expect(parseRgb('rgb(100, 116, 139)')).toEqual([100, 116, 139]);
  });
});
