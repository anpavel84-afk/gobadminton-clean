import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PlayersCoordinator, PlayersError, appendPlayers, parsePlayer, parsePlayerPage, playerQuery, playerFilterKey, resetPlayerFilters } from '../src/players.ts';
import type { PlayerFilters, PlayerPage, PublicPlayer } from '../src/players.ts';
import { playerMediaUrl } from '../src/media.ts';
import { playerInitials, playerLevelLabel } from '../src/presentation.ts';
import { createPublicApi } from '../src/public-api.ts';
import { createNativeApi } from '../src/native-api.ts';
import { NativeAuthError } from '../src/native-auth-protocol.ts';

const player: PublicPlayer = { publicPlayerId: 'public-a', displayName: 'Анна Иванова', cityId: 'city-a', areaKey: null,
  bio: 'Ищу партнёров', level: { scaleId: 'gb-social-pilot', scaleVersion: 1, levelId: 'intermediate', provenance: 'self_declared' },
  trainer: false, lookingForGame: true, avatar: { uploadedUrl: null, providerUrl: null }, cover: { uploadedUrl: null }, canRequestContact: true };
const filters: PlayerFilters = { cityId: null, name: '', looking: false, trainer: false };
const page = (id = 'public-a', nextCursor: string | null = null): PlayerPage => ({ items: [{ ...player, publicPlayerId: id }], nextCursor });
const deferred = <T>() => { let resolve!: (v: T) => void, reject!: (e: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

test('player projection strips private fields, validates real shape and never labels unknown scales/codes', () => {
  assert.deepEqual(parsePlayer({ ...player, email: 'private', contacts: ['private'], userId: 'private', friendship: 'friend' }), player);
  assert.throws(() => parsePlayer({ ...player, trainer: 'yes' }), PlayersError);
  assert.throws(() => parsePlayerPage({ items: [player], nextCursor: 12 }), PlayersError);
  assert.equal(playerLevelLabel(player.level), 'Средний');
  assert.equal(playerLevelLabel({ scaleId: 'unknown-secret-scale', scaleVersion: 2, levelId: 'raw-code' }), 'Уровень не указан');
  assert.equal(playerInitials(player.displayName), 'АИ');
  assert.deepEqual(parsePlayerPage({ items: [], nextCursor: null }), { items: [], nextCursor: null });
});
test('player level labels cover the full canonical NTRP v1 catalog and preserve pilot labels', () => {
  for (const levelId of ['1.0', '1.5', '2.0', '2.5', '3.0', '3.5', '4.0', '4.5', '5.0', '5.5', '6.0', '6.5', '7.0']) {
    const projected = parsePlayer({ ...player, level: { scaleId: 'ntrp', scaleVersion: 1, levelId, provenance: 'self_declared' } });
    assert.equal(playerLevelLabel(projected.level), `NTRP ${levelId}`, levelId);
    assert.equal(playerLevelLabel({ scaleId: 'other', scaleVersion: 1, levelId }), 'Уровень не указан');
    assert.equal(playerLevelLabel({ scaleId: 'ntrp', scaleVersion: 2, levelId }), 'Уровень не указан');
  }
  for (const levelId of ['', '0.5', '7.5', '8.0', '-1.0', '3.2', '3.50', ' 3.5 ', '3,5', '3.5junk', 'NaN', 'Infinity', 'beginner']) {
    assert.equal(playerLevelLabel({ scaleId: 'ntrp', scaleVersion: 1, levelId }), 'Уровень не указан', levelId);
  }
  for (const [levelId, label] of [['beginner', 'Начинающий'], ['intermediate', 'Средний'], ['advanced', 'Продвинутый']]) {
    assert.equal(playerLevelLabel({ scaleId: 'gb-social-pilot', scaleVersion: 1, levelId: levelId! }), label);
  }
  assert.equal(playerLevelLabel({ scaleId: 'gb-social-pilot', scaleVersion: 1, levelId: 'unknown' }), 'Уровень не указан');
  assert.equal(playerLevelLabel(null), 'Уровень не указан');
});
test('pilot level labels return unknown text for inherited and unrecognized IDs', () => {
  for (const levelId of ['__proto__', 'constructor', 'toString', 'anotherunknown']) {
    assert.equal(playerLevelLabel({ scaleId: 'gb-social-pilot', scaleVersion: 1, levelId }), 'Уровень не указан', levelId);
  }
});
test('media permits only existing upload/provider authorities, rejects authority tricks and preserves initials fallback', () => {
  const hash = 'a'.repeat(64);
  assert.equal(playerMediaUrl(`/v1/media/avatars/${hash}.png`, 'avatar'), `https://dev.gobadminton.ru/v1/media/avatars/${hash}.png`);
  assert.ok(playerMediaUrl(`/v1/media/covers/${hash}.png`, 'cover'));
  assert.ok(playerMediaUrl('https://avatars.yandex.net/photo', 'avatar'));
  assert.ok(playerMediaUrl('https://sun9.userapi.com/photo', 'avatar'));
  for (const url of ['https://@avatars.yandex.net/a', 'https://avatars.yandex.net.evil/a', 'https://avatars.yandex.net\\@evil/a',
    'https://avatars.yandex.net/%0a', 'https://%61vatars.yandex.net/a', '//avatars.yandex.net/a', 'file:///photo', 'https://userapi.com/a']) assert.equal(playerMediaUrl(url, 'avatar'), null);
  assert.equal(playerMediaUrl('https://avatars.yandex.net/a', 'cover'), null);
  assert.equal(playerInitials('  '), '?');
});
test('provider media rejects exact raw and decoded control ranges without rejecting safe Unicode or encoded spaces', () => {
  const base = 'https://avatars.yandex.net/';
  for (let point = 0; point <= 0x9f; point++) {
    if (point > 0x20 && point < 0x7f) continue;
    assert.equal(playerMediaUrl(`${base}a${String.fromCodePoint(point)}b`, 'avatar'), null, `raw ${point}`);
    const encoded = encodeURIComponent(String.fromCodePoint(point));
    assert.equal(playerMediaUrl(`${base}a${encoded}b`, 'avatar'), point === 0x20 ? `${base}a%20b` : null, `encoded ${point}`);
  }
  for (const suffix of ['a\\b', 'a%5Cb', 'a\ud800b', 'a\udfffb', '%ED%A0%80', '%']) {
    assert.equal(playerMediaUrl(base + suffix, 'avatar'), null);
  }
  for (const suffix of ['a!b', 'a~b', 'a\u00a0b', 'a😀b']) {
    assert.equal(playerMediaUrl(base + suffix, 'avatar'), new URL(base + suffix).href);
  }
});
test('cursor requests encode real filters without a fabricated city; append replaces duplicate projections', () => {
  const q = new URLSearchParams(playerQuery({ ...filters, name: '  Анна & И  ', trainer: true, looking: true }, 'cursor&next'));
  assert.equal(q.get('name'), 'Анна & И'); assert.equal(q.get('cursor'), 'cursor&next'); assert.equal(q.get('cityId'), null);
  assert.equal(q.get('looking'), 'true'); assert.equal(q.get('trainer'), 'true');
  const a = page('a', 'next');
  const joined = appendPlayers(a, { items: [{ ...player, publicPlayerId: 'a', canRequestContact: false }, { ...player, publicPlayerId: 'b' }], nextCursor: null });
  assert.deepEqual(joined.items.map(p => p.publicPlayerId), ['a', 'b']); assert.equal(joined.items[0]?.canRequestContact, false);
  assert.throws(() => appendPlayers(a, page('b', 'next')), PlayersError);
});
test('A→B→A request generation and pagination cursor fences reject old responses; more errors retain accepted page', async () => {
  const c = new PlayersCoordinator(), gates = Array.from({ length: 6 }, () => deferred<PlayerPage>()); let calls = 0;
  c.setScope('guest', { list: async () => gates[calls++]!.promise, detail: async () => player });
  const a1 = c.loadList(filters), b = c.loadList({ ...filters, cityId: 'b' }), a2 = c.loadList(filters);
  gates[2]!.resolve(page('current', 'next')); await a2;
  gates[0]!.resolve(page('old')); gates[1]!.resolve(page('b')); await Promise.all([a1, b]);
  assert.equal(c.getSnapshot().list.data?.items[0]?.publicPlayerId, 'current');
  await c.loadList(filters, 'wrong'); assert.equal(calls, 3);
  const more = c.loadList(filters, 'next'); gates[3]!.reject(new PlayersError('server', 503)); await more;
  assert.equal(c.getSnapshot().list.status, 'ready'); assert.ok(c.getSnapshot().list.moreError);
  assert.equal(c.getSnapshot().list.data?.nextCursor, 'next');
  const oldMore = c.loadList(filters, 'next'), fresh = c.loadList({ ...filters, trainer: true });
  gates[5]!.resolve(page('trainer')); await fresh; gates[4]!.resolve(page('late')); await oldMore;
  assert.equal(c.getSnapshot().list.data?.items[0]?.publicPlayerId, 'trainer');
});
test('actor/logout and late reads clear DTO eligibility without a global detail-404 catalog wipe', async () => {
  const c = new PlayersCoordinator(), late = deferred<PublicPlayer>(), list = deferred<PlayerPage>();
  c.setScope('native:a:session:1', { list: async () => page(), detail: async () => late.promise });
  await c.loadList(filters); const old = c.loadDetail(player.publicPlayerId);
  c.setScope('native:b:session:2', { list: async () => list.promise, detail: async () => { throw new PlayersError('unavailable', 404); } });
  assert.equal(c.getSnapshot().list.data, null);
  const currentList = c.loadList(filters); await c.loadDetail(player.publicPlayerId);
  assert.equal(c.getSnapshot().detail.status, 'error');
  assert.equal(c.getSnapshot().detail.data, null);
  list.resolve(page('actor-b-catalog')); late.resolve(player); await Promise.all([old, currentList]);
  assert.equal(c.getSnapshot().detail.data, null);
  assert.equal(c.getSnapshot().list.data?.items[0]?.publicPlayerId, 'actor-b-catalog');
  c.setScope(null, null); await c.loadList(filters); assert.equal(c.getSnapshot().scope, null);
  assert.equal(c.getSnapshot().list.data, null); assert.equal(c.getSnapshot().detail.data, null);
});

test('individual peer detail 404 keeps unrelated multi-page catalog key, rows, cursor and status', async () => {
  const c = new PlayersCoordinator();
  const filtered = { ...filters, cityId: 'city-a', name: '  Anna ', areaKey: 'north' };
  const key = playerFilterKey(filtered);
  c.setScope('guest', {
    list: async (_f, cursor) => cursor
      ? { items: [{ ...player, publicPlayerId: 'peer-c' }], nextCursor: 'cursor-2' }
      : { items: [{ ...player, publicPlayerId: 'peer-a' }, { ...player, publicPlayerId: 'peer-b' }], nextCursor: 'cursor-1' },
    detail: async id => { if (id === 'peer-a') throw new PlayersError('unavailable', 404); return { ...player, publicPlayerId: id }; },
  });
  await c.loadList(filtered);
  await c.loadList(filtered, 'cursor-1');
  assert.deepEqual(c.getSnapshot().list.data?.items.map(p => p.publicPlayerId), ['peer-a', 'peer-b', 'peer-c']);
  await c.loadDetail('peer-a');
  const snap = c.getSnapshot();
  assert.equal(snap.list.key, key);
  assert.equal(snap.list.status, 'ready');
  assert.equal(snap.list.data?.nextCursor, 'cursor-2');
  assert.deepEqual(snap.list.data?.items.map(p => p.publicPlayerId), ['peer-b', 'peer-c']);
  assert.equal(snap.detail.status, 'error');
  assert.equal(snap.detail.id, 'peer-a');
  assert.equal(snap.detail.data, null);
});

test('pre-404 pending next page cannot resurrect unavailable peer while unrelated rows survive', async () => {
  const c = new PlayersCoordinator(), more = deferred<PlayerPage>();
  let listCalls = 0;
  c.setScope('guest', {
    list: async (_f, cursor) => {
      listCalls++;
      if (!cursor) return { items: [{ ...player, publicPlayerId: 'peer-a' }, { ...player, publicPlayerId: 'peer-b' }], nextCursor: 'next' };
      return more.promise;
    },
    detail: async () => { throw new PlayersError('unavailable', 404); },
  });
  await c.loadList(filters);
  const pendingMore = c.loadList(filters, 'next');
  await c.loadDetail('peer-a');
  assert.deepEqual(c.getSnapshot().list.data?.items.map(p => p.publicPlayerId), ['peer-b']);
  assert.equal(c.getSnapshot().list.status, 'ready');
  assert.equal(c.getSnapshot().list.loadingMore, true);
  more.resolve({ items: [{ ...player, publicPlayerId: 'peer-a' }, { ...player, publicPlayerId: 'peer-c' }], nextCursor: 'later' });
  await pendingMore;
  assert.equal(listCalls, 2);
  assert.deepEqual(c.getSnapshot().list.data?.items.map(p => p.publicPlayerId), ['peer-b', 'peer-c']);
  assert.equal(c.getSnapshot().list.data?.nextCursor, 'later');
  assert.equal(c.getSnapshot().list.loadingMore, false);
});

test('fresh detail after 404 does not authorize pre-404 catalog projection; B/C retained; fresh catalog may recover', async () => {
  const c = new PlayersCoordinator(), more = deferred<PlayerPage>();
  let listCalls = 0, detailPhase = 0;
  c.setScope('guest', {
    list: async (_f, cursor) => {
      listCalls++;
      if (!cursor) {
        if (listCalls === 1) {
          return {
            items: [
              { ...player, publicPlayerId: 'peer-a', canRequestContact: true },
              { ...player, publicPlayerId: 'peer-b', canRequestContact: true },
            ],
            nextCursor: 'next',
          };
        }
        return {
          items: [{ ...player, publicPlayerId: 'peer-a', canRequestContact: false }, { ...player, publicPlayerId: 'peer-b' }],
          nextCursor: null,
        };
      }
      return more.promise;
    },
    detail: async id => {
      detailPhase++;
      if (detailPhase === 1) throw new PlayersError('unavailable', 404);
      return { ...player, publicPlayerId: id, canRequestContact: false };
    },
  });
  await c.loadList(filters);
  const pendingMore = c.loadList(filters, 'next');
  await c.loadDetail('peer-a');
  assert.deepEqual(c.getSnapshot().list.data?.items.map(p => p.publicPlayerId), ['peer-b']);
  await c.loadDetail('peer-a');
  assert.equal(c.getSnapshot().detail.status, 'ready');
  assert.equal(c.getSnapshot().detail.data?.canRequestContact, false);
  more.resolve({ items: [{ ...player, publicPlayerId: 'peer-a', canRequestContact: true }, { ...player, publicPlayerId: 'peer-c' }], nextCursor: 'later' });
  await pendingMore;
  const afterPending = c.getSnapshot().list.data?.items ?? [];
  assert.deepEqual(afterPending.map(p => p.publicPlayerId), ['peer-b', 'peer-c']);
  assert.equal(afterPending.find(p => p.publicPlayerId === 'peer-a'), undefined);
  assert.equal(c.getSnapshot().detail.data?.canRequestContact, false);
  assert.equal(c.getSnapshot().list.data?.nextCursor, 'later');
  await c.loadList(filters);
  const recovered = c.getSnapshot().list.data?.items ?? [];
  assert.deepEqual(recovered.map(p => p.publicPlayerId), ['peer-a', 'peer-b']);
  assert.equal(recovered.find(p => p.publicPlayerId === 'peer-a')?.canRequestContact, false);
});

test('A404 then fresh page then B404 recovers updatedA and excludes staleB without conflating peer cutoffs', async () => {
  const c = new PlayersCoordinator(), fresh = deferred<PlayerPage>();
  let listCalls = 0;
  const key = playerFilterKey(filters);
  c.setScope('guest', {
    list: async () => {
      listCalls++;
      if (listCalls === 1) {
        return {
          items: [
            { ...player, publicPlayerId: 'peer-a', canRequestContact: true },
            { ...player, publicPlayerId: 'peer-b', canRequestContact: true },
            { ...player, publicPlayerId: 'peer-c' },
          ],
          nextCursor: 'cursor-initial',
        };
      }
      return fresh.promise;
    },
    detail: async _id => { throw new PlayersError('unavailable', 404); },
  });
  await c.loadList(filters);
  assert.deepEqual(c.getSnapshot().list.data?.items.map(p => p.publicPlayerId), ['peer-a', 'peer-b', 'peer-c']);
  await c.loadDetail('peer-a');
  assert.deepEqual(c.getSnapshot().list.data?.items.map(p => p.publicPlayerId), ['peer-b', 'peer-c']);
  const pendingFresh = c.loadList(filters);
  await c.loadDetail('peer-b');
  assert.equal(c.getSnapshot().list.status, 'loading');
  assert.equal(c.getSnapshot().list.key, key);
  fresh.resolve({
    items: [
      { ...player, publicPlayerId: 'peer-a', canRequestContact: false },
      { ...player, publicPlayerId: 'peer-b', canRequestContact: true },
      { ...player, publicPlayerId: 'peer-c' },
      { ...player, publicPlayerId: 'peer-d' },
    ],
    nextCursor: 'cursor-fresh',
  });
  await pendingFresh;
  const rows = c.getSnapshot().list.data?.items ?? [];
  assert.deepEqual(rows.map(p => p.publicPlayerId), ['peer-a', 'peer-c', 'peer-d']);
  assert.equal(rows.find(p => p.publicPlayerId === 'peer-a')?.canRequestContact, false);
  assert.equal(rows.find(p => p.publicPlayerId === 'peer-b'), undefined);
  assert.equal(c.getSnapshot().list.key, key);
  assert.equal(c.getSnapshot().list.data?.nextCursor, 'cursor-fresh');
  assert.equal(c.getSnapshot().list.status, 'ready');
  assert.equal(c.getSnapshot().list.loadingMore, false);
  assert.equal(c.getSnapshot().list.error, null);
});

test('multi-peer pre-404 pages keep unrelated rows; late 404 and actor success stay fenced after fresh detail', async () => {
  const c = new PlayersCoordinator(), more = deferred<PlayerPage>(), late404 = deferred<PublicPlayer>();
  let detailCalls = 0;
  c.setScope('native:a:session:1', {
    list: async (_f, cursor) => {
      if (!cursor) {
        return {
          items: [
            { ...player, publicPlayerId: 'peer-a', canRequestContact: true },
            { ...player, publicPlayerId: 'peer-b' },
            { ...player, publicPlayerId: 'peer-d', canRequestContact: true },
          ],
          nextCursor: 'next',
        };
      }
      return more.promise;
    },
    detail: async id => {
      detailCalls++;
      if (id === 'peer-a' && detailCalls === 1) throw new PlayersError('unavailable', 404);
      if (id === 'peer-a') return { ...player, publicPlayerId: 'peer-a', canRequestContact: false };
      if (id === 'peer-d') return late404.promise;
      return { ...player, publicPlayerId: id };
    },
  });
  await c.loadList(filters);
  const pendingMore = c.loadList(filters, 'next');
  await c.loadDetail('peer-a');
  const stale = c.loadDetail('peer-d');
  await c.loadDetail('peer-a');
  assert.equal(c.getSnapshot().detail.data?.canRequestContact, false);
  more.resolve({
    items: [
      { ...player, publicPlayerId: 'peer-a', canRequestContact: true },
      { ...player, publicPlayerId: 'peer-c' },
      { ...player, publicPlayerId: 'peer-d', canRequestContact: true },
    ],
    nextCursor: null,
  });
  await pendingMore;
  assert.deepEqual(c.getSnapshot().list.data?.items.map(p => p.publicPlayerId), ['peer-b', 'peer-d', 'peer-c']);
  assert.equal(c.getSnapshot().list.data?.items.find(p => p.publicPlayerId === 'peer-a'), undefined);
  late404.reject(new PlayersError('unavailable', 404)); await stale;
  assert.equal(c.getSnapshot().detail.id, 'peer-a');
  assert.equal(c.getSnapshot().detail.data?.canRequestContact, false);
  assert.deepEqual(c.getSnapshot().list.data?.items.map(p => p.publicPlayerId), ['peer-b', 'peer-d', 'peer-c']);
  await c.loadDetail('peer-d');
  assert.equal(c.getSnapshot().detail.status, 'error');
  assert.deepEqual(c.getSnapshot().list.data?.items.map(p => p.publicPlayerId), ['peer-b', 'peer-c']);
  c.setScope('native:b:session:2', {
    list: async () => ({ items: [{ ...player, publicPlayerId: 'actor-b-only' }], nextCursor: null }),
    detail: async () => ({ ...player, publicPlayerId: 'actor-b-only', canRequestContact: true }),
  });
  await c.loadList(filters);
  await c.loadDetail('actor-b-only');
  assert.equal(c.getSnapshot().list.data?.items[0]?.publicPlayerId, 'actor-b-only');
  assert.equal(c.getSnapshot().detail.data?.canRequestContact, true);
});

test('peer 404 leaves newer filter refresh, detail target and actor rotation unaffected; detail 503 leaves catalog', async () => {
  const c = new PlayersCoordinator();
  const first = deferred<PlayerPage>(), second = deferred<PlayerPage>(), late404 = deferred<PublicPlayer>();
  const looking = { ...filters, looking: true };
  c.setScope('native:a:session:1', {
    list: async f => f.looking ? second.promise : first.promise,
    detail: async id => {
      if (id === 'peer-a') return late404.promise;
      if (id === 'peer-dead') throw new PlayersError('unavailable', 404);
      if (id === 'peer-503') throw new PlayersError('server', 503);
      return { ...player, publicPlayerId: id };
    },
  });
  const loadA = c.loadList(filters);
  first.resolve({
    items: [
      { ...player, publicPlayerId: 'peer-a' },
      { ...player, publicPlayerId: 'peer-b' },
      { ...player, publicPlayerId: 'peer-dead' },
    ],
    nextCursor: null,
  });
  await loadA;
  await c.loadDetail('peer-dead');
  assert.deepEqual(c.getSnapshot().list.data?.items.map(p => p.publicPlayerId), ['peer-a', 'peer-b']);
  assert.equal(c.getSnapshot().detail.id, 'peer-dead');
  assert.equal(c.getSnapshot().detail.status, 'error');
  const stale = c.loadDetail('peer-a');
  await c.loadDetail('peer-b');
  assert.equal(c.getSnapshot().detail.id, 'peer-b');
  assert.equal(c.getSnapshot().detail.data?.publicPlayerId, 'peer-b');
  late404.reject(new PlayersError('unavailable', 404)); await stale;
  assert.equal(c.getSnapshot().detail.id, 'peer-b');
  assert.equal(c.getSnapshot().detail.data?.publicPlayerId, 'peer-b');
  assert.deepEqual(c.getSnapshot().list.data?.items.map(p => p.publicPlayerId), ['peer-a', 'peer-b']);
  const refresh = c.loadList(looking);
  second.resolve({ items: [{ ...player, publicPlayerId: 'peer-x' }], nextCursor: null });
  await refresh;
  assert.deepEqual(c.getSnapshot().list.data?.items.map(p => p.publicPlayerId), ['peer-x']);
  assert.equal(c.getSnapshot().list.key, playerFilterKey(looking));
  await c.loadDetail('peer-503');
  assert.equal(c.getSnapshot().detail.status, 'error');
  assert.ok(c.getSnapshot().detail.error instanceof PlayersError && (c.getSnapshot().detail.error as PlayersError).status === 503);
  assert.deepEqual(c.getSnapshot().list.data?.items.map(p => p.publicPlayerId), ['peer-x']);
  c.setScope('native:b:session:2', {
    list: async () => ({ items: [{ ...player, publicPlayerId: 'actor-b-only' }], nextCursor: null }),
    detail: async () => { throw new PlayersError('unavailable', 404); },
  });
  assert.equal(c.getSnapshot().list.data, null);
  assert.equal(c.getSnapshot().detail.data, null);
  await c.loadList(filters);
  assert.equal(c.getSnapshot().list.data?.items[0]?.publicPlayerId, 'actor-b-only');
});

test('safetyReread 404 isolates detail error without peer catalog invalidation; list-endpoint 404 still clears catalog', async () => {
  const c = new PlayersCoordinator();
  c.setScope('guest', {
    list: async () => ({ items: [{ ...player, publicPlayerId: 'peer-safe' }, { ...player, publicPlayerId: 'peer-keep' }], nextCursor: 'cursor-safe' }),
    detail: async () => { throw new PlayersError('unavailable', 404); },
  });
  await c.loadList(filters);
  await c.loadDetail('peer-safe', true);
  assert.equal(c.getSnapshot().detail.status, 'error');
  assert.equal(c.getSnapshot().detail.data, null);
  assert.equal(c.getSnapshot().list.status, 'ready');
  assert.equal(c.getSnapshot().list.key, playerFilterKey(filters));
  assert.equal(c.getSnapshot().list.data?.nextCursor, 'cursor-safe');
  assert.deepEqual(c.getSnapshot().list.data?.items.map(p => p.publicPlayerId), ['peer-safe', 'peer-keep']);
  c.setScope('native:list404:session:1', {
    list: async () => { throw new PlayersError('unavailable', 404); },
    detail: async () => player,
  });
  await c.loadList(filters);
  assert.equal(c.getSnapshot().list.status, 'error');
  assert.equal(c.getSnapshot().list.data, null);
  assert.equal(c.getSnapshot().detail.status, 'error');
  assert.equal(c.getSnapshot().detail.data, null);
});
test('guest transport is credential-free; closed native reads send only bearer and never retry anonymous on errors', async () => {
  const calls: RequestInit[] = [];
  const guest = createPublicApi(async (_url, init) => { calls.push(init!); return Response.json(page()); });
  await guest.players(filters); assert.equal(calls[0]?.credentials, 'omit'); assert.equal(new Headers(calls[0]?.headers).get('Authorization'), null);
  let count = 0;
  const native = createNativeApi(async (_url, init) => { count++; assert.equal(init?.credentials, 'omit'); assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer test'); return new Response('{}', { status: 401 }); });
  await assert.rejects(native.players('test', filters), NativeAuthError); assert.equal(count, 1);
  for (const status of [404, 503]) {
    const api = createNativeApi(async () => new Response('{}', { status }));
    await assert.rejects(api.player('test', player.publicPlayerId), (error: unknown) => error instanceof PlayersError && error.status === status && error.kind === (status === 404 ? 'unavailable' : 'server'));
  }
});

test('initial 503 is an error with no data; explicit successful retry alone establishes true empty', async () => {
  const c = new PlayersCoordinator(); let fail = true;
  c.setScope('guest', { list: async () => {
    if (fail) throw new PlayersError('server', 503);
    return { items: [], nextCursor: null };
  }, detail: async () => player });
  await c.loadList(filters);
  assert.equal(c.getSnapshot().list.status, 'error'); assert.equal(c.getSnapshot().list.data, null);
  assert.equal(c.getSnapshot().list.moreError, null);
  fail = false; await c.loadList(filters);
  assert.equal(c.getSnapshot().list.status, 'ready');
  assert.deepEqual(c.getSnapshot().list.data, { items: [], nextCursor: null });
});

test('area query reaches public and native ports; default remains compatible and explicit reset clears filters', async () => {
  const chosen = { ...filters, cityId: 'city', name: ' Анна ', areaKey: ' метро & район ', trainer: true, looking: true };
  const calls: URL[] = [];
  const fetcher: typeof fetch = async url => { calls.push(new URL(String(url))); return Response.json(page()); };
  await createPublicApi(fetcher).players(chosen);
  await createNativeApi(fetcher).players('access', chosen);
  for (const url of calls) { assert.equal(url.searchParams.get('areaKey'), 'метро & район'); assert.equal(url.searchParams.get('name'), 'Анна'); }
  assert.equal(playerFilterKey(filters), playerFilterKey({ ...filters, areaKey: '' }));
  assert.equal(new URLSearchParams(playerQuery(filters)).has('areaKey'), false);
  assert.deepEqual(resetPlayerFilters(), { cityId: null, name: '', areaKey: '', looking: false, trainer: false });
  assert.equal(new URLSearchParams(playerQuery(resetPlayerFilters())).size, 1);
});
test('area changes fence cursor reuse and late responses across area/reset/auth generations', async () => {
  const c = new PlayersCoordinator(), pending = deferred<PlayerPage>();
  const calls: { filters: PlayerFilters; cursor?: string }[] = [];
  c.setScope('guest', { list: async (f, cursor) => { calls.push({ filters: f, cursor }); return f.areaKey === 'old' && cursor ? pending.promise : page(f.areaKey || 'all', 'next'); }, detail: async () => player });
  const old = { ...filters, areaKey: 'old' }, changed = { ...filters, areaKey: 'new' };
  await c.loadList(old);
  await c.loadList(changed, 'next'); assert.equal(calls.length, 1);
  const late = c.loadList(old, 'next');
  await c.loadList(changed); assert.equal(calls[2]?.cursor, undefined);
  await c.loadList(resetPlayerFilters());
  c.setScope('native:new-actor:session:2', { list: async () => page('new-actor'), detail: async () => player });
  await c.loadList(changed);
  pending.resolve(page('old-area-guest')); await late;
  assert.equal(c.getSnapshot().scope, 'native:new-actor:session:2');
  assert.equal(c.getSnapshot().list.data?.items[0]?.publicPlayerId, 'new-actor');
});
