import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PlayersCoordinator, PlayersError, appendPlayers, parsePlayer, parsePlayerPage, playerQuery } from '../src/players.ts';
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
test('actor/logout and known 404 clear all DTO eligibility, and late reads cannot restore it', async () => {
  const c = new PlayersCoordinator(), late = deferred<PublicPlayer>(), list = deferred<PlayerPage>();
  c.setScope('native:a:session:1', { list: async () => page(), detail: async () => late.promise });
  await c.loadList(filters); const old = c.loadDetail(player.publicPlayerId);
  c.setScope('native:b:session:2', { list: async () => list.promise, detail: async () => { throw new PlayersError('unavailable', 404); } });
  assert.equal(c.getSnapshot().list.data, null);
  const currentList = c.loadList(filters); await c.loadDetail(player.publicPlayerId);
  list.resolve(page('must-not-return')); late.resolve(player); await Promise.all([old, currentList]);
  assert.equal(c.getSnapshot().detail.data, null); assert.equal(c.getSnapshot().list.data, null);
  c.setScope(null, null); await c.loadList(filters); assert.equal(c.getSnapshot().scope, null);
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
