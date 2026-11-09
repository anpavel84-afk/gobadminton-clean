/* global process, Buffer, window, document, URL, setTimeout, requestAnimationFrame, performance, console */
// Synthetic loopback fixture only. Never live auth/UAT evidence.
// Run an already-installed Next server with API_BASE_URL=http://127.0.0.1:18985.
// Supply P1_ORIGIN, PLAYWRIGHT_MODULE_PATH and CHROMIUM_PATH from the qualified environment.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const origin = new URL(process.env.P1_ORIGIN || 'http://127.0.0.1:18984');
assert.ok(['127.0.0.1', 'localhost'].includes(origin.hostname), 'Loopback fixtures only');
assert.ok(process.env.PLAYWRIGHT_MODULE_PATH, 'Provide the existing qualified Playwright module path; no installs');
assert.ok(process.env.CHROMIUM_PATH, 'Provide installed qualified Chromium; sandbox is mandatory');
const evidenceRoot = resolve(process.cwd(), '../job');
const out = resolve(process.env.HEADER_EVIDENCE_DIR || resolve(evidenceRoot, 'header533-evidence'));
assert.ok(out.startsWith(evidenceRoot + '/'), 'Evidence must stay under the task job directory');
await mkdir(out, { recursive: true });
const { chromium } = await import(pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE_PATH)).href);
const upload = `/v1/media/avatars/${'a'.repeat(64)}.png`;
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5S8AAAAASUVORK5CYII=','base64');
const report = { environment: 'SYNTHETIC loopback, sandboxed installed Chromium; author checks only', liveAuthenticated: 'NOT_TESTED', cases: [], requests: [], pageErrors: [], consoleErrors: [] };
let delay = 0, bootstrapUnavailable = false;
const server = createServer(async (request, response) => {
  const path = new URL(request.url, 'http://127.0.0.1').pathname;
  const serverRead = !/Chrome/.test(request.headers['user-agent'] || '');
  report.requests.push({ path, serverRead });
  const authenticated = /(?:^|;\s*)__Host-gb_session=fixture-A(?:;|$)/.test(request.headers.cookie || '');
  const reply = (body, status = 200) => {
    response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify(body));
  };
  if (path === '/v1/me' || path === '/v1/me/social-profile') {
    await new Promise(resolve => setTimeout(resolve, delay + (path.endsWith('social-profile') ? 250 : 0)));
    if (!authenticated) return reply({}, 401);
    if (bootstrapUnavailable && serverRead) return reply({}, 503);
    return reply(path === '/v1/me'
      ? { id: 'fixture-A', displayName: 'provider-private@example.test', csrfToken: 'synthetic-only', locale: 'ru', linkedProviders: [] }
      : { publicPlayerId: 'fixture-public-A', version: 1, displayName: 'Анна Альфа', avatar: { uploadedUrl: upload, providerUrl: null }, socialEligible: true, trainer: false });
  }
  if (path.startsWith('/v1/media/avatars/')) {
    response.writeHead(200, { 'Content-Type': 'image/png' }); return response.end(png);
  }
  if (path === '/v1/cities') return reply({ items: [] });
  if (path === '/v1/discovery/city-hint') return reply({ cityId: null, source: 'default' });
  if (path === '/v1/me/inbox/counts') return reply({ pendingRequestCount: 0, pendingInvitationCount: 0, dmUnread: 0, gameChatUnread: 0 });
  return reply({}, 404);
});
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(Number(process.env.HEADER_FIXTURE_PORT || 18985), '127.0.0.1', resolve);
});
let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH, chromiumSandbox: true });
  for (const width of [390, 1280]) for (const speed of ['ordinary', 'slow']) {
    delay = speed === 'slow' ? 500 : 0;
    const context = await browser.newContext({ viewport: { width, height: 900 }, locale: 'ru-RU' });
    await context.addCookies([{ name: '__Host-gb_session', value: 'fixture-A', url: origin.origin, secure: true, httpOnly: true, sameSite: 'Lax' }]);
    await context.addInitScript(() => {
      window.headerTimeline = [];
      let previous;
      const sample = () => {
        const action = document.querySelector('.gb-header-profile');
        if (action) {
          const avatar = action.querySelector('.gb-header-avatar');
          const rect = action.getBoundingClientRect(), circle = avatar.getBoundingClientRect();
          const value = { label: action.getAttribute('aria-label'), text: action.textContent, avatar: avatar.querySelector('img')?.getAttribute('src') || avatar.textContent, busy: action.getAttribute('aria-busy'), rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, circle: { width: circle.width, height: circle.height } };
          const key = JSON.stringify(value);
          if (key !== previous) window.headerTimeline.push({ time: performance.now(), ...value });
          previous = key;
        }
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    const page = await context.newPage();
    page.on('pageerror', error => report.pageErrors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push(message.text()); });
    // Both direct URL and repeated new-document reloads exercise the actual SSR bootstrap.
    for (const action of ['direct', 'reload']) {
      const before = report.requests.length;
      if (action === 'direct') await page.goto(origin.origin + '/help', { waitUntil: 'domcontentloaded' });
      else await page.reload({ waitUntil: 'domcontentloaded' });
      const header = page.locator('.gb-header-profile');
      await header.waitFor();
      await page.screenshot({ path: `${out}/${width}-${speed}-${action}-first.png` });
      await page.waitForTimeout(delay * 2 + 1000);
      const timeline = await page.evaluate(() => window.headerTimeline);
      assert.ok(timeline.length > 0);
      assert.ok(timeline.every(frame => frame.label === 'Профиль: Анна Альфа'), 'No placeholder/old actor at any sampled paint');
      assert.ok(timeline.every(frame => frame.avatar === upload), 'Own avatar at every sampled paint');
      assert.ok(timeline.every(frame => frame.circle.width === 42 && frame.circle.height === 42));
      const widths = timeline.map(frame => frame.rect.width);
      assert.ok(Math.max(...widths) - Math.min(...widths) <= 1, 'Stable profile action geometry');
      const requests = report.requests.slice(before);
      assert.ok(requests.some(request => request.path === '/v1/me/social-profile' && request.serverRead), 'Next must use the fixture backend for SSR');
      await page.screenshot({ path: `${out}/${width}-${speed}-${action}-settled.png` });
      report.cases.push({ width, speed, action, timeline, identityEndpointCounts: {
        me: requests.filter(request => request.path === '/v1/me').length,
        social: requests.filter(request => request.path === '/v1/me/social-profile').length,
      } });
    }
    // No established server identity: intentional loading, then real social name.
    bootstrapUnavailable = true;
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('.gb-header-profile[aria-label="Профиль: Анна Альфа"]').waitFor();
    const loadingTimeline = await page.evaluate(() => window.headerTimeline);
    assert.ok(loadingTimeline.some(frame => frame.label === 'Профиль: загрузка' && frame.busy === 'true'));
    assert.ok(loadingTimeline.every(frame => ['Профиль: загрузка', 'Профиль: Анна Альфа'].includes(frame.label)));
    report.cases.push({ width, speed, action: 'no-established-identity', timeline: loadingTimeline });
    bootstrapUnavailable = false;
    await context.clearCookies();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('.gb-header-profile[aria-label="Профиль"]').waitFor();
    const guestTimeline = await page.evaluate(() => window.headerTimeline);
    assert.ok(guestTimeline.every(frame => !frame.text.includes('Анна')));
    report.cases.push({ width, speed, action: 'guest-new-document', timeline: guestTimeline });
    await context.close();
  }
  assert.deepEqual(report.pageErrors, []);
  assert.ok(!report.consoleErrors.some(error => /hydration|did not match/i.test(error)));
} finally {
  await writeFile(`${out}/browser-results.json`, JSON.stringify(report, null, 2) + '\n');
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
console.log(JSON.stringify({ cases: report.cases.length, pageErrors: report.pageErrors, liveAuthenticated: report.liveAuthenticated }));
