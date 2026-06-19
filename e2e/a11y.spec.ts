import { expect, test } from '@playwright/test';

/**
 * Accessibility keyboard-navigation spec (#20) — run against the real built app
 * with no token and no network. It proves, in a browser, the landmark
 * structure, heading order and the skip-to-content keyboard flow that the unit
 * tests assert in jsdom: a sighted keyboard user can jump straight past the
 * banner into the main content.
 */

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
