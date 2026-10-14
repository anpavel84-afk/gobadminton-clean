/* global process, console, window, document, Event, URL */
// AUTHOR_CHECKS only. Built Next + pre-provisioned Playwright; synthetic loopback API.
// Run: FRIENDS_ORIGIN=http://127.0.0.1:18987 node apps/web/test/friends.browser.mjs
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL(process.env.FRIENDS_PLAYWRIGHT_PATH || process.cwd() + '/.tools/node_modules/playwright/index.mjs'));
const origin = process.env.FRIENDS_ORIGIN || 'http://127.0.0.1:18987';
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname), 'synthetic loopback only');
const out = process.env.FRIENDS_EVIDENCE_DIR || '/tmp/gobadminton-friends-author-checks';
await mkdir(out, { recursive: true });
const peer = '10000000-0000-4000-8000-000000000002';
const fid = '10000000-0000-4000-8000-000000000003';
const rid = '10000000-0000-4000-8000-000000000004';
const avatar = { uploadedUrl: null, providerUrl: null };
const report = { kind: 'AUTHOR_CHECKS_NOT_INDEPENDENT_QA', checks: [], failures: [], pageErrors: [] };
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
async function scenario(name, fn, width = 390) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, locale: 'ru-RU' });
  const s = { relationship: 'none', version: '9007199254740993', enabled: true, hidden: false, status: 200, guest: false, cursor: null };
  const writes = [], reads = [];
  const view = () => ({ friendshipId: s.relationship === 'none' ? null : fid, relationship: s.hidden ? 'unavailable' : s.relationship,
    version: s.version, request: s.relationship.endsWith('_pending') && !s.hidden ? { id: rid, expiresAt: '2030-10-20T00:00:00Z' } : null,
    peer: s.hidden ? null : { publicPlayerId: peer, displayName: 'Синтетический игрок', avatar },
    capabilities: { canRequest: !s.hidden && s.relationship === 'none', canAccept: !s.hidden && s.relationship === 'incoming_pending',
      canDecline: !s.hidden && s.relationship === 'incoming_pending', canCancel: !s.hidden && s.relationship === 'outgoing_pending', canRemove: s.relationship === 'friends' } });
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname;
    if (url.origin !== origin) return route.abort();
    if (!path.startsWith('/v1/')) return route.continue();
    let status = 200, data = {};
    if (req.method() === 'POST') {
      writes.push({ path, body: req.postDataJSON(), key: req.headers()['idempotency-key'], csrf: req.headers()['x-csrf-token'] });
      assert.equal(req.headers()['x-csrf-token'], 'synthetic-csrf'); assert.ok(req.headers()['idempotency-key']);
      status = s.status;
      if (status === 200) {
        if (path === '/v1/friend-requests') { assert.deepEqual(req.postDataJSON(), { targetPublicPlayerId: peer }); s.relationship = 'outgoing_pending'; }
        else {
          assert.deepEqual(req.postDataJSON(), { expectedVersion: s.version });
          s.relationship = path.endsWith('/accept') ? 'friends' : 'none';
        }
        s.version = String(BigInt(s.version) + 1n);
        data = { friendshipId: fid, requestId: rid, version: s.version, outcome: s.relationship === 'friends' ? 'accepted' : 'pending' };
      } else { data = { code: status === 409 ? 'FRIENDSHIP_STALE' : 'UNAUTHORIZED', title: 'Synthetic error' }; if (status === 401) s.guest = true; }
    } else {
      reads.push(url.pathname + url.search);
      if (s.guest && path.startsWith('/v1/me')) { status = 401; data = { code: 'UNAUTHORIZED' }; }
      else if (path === '/v1/me') data = { id: 'synthetic-actor', displayName: 'Синтетический владелец', csrfToken: 'synthetic-csrf', locale: 'ru', linkedProviders: [] };
      else if (path === '/v1/me/social-profile') data = { publicPlayerId: fid, displayName: 'Синтетический владелец', avatar, cityId: null, directoryVisible: true, socialEligible: true, contactPolicy: 'requests' };
      else if (path === '/v1/me/social-capabilities') data = { friends: s.enabled, gameRecommendations: false, gameAttention: false, socialPush: false };
      else if (path === '/v1/me/friendship-states') data = { items: [view()] };
      else if (path === '/v1/me/friendships') data = { items: s.relationship === 'none' ? [] : [view()], nextCursor: s.cursor, asOf: new Date().toISOString() };
      else if (path === '/v1/players/' + peer) data = { publicPlayerId: peer, displayName: 'Синтетический игрок', avatar, cityId: null, areaKey: null, bio: null, level: null, trainer: false, lookingForGame: false, canRequestContact: false };
      else if (path === '/v1/cities') data = { items: [] };
      else if (path === '/v1/me/inbox/counts') data = { unreadMessages: 0, pendingRequests: 0, pendingInvitations: 0, gameAttention: 0 };
      else { status = 404; data = { code: 'RESOURCE_UNAVAILABLE' }; }
    }
    if (status === 0) return route.abort();
    await route.fulfill({ status, json: data });
  });
  const page = await context.newPage(); page.setDefaultTimeout(10000);
  page.on('pageerror', error => report.pageErrors.push({ name, error: String(error) }));
  try { await fn({ page, s, writes, reads }); await page.screenshot({ path: `${out}/${name}.png`, fullPage: true });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no horizontal overflow');
    report.checks.push(name);
  } catch (error) { report.failures.push({ name, error: String(error), writes, reads }); }
  finally { await context.close(); }
}
try {
  for (const width of [390, 1440]) await scenario(`profile-lifecycle-${width}`, async ({ page, s, writes }) => {
    await page.goto(`${origin}/players/${peer}`);
    await page.getByRole('button', { name: 'Добавить в друзья', exact: true }).click();
    await page.getByRole('button', { name: 'Отменить запрос', exact: true }).click();
    await page.getByRole('button', { name: 'Добавить в друзья', exact: true }).waitFor();
    s.relationship = 'incoming_pending'; await page.reload();
    await page.getByRole('button', { name: 'Отклонить', exact: true }).click();
    await page.getByRole('button', { name: 'Добавить в друзья', exact: true }).waitFor();
    s.relationship = 'incoming_pending'; await page.reload();
    await page.getByRole('button', { name: 'Принять', exact: true }).click();
    await page.getByRole('button', { name: 'Удалить из друзей', exact: true }).click();
    assert.equal(writes.length, 4, 'opening modal does not remove');
    await page.getByRole('dialog').getByRole('button', { name: 'Оставить в друзьях', exact: true }).click();
    assert.equal(writes.length, 4);
    await page.getByRole('button', { name: 'Удалить из друзей', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Удалить из друзей', exact: true }).click();
    await page.getByRole('button', { name: 'Добавить в друзья', exact: true }).waitFor(); assert.equal(writes.length, 5);
  }, width);
  await scenario('unknown-explicit-retry', async ({ page, s, writes }) => {
    s.status = 0; await page.goto(`${origin}/players/${peer}`);
    await page.getByRole('button', { name: 'Добавить в друзья', exact: true }).click();
    await page.getByRole('button', { name: 'Проверить отправку', exact: true }).waitFor();
    assert.equal(writes.length, 1); assert.ok(await page.getByRole('button', { name: 'Добавить в друзья', exact: true }).isDisabled());
    await page.reload(); await page.getByRole('button', { name: 'Проверить отправку', exact: true }).waitFor(); assert.equal(writes.length, 1);
    s.status = 200; await page.getByRole('button', { name: 'Проверить отправку', exact: true }).click();
    await page.getByRole('button', { name: 'Отменить запрос', exact: true }).waitFor(); assert.deepEqual(writes[1], writes[0]);
  });
  for (const status of [401, 409]) await scenario(`mutation-${status}`, async ({ page, s, writes }) => {
    s.status = status; await page.goto(`${origin}/players/${peer}`);
    await page.getByRole('button', { name: 'Добавить в друзья', exact: true }).click();
    if (status === 401) await page.getByRole('button', { name: 'Войти, чтобы написать', exact: true }).waitFor();
    else await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent === 'Добавить в друзья' && !button.disabled));
    assert.equal(writes.length, 1); assert.equal(await page.getByRole('button', { name: 'Проверить отправку', exact: true }).count(), 0);
  });
  await scenario('list-tabs-paging-withdraw-expire', async ({ page, s, writes, reads }) => {
    s.relationship = 'friends'; s.cursor = 'opaque&view=outgoing'; await page.goto(origin + '/friends');
    await page.getByRole('link', { name: 'Синтетический игрок', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Следующая страница', exact: true }).click();
    await page.getByRole('link', { name: 'Синтетический игрок', exact: true }).waitFor();
    assert.ok(reads.includes('/v1/me/friendships?view=accepted&limit=20&cursor=opaque%26view%3Doutgoing'));
    for (const [tab, view] of [['Входящие', 'incoming'], ['Исходящие', 'outgoing']]) {
      await page.getByRole('button', { name: tab, exact: true }).click();
      await page.getByRole('link', { name: 'Синтетический игрок', exact: true }).waitFor();
      assert.ok(reads.includes(`/v1/me/friendships?view=${view}&limit=20`));
    }
    s.hidden = true; await page.getByRole('button', { name: 'Обновить список', exact: true }).click();
    await page.getByRole('heading', { name: 'Игрок недоступен', exact: true }).waitFor();
    assert.equal(await page.getByRole('link', { name: 'Синтетический игрок', exact: true }).count(), 0);
    assert.equal(writes.length, 0);
    s.guest = true; await page.evaluate(() => window.dispatchEvent(new Event('gb-private-expired')));
    await page.getByText('Войдите, чтобы увидеть друзей и запросы.', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Удалить из друзей', exact: true }).count(), 0);
  });
  await scenario('flag-off', async ({ page, s, writes }) => {
    s.enabled = false; await page.goto(origin + '/friends'); await page.getByText('Друзья сейчас недоступны', { exact: true }).waitFor(); assert.equal(writes.length, 0);
  });
} finally { await browser.close(); await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2)); }
console.log(JSON.stringify(report));
if (report.failures.length || report.pageErrors.length) process.exitCode = 1;
