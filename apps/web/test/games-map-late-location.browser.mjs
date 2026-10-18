/* global document, window */
// Local browser regression only; independent QA runs against an existing local server.
import assert from 'node:assert/strict';
import process from 'node:process';
import { URL, pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL(process.cwd() + '/.tools/node_modules/playwright/index.mjs'));
const origin = new URL(process.env.GB_MAP_LOCAL_ORIGIN || 'http://localhost:3000');
assert.ok(['localhost', '127.0.0.1'].includes(origin.hostname));
const browser = await chromium.launch({ headless: true });
try {
  for (const cityId of ['a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002']) {
    const context = await browser.newContext();
    const page = await context.newPage();
    let releaseIdentity;
    let releaseSnapshot;
    const identity = new Promise(resolve => { releaseIdentity = resolve; });
    const snapshot = new Promise(resolve => { releaseSnapshot = resolve; });
    await page.addInitScript(() => {
      window.backFocusCount = 0;
      document.addEventListener('focusin', event => {
        if (event.target.matches('.gb-games-map-back')) window.backFocusCount++;
      });
    });
    await page.route('**/v1/**', async route => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/v1/me') {
        await identity;
        return route.fulfill({ status: 401, json: { title: 'Guest' } });
      }
      if (path === '/v1/discovery/city-hint') return route.fulfill({ json: { cityId, source: 'default' } });
      if (path === '/v1/venues' || path === '/v1/games') {
        await snapshot;
        return route.fulfill({ json: { items: [], nextCursor: null } });
      }
      return route.fulfill({ status: 404, json: { title: 'No fixture' } });
    });
    await page.goto(new URL('/games?view=map', origin).href);
    await page.getByRole('heading', { name: 'Загружаем игры', exact: true }).waitFor();
    // Flush the old [view]-only effect's frame while location is still null.
    await page.evaluate(() => new Promise(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve))));
    releaseIdentity();
    const back = page.getByRole('button', { name: 'К списку игр', exact: true });
    await back.waitFor();
    await page.waitForFunction(() => document.activeElement?.matches('.gb-games-map-back'));
    assert.equal(await back.count(), 1, 'one return during snapshot loading');
    assert.equal(await page.evaluate(() => window.backFocusCount), 1, 'focus once on late mount');
    // Revalidation must not steal focus back from an overlay or another control.
    await page.evaluate(() => {
      const dialog = document.createElement('dialog');
      dialog.innerHTML = '<button>Overlay focus</button>';
      document.body.append(dialog);
      dialog.showModal();
      dialog.querySelector('button').focus();
    });
    releaseSnapshot();
    if (cityId.endsWith('2')) {
      await page.getByRole('alert').filter({ hasText: 'Карта выбранного города пока недоступна' }).waitFor();
      assert.equal(await back.count(), 1, 'no-map city retains one return');
      assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'Overlay focus');
      assert.equal(await page.evaluate(() => window.backFocusCount), 1);
      await page.evaluate(() => document.querySelector('dialog').close());
      await back.click();
      await page.waitForURL(url => url.searchParams.get('view') === 'list');
      await page.goBack();
      await back.waitFor();
      assert.equal(new URL(page.url()).searchParams.get('view'), 'map');
    } else {
      await page.getByRole('heading', { name: 'Карта не загрузилась' }).waitFor();
      assert.equal(await back.count(), 0, 'M0 error card exclusively owns return');
      await page.evaluate(() => document.querySelector('dialog').close());
      await page.getByRole('button', { name: 'Повторить', exact: true }).click();
      await page.getByRole('heading', { name: 'Карта не загрузилась' }).waitFor();
      assert.equal(await back.count(), 0);
      await page.getByRole('button', { name: '← К списку', exact: true }).click();
      await page.waitForURL(url => url.searchParams.get('view') === 'list');
    }
    await context.close();
  }
} finally { await browser.close(); }
