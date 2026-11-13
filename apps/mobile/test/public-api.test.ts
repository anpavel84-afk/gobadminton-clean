import { test } from 'node:test';
import assert from 'node:assert/strict';
import { API_ORIGIN, createPublicApi, PublicApiError } from '../src/public-api.ts';
import { game, cities } from './fixtures.ts';
function response(data: unknown, status = 200) { return new Response(JSON.stringify(data), { status }); }
test('only actual DEV public GET endpoints, encoded city/cursor/id, no cookies/auth/mutations', async () => {
  const calls: Array<{ url: string; options?: RequestInit }> = [];
  const results = [{ apiVersion: '0.43.0' }, { items: cities }, { items: [game], nextCursor: 'opaque' }, game];
  const api = createPublicApi(async (url, options) => {
    calls.push({ url: String(url), options });
    return response(results.shift());
  });
  assert.deepEqual(await api.meta(), { apiVersion: '0.43.0' });
  assert.deepEqual(await api.cities(), cities);
  assert.equal((await api.games('city&1', 'opaque/+')).items[0]?.availablePlaces, 3);
  assert.deepEqual(await api.game('id/?'), game);
  assert.deepEqual(calls.map(call => call.url), [
    `${API_ORIGIN}/v1/meta`, `${API_ORIGIN}/v1/cities`,
    `${API_ORIGIN}/v1/games?cityId=city%261&limit=20&cursor=opaque%2F%2B`,
    `${API_ORIGIN}/v1/games/id%2F%3F`,
  ]);
  for (const { options } of calls) {
    assert.equal(options?.method, 'GET');
    assert.equal(options?.credentials, 'omit');
    assert.equal(options?.redirect, 'error');
    assert.deepEqual(options?.headers, { Accept: 'application/json' });
    assert.equal(options?.body, undefined);
  }
});
test('public detail 404, 410, absent body and empty response are unavailable; no fabricated success', async () => {
  for (const status of [404, 410, 204, 200]) {
    const api = createPublicApi(async () => status === 204 ? new Response(null, { status }) : response(null, status));
    await assert.rejects(api.game('private-or-missing'), (error: unknown) => error instanceof PublicApiError && error.kind === 'unavailable');
  }
  const malformed = createPublicApi(async () => response({}));
  await assert.rejects(malformed.game('empty'), (error: unknown) => error instanceof PublicApiError && error.kind === 'invalid');
});
test('empty catalog is honest; network failure retries the same game endpoint', async () => {
  const empty = createPublicApi(async () => response({ items: [], nextCursor: null }));
  assert.deepEqual(await empty.games('city-2'), { items: [], nextCursor: null });
  let count = 0;
  const urls: string[] = [];
  const api = createPublicApi(async url => {
    urls.push(String(url));
    if (++count === 1) throw new TypeError('offline');
    return response(game);
  });
  await assert.rejects(api.game(game.id), (error: unknown) => error instanceof PublicApiError && error.kind === 'network');
  assert.deepEqual(await api.game(game.id), game);
  assert.equal(urls[0], urls[1]);
});
test('invalid/private DTOs fail closed and missing city never requests all games', async () => {
  let count = 0;
  const api = createPublicApi(async () => { count++; return response({ ...game, visibility: 'unlisted' }); });
  await assert.rejects(api.games(' '));
  assert.equal(count, 0);
  await assert.rejects(api.game('unlisted'));
  const invalid = createPublicApi(async () => response({ ...game, availablePlaces: '3' }));
  await assert.rejects(invalid.game('bad'));
});
