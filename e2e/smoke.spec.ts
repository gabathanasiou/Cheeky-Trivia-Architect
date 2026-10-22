import { expect, test } from '@playwright/test';

test('boots the Architect UI', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: /cheeky trivia architect/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /start background job/i })).toBeVisible();
});

test('runs a mock batch and surfaces completed items', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /start background job/i }).click();

  await expect(
    page.getByRole('button', { name: /results \(2\)/i }),
  ).toBeVisible({ timeout: 20_000 });
});

test('shows the jobs dashboard', async ({ page }) => {
  await page.goto('/#jobs');
  await expect(page.getByRole('heading', { name: 'JOBS', exact: true })).toBeVisible();
});

test('sends the optimizer input to a background job', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /start background job/i }).click();
  await expect(page.getByTestId('job-banner')).toBeVisible({ timeout: 15_000 });
});
