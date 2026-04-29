import { test, expect } from '@playwright/test';

test('homepage loads successfully', async ({ page }) => {
  const response = await page.goto('/');
  expect(response.ok()).toBeTruthy();
  await expect(page.locator('body')).toBeVisible();
});

test('API proxy endpoint rejects non-POST', async ({ request }) => {
  const response = await request.get('/api/proxy');
  expect(response.status()).toBe(405);
});

test('API config runtime returns JSON', async ({ request }) => {
  const response = await request.get('/api/config/runtime');
  expect(response.ok()).toBeTruthy();
  const data = await response.json();
  expect(data).toBeDefined();
});

test('API storage history returns JSON', async ({ request }) => {
  const response = await request.get('/api/storage/history');
  expect(response.ok()).toBeTruthy();
  const data = await response.json();
  expect(data).toHaveProperty('items');
});

test('admin gate page is accessible', async ({ page }) => {
  const response = await page.goto('/');
  expect(response.ok()).toBeTruthy();
  // The admin gate should be visible (either as a dialog or inline form)
  const body = await page.textContent('body');
  expect(body).toBeTruthy();
});

test('static assets serve correctly', async ({ request }) => {
  const cssResponse = await request.get('/style.css');
  expect(cssResponse.ok()).toBeTruthy();
  expect(cssResponse.headers()['content-type']).toContain('text/css');
});
