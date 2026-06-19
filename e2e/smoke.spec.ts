import { expect, test } from '@playwright/test';

test('loads the app and shows the dashboard heading', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { level: 1, name: 'github-dashboard' })).toBeVisible();
});
