/**
 * Synthetic browser regression; NEVER authenticated DEV UAT.
 * Independent QA provisions Playwright + Chromium outside the repository and
 * starts the existing built Admin server separately. No dependency/config change.
 * ADMIN_BROWSER_URL must point at a disposable loopback Admin server.
 * Run: node --test apps/admin/test/venue-selection.browser.mjs
 * Optional PLAYWRIGHT_MODULE: absolute path to QA-provisioned playwright entry.
 * Screenshots: ADMIN_BROWSER_EVIDENCE_DIR (existing writable evidence directory).
 * API interception exists only in this browser context; no real session is used.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const url = new URL(process.env.ADMIN_BROWSER_URL ?? 'http://localhost:3010');
if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
  throw new Error('Synthetic browser regression requires a disposable loopback server');
}
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const a = '11111111-1111-4111-8111-111111111111';
const b = '22222222-2222-4222-8222-222222222222';
const cursor = '33333333-3333-4333-8333-333333333333';
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';

for (const width of [390, 430, 768, 1024, 1440]) {
  test(`two-venue selection isolation and browser reload persistence at ${width}`, async () => {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const venues = new Map([a, b].map((id, i) => [id, {
      id, cityId: cursor, cityName: 'Синтетический город', name: `Тестовый зал ${i + 1}`,
      address: `Тестовый адрес ${i + 1}`, timezone: 'Europe/Moscow', latitude: 55,
      longitude: 37, identityDiscriminator: `Корт ${i + 1}`, lifecycleState: 'unverified',
      canonicalVenueId: null, version: 1, history: [],
    }]));
    const covers = new Map([[a, png], [b, null]]);
    const mutations = [];
    const listQueries = [];
    let refreshes = 0;
    await context.route('**/v1/admin/**', async route => {
      const request = route.request();
      const path = new URL(request.url());
      const endpoint = path.pathname.split('/v1/admin/')[1];
      const reply = body => route.fulfill({ json: structuredClone(body) });
      if (endpoint === 'auth/me') {
        refreshes++;
        return reply({ principalId: 'synthetic-browser-only', userId: a, sessionId: b,
          status: 'active', version: 1, roles: ['superadmin'], csrfToken: 'synthetic-only',
          expiresAt: new Date(Date.now() + 3600000).toISOString(), stepUpAt: new Date().toISOString() });
      }
      if (endpoint === 'venues') {
        listQueries.push(path.search);
        return reply({ items: path.searchParams.has('beforeId') ? [...venues.values()] : [],
          nextBeforeId: path.searchParams.has('beforeId') ? null : cursor });
      }
      const match = /^venues\/([^/]+)(?:\/(commands|cover))?$/.exec(endpoint);
      if (!match || !venues.has(match[1])) return route.fulfill({ status: 500, json: { code: 'UNEXPECTED_TEST_ROUTE' } });
      const [ , id, action ] = match;
      const venue = venues.get(id);
      if (!action) return reply(venue);
      if (request.method() !== 'GET') {
        assert.equal(request.headers()['x-csrf-token'], 'synthetic-only');
        assert.ok(request.headers()['idempotency-key']);
        mutations.push({ id, method: request.method(), action });
        if (action === 'commands') {
          const body = request.postDataJSON();
          assert.equal(body.action, 'edit');
          assert.equal(body.expectedVersion, venue.version);
          Object.assign(venue, body.fields);
        } else {
          assert.equal(Number(request.headers()['x-venue-version']), venue.version);
          if (request.method() === 'PUT') {
            assert.ok(request.postDataBuffer().length > 0);
            covers.set(id, png);
          } else {
            assert.equal(request.method(), 'DELETE');
            assert.equal(request.postDataJSON().expectedVersion, venue.version);
            covers.set(id, null);
          }
        }
        venue.version++;
      }
      return reply(action === 'cover'
        ? { version: venue.version, hasCover: !!covers.get(id), cover: { uploadedUrl: covers.get(id) } }
        : venue);
    });
    const page = await context.newPage();
    const open = async name => {
      await page.getByRole('button', { name: `${name} · Открыть / Редактировать`, exact: true }).click();
      await page.getByRole('heading', { name, exact: true }).waitFor();
      await page.locator('input[type=file]:enabled').waitFor();
    };
    const overflow = async () => assert.equal(await page.evaluate(() =>
      document.documentElement.scrollWidth > innerWidth), false);
    const shot = async phase => {
      if (process.env.ADMIN_BROWSER_EVIDENCE_DIR) await page.screenshot({
        path: `${process.env.ADMIN_BROWSER_EVIDENCE_DIR}/venue-${width}-${phase}.png`, fullPage: true });
    };
    try {
      await page.goto(url.href);
      await page.getByRole('button', { name: 'Площадки', exact: true }).click();
      await page.getByRole('button', { name: 'Следующие площадки', exact: true }).click();
      await open('Тестовый зал 1');
      await shot('before');
      await page.getByRole('button', { name: 'Редактировать данные', exact: true }).click();
      await page.getByLabel('Название', { exact: true }).fill('');
      assert.equal(await page.getByRole('button', { name: 'Подтвердить сохранение', exact: true }).isDisabled(), true);
      await page.getByRole('button', { name: 'Отмена', exact: true }).click();
      await page.getByRole('button', { name: 'Редактировать данные', exact: true }).click();
      await page.getByLabel('Название', { exact: true }).fill('Изменённый зал 1');
      await page.getByRole('button', { name: 'Подтвердить сохранение', exact: true }).click();
      await page.getByRole('heading', { name: 'Изменённый зал 1', exact: true }).waitFor();
      await page.locator('input[type=file]:enabled').waitFor();
      // Exercise the actual 15-second parent session refresh, not a direct component rerender.
      const previousRefreshes = refreshes;
      await page.waitForTimeout(16000);
      assert.ok(refreshes > previousRefreshes);
      assert.ok(new URLSearchParams(listQueries.at(-1)).has('beforeId'));
      await page.getByRole('button', { name: 'Изменённый зал 1 · Открыть / Редактировать', exact: true }).waitFor();
      await page.getByRole('heading', { name: 'Изменённый зал 1', exact: true }).waitFor();
      await overflow();
      await open('Тестовый зал 2');
      assert.equal(await page.getByAltText('Текущее фото площадки').count(), 0);
      // Generate a valid local image in Chromium; run the real client preparation helper.
      const image = await page.evaluate(() => {
        const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 400;
        const ctx = canvas.getContext('2d'); ctx.fillStyle = '#abc123'; ctx.fillRect(0, 0, 1200, 400);
        return canvas.toDataURL('image/png').split(',')[1];
      });
      await page.locator('input[type=file]').setInputFiles({ name: 'synthetic.png', mimeType: 'image/png', buffer: Buffer.from(image, 'base64') });
      await page.getByAltText('Предпросмотр нового фото').waitFor();
      await page.getByRole('button', { name: 'Загрузить / заменить', exact: true }).click();
      await page.getByAltText('Текущее фото площадки').waitFor();
      await page.locator('input[type=file]:enabled').waitFor();
      await open('Изменённый зал 1');
      assert.equal(await page.getByAltText('Текущее фото площадки').getAttribute('src'), png);
      await shot('after');
      await overflow();
      assert.deepEqual(mutations, [{ id: a, method: 'POST', action: 'commands' }, { id: b, method: 'PUT', action: 'cover' }]);
      await page.reload();
      await page.getByRole('button', { name: 'Площадки', exact: true }).click();
      await page.getByRole('button', { name: 'Следующие площадки', exact: true }).click();
      await open('Изменённый зал 1');
      await page.getByText('Тестовый адрес 1', { exact: true }).first().waitFor();
      await open('Тестовый зал 2');
      await page.getByAltText('Текущее фото площадки').waitFor();
      await page.getByRole('button', { name: 'Удалить фото', exact: true }).click();
      await page.getByRole('button', { name: 'Подтвердить удаление', exact: true }).click();
      await page.getByText('Нет опубликованного фото — используется стандартная обложка.', { exact: true }).waitFor();
      assert.equal(covers.get(a), png);
      assert.equal(venues.get(b).name, 'Тестовый зал 2');
      assert.deepEqual(mutations.at(-1), { id: b, method: 'DELETE', action: 'cover' });
      await overflow();
    } finally { await context.close(); await browser.close(); }
  });
}
