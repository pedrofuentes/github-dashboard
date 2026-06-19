import { expect, test } from '@playwright/test';

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
});
