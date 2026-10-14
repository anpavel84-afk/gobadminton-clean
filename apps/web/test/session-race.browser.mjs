/* global process, sessionStorage, window, navigator, document, Event, innerWidth, console, URL */
// Requires restored legacy fixture; currently NOT_TESTED.
// Author regression against the built React provider, synthetic loopback only.
// Run from repository root after starting Next on 127.0.0.1:18982.
import assert from 'node:assert/strict';
import { writeFile, mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL(process.cwd() + '/.tools/node_modules/playwright/index.mjs'));
const evidence = process.cwd() + '/docs/workbench/product-rebaseline/p1-repair01/';
const { state, response, city } = await import(pathToFileURL(evidence + 'legacy-fixture.mjs'));
const activeUnified = () => ({ state: 'active', contractVersion: 'players-unified-radar-v1', activationId: 'fixture-activation', version: 1, ownerHere: true, policyVersion: 'radar-geographic-sharing-v2', exposureMode: 'live', expiresAt: new Date(Date.now()+300000).toISOString(), hardExpiresAt: new Date(Date.now()+600000).toISOString(), foregroundUntil: new Date(Date.now()+90000).toISOString(), locationValidUntil: new Date(Date.now()+360000).toISOString(), nextLocationUpdateAt: new Date(Date.now()+300000).toISOString() });
const origin = process.env.P1_ORIGIN || 'http://127.0.0.1:18984';
const report = { kind: 'author checks, not independent QA', checks: [], failures: [], requests: [], pageErrors: [] };
await mkdir(evidence + 'session-race', { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  for (const width of [320, 390, 430, 768, 1024, 1440]) {
    for (const transition of ['B', 'logout']) {
      const name = `cold-A-to-${transition}-${width}`;
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      const s = { ...state(), configStatus: 200, queryStatus: 200, contactStatus: 200 };
      const calls = [], held = [];
      let holdA = true;
      await context.addInitScript(city => {
        sessionStorage.setItem('gb.consumer.location.v1', JSON.stringify({ cityId: city, nameRu: 'Москва', timezone: 'Europe/Moscow' }));
        window.__gps = 0;
        Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition: (_yes, no) => { window.__gps++; no({ code: 1 }); } } });
      }, city);
      await context.route('**/*', async route => {
        const req = route.request(), url = new URL(req.url());
        if (url.origin !== origin) return route.abort();
        if (!url.pathname.startsWith('/v1/')) return route.continue();
        const body = req.postData() ? req.postDataJSON() : null;
        const call = { name, actor: s.actor, path: url.pathname, method: req.method(), csrf: req.headers()['x-csrf-token'] ?? null };
        calls.push(call); report.requests.push(call);
        const r = response(s, url.pathname, req.method(), body);
        if (url.pathname === "/v1/me/radar/activations/current" && !s.guest) r.data = activeUnified();
        // Capture A now, then deliberately deliver its successful identity last.
        if (holdA && url.pathname === '/v1/me') await new Promise(resolve => held.push(resolve));
        await route.fulfill({ status: r.status, json: r.data }).catch(() => {});
      });
      const page = await context.newPage(); page.setDefaultTimeout(10000);
      page.on('pageerror', error => report.pageErrors.push({ name, error: String(error) }));
      try {
        await page.goto(origin + '/players');
        await page.waitForFunction(() => document.querySelector('.players-hero'));
        for (let i = 0; i < 100 && held.length < 2; i++) await page.waitForTimeout(25);
        assert.ok(held.length >= 2, 'cold header/provider A identity reads must be pending');
        holdA = false; s.actor = 'B'; s.guest = transition === 'logout';
        await page.evaluate(() => {
          window.dispatchEvent(new Event('gb-session-changed'));
          window.dispatchEvent(new Event('gb-session-changed'));
        });
        await page.waitForTimeout(300);
        held.splice(0).forEach(release => release());
        await page.waitForTimeout(500);
        if (s.guest) {
          await page.getByText('Войти для Radar', { exact: true }).waitFor();
          assert.equal(await page.getByRole('button', { name: 'Смотреть участников Radar', exact: true }).count(), 0);
          assert.equal(await page.getByRole('button', { name: 'Сортировать по близости', exact: true }).count(), 0);
          assert.equal(calls.filter(c => c.method !== 'GET').length, 0);
        } else {
          await page.getByRole('combobox', { name: 'Город', exact: true }).selectOption(city);
          // The mocked server confirms an active unified session; query is automatic.
          for (let i = 0; i < 100 && !calls.some(c => c.path === '/v1/players/query'); i++) await page.waitForTimeout(25);
          const queries = calls.filter(c => c.path === '/v1/players/query');
          assert.ok(queries.length > 0, 'B query must execute');
          assert.ok(queries.every(c => c.csrf === 'csrf-B'), 'no private action may retain csrf-A');
          assert.equal(await page.getByRole('link', { name: 'Профиль: Актор A', exact: true }).count(), 0);
        }
        assert.equal(await page.evaluate(() => window.__gps), 0);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        await page.screenshot({ path: evidence + 'session-race/' + name + '.png', fullPage: true });
        report.checks.push(name); console.log('PASS ' + name);
      } catch (error) {
        report.failures.push({ name, error: String(error), body: await page.locator('body').innerText() });
        console.log('FAIL ' + name + ': ' + error);
      } finally {
        held.splice(0).forEach(release => release()); await context.close();
      }
    }
  }
  // A feature 401 must survive a successful /me with a rotated same-account CSRF.
  const context = await browser.newContext({ viewport: { width: 390, height: 900 } });
  const s = { ...state(), configStatus: 200, queryStatus: 401, contactStatus: 200 };
  let rotated = false, identityAfter401 = 0, queryCalls = 0;
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin !== origin) return route.abort();
    if (!url.pathname.startsWith('/v1/')) return route.continue();
    const body = req.postData() ? req.postDataJSON() : null;
    if (url.pathname === '/v1/players/query') { rotated = true; queryCalls++; }
    const r = response(s, url.pathname, req.method(), body);
        if (url.pathname === "/v1/me/radar/activations/current" && !s.guest) r.data = activeUnified();
    if (url.pathname === '/v1/me' && rotated) { r.data.csrfToken = 'csrf-A-rotated'; identityAfter401++; }
    report.requests.push({ name: 'query401-same-account-rotation', path: url.pathname, status: r.status });
    await route.fulfill({ status: r.status, json: r.data }).catch(() => {});
  });
  const page = await context.newPage(); page.setDefaultTimeout(10000);
  page.on('pageerror', error => report.pageErrors.push({ name: 'query401-same-account-rotation', error: String(error) }));
  try {
    await page.goto(origin + '/players');
    await page.getByRole('combobox', { name: 'Город', exact: true }).selectOption(city);
    // The mocked server confirms an active unified session; query is automatic.
    await page.waitForTimeout(800);
    assert.ok(identityAfter401 > 0, 'independent /me200 with rotated token occurred');
    await page.getByText('Войдите снова, чтобы смотреть участников Radar.', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Смотреть участников Radar', exact: true }).count(), 0);
    await page.evaluate(() => window.dispatchEvent(new Event('pageshow')));
    await page.waitForTimeout(300);
    await page.getByText('Войдите снова, чтобы смотреть участников Radar.', { exact: true }).waitFor();
    assert.equal(queryCalls, 1, '401 must not silently retry');
    await page.screenshot({ path: evidence + 'session-race/query401-same-account-rotation.png', fullPage: true });
    report.checks.push('query401-same-account-rotation'); console.log('PASS query401-same-account-rotation');
  } catch (error) {
    report.failures.push({ name: 'query401-same-account-rotation', error: String(error), body: await page.locator('body').innerText() });
    console.log('FAIL query401-same-account-rotation: ' + error);
  } finally { await context.close(); }
} finally {
  await browser.close(); await writeFile(evidence + 'session-race-results.json', JSON.stringify(report, null, 2) + '\n');
}
if (report.failures.length || report.pageErrors.length) process.exitCode = 1;
