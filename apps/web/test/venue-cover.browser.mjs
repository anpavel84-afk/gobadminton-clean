/* global process, URL, console, document */
// Synthetic guest-only loopback regression. No service startup or browser download.
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { pathToFileURL } from 'node:url';
const origin = process.env.P1_ORIGIN || 'http://127.0.0.1:18984';
assert.equal(new URL(origin).hostname, '127.0.0.1', 'Synthetic loopback only');
const { chromium } = await import(pathToFileURL(process.cwd() + '/.tools/node_modules/playwright/index.mjs'));
const browser = await chromium.launch({ headless: true, chromiumSandbox: true });
const id = '00000037-1111-4111-8111-111111111111';
const image = '/v1/media/venue-covers/' + 'a'.repeat(64) + '.png';
try {
  for (const width of [320, 360, 390, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const adminCalls = new Map();
    let uploadedUrl = image;
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      const path = url.pathname;
      const reply = (json, status = 200) => route.fulfill({ json, status });
      if (path.startsWith('/v1/admin/')) {
        adminCalls.set(path, (adminCalls.get(path) || 0) + 1);
        return reply({ title: 'Forbidden' }, 403);
      }
      if (path === '/v1/me') return reply({ title: 'Synthetic guest' }, 401);
      if (path === `/v1/venues/${id}`) return reply({ id, cityId: 'synthetic', name: 'Synthetic venue', address: 'Synthetic address', timezone: 'Europe/Moscow', latitude: 55.7, longitude: 37.6, dataStatus: 'verified', provenance: 'admin_created', cover: { uploadedUrl } });
      if (path === image) return route.fulfill({ contentType: 'image/png', body: Buffer.from([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1,8,4,0,0,0,181,28,12,2,0,0,0,11,73,68,65,84,120,218,99,100,248,15,0,1,5,1,1,39,24,227,102,0,0,0,0,73,69,78,68,174,66,96,130]) });
      if (path === '/v1/venues') return reply({ items: [{ id, cityId: 'synthetic', name: 'Synthetic venue', address: 'Synthetic address', timezone: 'Europe/Moscow' }], nextCursor: null });
      if (path.startsWith('/v1/')) return reply({ items: [], nextCursor: null });
      return route.continue();
    });
    const page = await context.newPage();
    for (const hasCover of [true, false]) {
      uploadedUrl = hasCover ? image : null;
      await page.goto(`${origin}/venues/${id}`);
      await page.getByRole('heading', { name: 'Synthetic venue', exact: true }).waitFor();
      await page.getByText('Synthetic address', { exact: true }).waitFor();
      await page.locator(`[data-cover="${hasCover ? 'uploaded' : 'default'}"]`).waitFor();
      if (hasCover) assert.equal(await page.getByAltText('Обложка: Synthetic venue').getAttribute('src'), image);
      assert.equal(await page.getByRole('heading', { name: 'Обложка площадки', exact: true }).count(), 0);
      assert.equal(await page.locator('input[type=file]').count(), 0);
      assert.equal(await page.getByRole('button', { name: 'Подтвердить обложку', exact: true }).count(), 0);
      assert.equal(await page.getByRole('button', { name: 'Удалить обложку', exact: true }).count(), 0);
      await page.getByRole('button', { name: 'Обновить расписание', exact: true }).click();
      await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent === 'Обновить расписание' && !button.disabled));
      assert.deepEqual([...adminCalls.entries()], [], 'Every admin attempt counts, including handled 403');
    }
    await context.close();
  }
  console.log('Synthetic guest public venue scenario passed; not independent QA or visual acceptance.');
} finally { await browser.close(); }
