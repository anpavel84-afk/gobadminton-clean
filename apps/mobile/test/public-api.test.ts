import { test } from 'node:test';
import assert from 'node:assert/strict';
import { API_ORIGIN, createPublicApi, gamesResourceKey, PublicApiError } from '../src/public-api.ts';
import { LatestResource } from '../src/resource.ts';
import { appendUpcomingPage } from '../src/upcoming.ts';
import type { GamePage } from '../src/public-api.ts';
import { game, cities } from './fixtures.ts';
function response(data: unknown, status = 200) { return new Response(JSON.stringify(data), { status }); }
const fixedNow = Date.parse('2026-11-13T12:00:00Z');
test('only actual DEV public GET endpoints, encoded city/cursor/id, no cookies/auth/mutations', async () => {
  const calls: Array<{ url: string; options?: RequestInit }> = [];
  const results = [{ apiVersion: '0.43.0' }, { items: cities }, { items: [game], nextCursor: 'opaque' }, game];
  const api = createPublicApi(async (url, options) => {
    calls.push({ url: String(url), options });
    return response(results.shift());
  }, () => fixedNow);
  assert.deepEqual(await api.meta(), { apiVersion: '0.43.0' });
  assert.deepEqual(await api.cities(), cities);
  assert.equal((await api.games('city&1', 'opaque/+')).items[0]?.availablePlaces, 3);
  assert.deepEqual(await api.game('id/?'), game);
  assert.deepEqual(calls.map(call => call.url), [
    `${API_ORIGIN}/v1/meta`, `${API_ORIGIN}/v1/cities`,
    `${API_ORIGIN}/v1/games?cityId=city%261&limit=20&startsFrom=2026-11-13T12%3A00%3A00.000Z&cursor=opaque%2F%2B`,
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

test('upcoming requests advance startsFrom; delayed pages discard elapsed items but direct completed detail remains truthful', async () => {
  let now = fixedNow;
  const startsAt = new Date(fixedNow + 1000).toISOString();
  const elapsed = { ...game, startsAt };
  const upcoming = { ...game, id: 'future', startsAt: new Date(fixedNow + 60_000).toISOString() };
  const completed = { ...elapsed, status: 'completed' };
  const calls: string[] = [];
  const api = createPublicApi(async url => {
    calls.push(String(url));
    // Transport ignores the original request time and responds at the boundary.
    now = fixedNow + 1000;
    return response(calls.length === 3 ? completed : { items: [elapsed, upcoming], nextCursor: 'next/+' });
  }, () => now);
  const first = await api.games('city-1');
  assert.deepEqual(first, { items: [upcoming], nextCursor: 'next/+' });
  const second = await api.games('city-1', first.nextCursor!);
  assert.deepEqual(second.items, [upcoming]);
  const firstQuery = new URL(calls[0]!).searchParams;
  const nextQuery = new URL(calls[1]!).searchParams;
  assert.equal(firstQuery.get('startsFrom'), new Date(fixedNow).toISOString());
  assert.equal(nextQuery.get('startsFrom'), new Date(now).toISOString());
  assert.equal(nextQuery.get('cityId'), 'city-1');
  assert.equal(nextQuery.get('cursor'), 'next/+');
  assert.deepEqual(await api.game(game.id), completed);
});

test('venue public URLs use canonical scope and prove distinct older aliases once; no extra read for canonical DTOs', async () => {
  const id = '11111111-1111-4111-8111-111111111111', alias = '22222222-2222-4222-8222-222222222222', cityId = '33333333-3333-4333-8333-333333333333';
  const dto = {id,cityId,name:'Зал',address:'Адрес',timezone:game.timezone,latitude:52,longitude:13};
  const urls: string[] = [], options: RequestInit[] = [];
  let older = false;
  const api = createPublicApi(async (url,init) => {
    urls.push(String(url)); options.push(init!);
    if (String(url).includes('/games?')) return response({items:[{...game,venue:{...dto,id:older ? alias : id}}],nextCursor:'next/+'});
    return response({...dto,...(String(url).endsWith(alias) ? {resolvedFromVenueId:alias} : {})});
  },() => fixedNow);
  const controller = new AbortController(), venue = await api.venue(id,controller.signal), bindings = new Map();
  await api.venueGames(venue,new Date(fixedNow).toISOString(),undefined,controller.signal,bindings);
  assert.equal(urls.length,2);
  assert.equal(urls[1],`${API_ORIGIN}/v1/games?cityId=${cityId}&venueId=${id}&startsFrom=2026-11-13T12%3A00%3A00.000Z&limit=20`);
  older = true;
  await api.venueGames(venue,new Date(fixedNow).toISOString(),'next/+',controller.signal,bindings);
  await api.venueGames(venue,new Date(fixedNow).toISOString(),'next2',controller.signal,bindings);
  assert.equal(urls.filter(url => url.endsWith(`/venues/${alias}`)).length,1);
  for (const init of options) { assert.equal(init.credentials,'omit'); assert.equal(init.method,'GET'); assert.deepEqual(init.headers,{Accept:'application/json'}); }
});

test('unrelated venue/city/timezone schedule results fail and detail cancellation reaches public transport', async () => {
  const id = '11111111-1111-4111-8111-111111111111', wrong = '22222222-2222-4222-8222-222222222222', cityId = '33333333-3333-4333-8333-333333333333';
  const dto = {id,cityId,name:'Зал',address:'Адрес',timezone:game.timezone,latitude:52,longitude:13};
  for (const target of [{...dto,id:wrong},{...dto,cityId:wrong},{...dto,timezone:'Pacific/Auckland'}]) {
    const api = createPublicApi(async url => String(url).includes('/games?') ? response({items:[{...game,venue:target}],nextCursor:null}) : response(String(url).endsWith(wrong) ? {...dto,id:wrong} : dto),() => fixedNow);
    const venue = await api.venue(id);
    await assert.rejects(api.venueGames(venue,new Date(fixedNow).toISOString()),PublicApiError);
  }
  let signal: AbortSignal | undefined;
  const api = createPublicApi(async (_url,init) => { signal = init?.signal as AbortSignal; return response(dto); });
  const controller = new AbortController(); controller.abort(); await api.venue(id,controller.signal);
  assert.equal(signal?.aborted,true);
});

test('real games query sends catalog-city selected-day bounds and activity while legacy call remains upcoming', async () => {
  const calls: URL[] = [];
  const api = createPublicApi(async url => { calls.push(new URL(String(url))); return Response.json({ items: [], nextCursor: 'next' }); }, () => fixedNow);
  await api.games('city', undefined, undefined, { day: '2026-11-16', timezone: 'Asia/Tokyo', activityKind: 'trainer_led' });
  const query = calls[0]!.searchParams;
  assert.equal(query.get('cityId'), 'city'); assert.equal(query.get('startsFrom'), '2026-11-15T15:00:00.000Z');
  assert.equal(query.get('startsBefore'), '2026-11-16T15:00:00.000Z'); assert.equal(query.get('activityKind'), 'trainer_led');
  assert.equal(query.has('levelScaleId') || query.has('levelId'), false);
  await api.games('city', 'next', undefined, { day: '2026-11-16', timezone: 'Asia/Tokyo', activityKind: 'regular' });
  assert.equal(calls[1]!.searchParams.get('cursor'), 'next'); assert.equal(calls[1]!.searchParams.get('activityKind'), 'regular');
  await api.games('city');
  assert.equal(calls[2]!.searchParams.get('startsFrom'), new Date(fixedNow).toISOString());
  assert.equal(calls[2]!.searchParams.has('startsBefore'), false); assert.equal(calls[2]!.searchParams.has('activityKind'), false);
  for (const bad of [{ day: '2026-02-30', timezone: 'Asia/Tokyo' }, { day: '2026-11-16' }, { day: '2026-11-16', timezone: 'bad-zone' }]) await assert.rejects(api.games('city', undefined, undefined, bad), PublicApiError);
  assert.equal(calls.length, 3);
});
test('day/activity changes reset loaded cursor and fence stale A→B→A pages; populated refresh replaces', async () => {
  const resource = new LatestResource<GamePage>();
  const a = { day: '2026-11-16', timezone: 'Europe/Moscow', activityKind: 'all' } as const;
  const b = { ...a, day: '2026-11-17', activityKind: 'trainer_led' } as const;
  const keyA = gamesResourceKey('city', a), keyB = gamesResourceKey('city', b);
  assert.notEqual(keyA, keyB);
  assert.notEqual(keyA, gamesResourceKey('other-city', a));
  assert.notEqual(keyA, gamesResourceKey('city', { ...a, activityKind: 'regular' }));
  assert.notEqual(keyA, gamesResourceKey('city', { ...a, day: '2026-11-17' }));
  const page = (id: string, cursor: string | null): GamePage => ({ items: [{ ...game, id, startsAt: '2099-11-16T00:00:00Z' }], nextCursor: cursor });
  await resource.load(keyA, async () => page('a', 'old-cursor'));
  let finish!: (page: GamePage) => void;
  const late = resource.load(keyA, () => new Promise(resolve => { finish = resolve; }), appendUpcomingPage);
  const change = resource.load(keyB, async () => page('b', 'b-cursor'));
  assert.equal(resource.state.data, undefined); await change;
  await resource.load(keyA, async () => page('new-a', null));
  finish(page('stale-a', 'stale-cursor')); await late;
  const afterLate = resource.getSnapshot();
  assert.deepEqual(afterLate.data?.items.map(item => item.id), ['new-a']); assert.equal(afterLate.data?.nextCursor, null);
  await resource.load(keyA, async () => page('refreshed', 'fresh-cursor'));
  const afterRefresh = resource.getSnapshot();
  assert.deepEqual(afterRefresh.data?.items.map(item => item.id), ['refreshed']); assert.equal(afterRefresh.data?.nextCursor, 'fresh-cursor');
});
