import { RadarCoordinator } from '../src/radar-coordinator.ts';
import { PlayInterestCoordinator } from '../src/play-interest-coordinator.ts';
import type { PlayInterestPacket } from '../src/play-interests.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';
import { headerAvatarPresentation } from '../src/header-avatar.ts';
import { playerInitials } from '../src/presentation.ts';
import { AuthCoordinator } from '../src/auth-coordinator.ts';
import { gameCoverMutationSucceeded } from '../src/game-cover.ts';
import { createNativeApi } from '../src/native-api.ts';
import { PublicApiError, publicApi } from '../src/public-api.ts';
import { game as fixture } from './fixtures.ts';
import { NATIVE_CLIENT_ID, NATIVE_REDIRECT, SECURE_AUTH_KEY, NativeAuthError, base64Url, canonicalGamePath, canonicalPlayerPath, canonicalReturnPath, canonicalVenueCreatePath,
  parseCallback, parseNativeMe, parsePublicRoleLocalGoal, parseSecureEnvelope, publicRoleGoalPath } from '../src/native-auth-protocol.ts';
import type { PendingLogin, PublicRoleLocalGoal, SecureEnvelope } from '../src/native-auth-protocol.ts';

const now = Date.parse('2026-11-14T00:00:00Z');
const token = (s: string) => s.repeat(43);
const me = { id: 'actor-a', displayName: 'Игрок', locale: 'ru', linkedProviders: ['vk'],
  session: { id: 'session-a', audience: 'consumer_native', transport: 'bearer' } };
const credentials = { accessToken: token('a'), refreshToken: token('b'), tokenType: 'Bearer', expiresIn: 600,
  refreshExpiresAt: new Date(now + 604800_000).toISOString(), refreshAbsoluteExpiresAt: new Date(now + 2592000_000).toISOString(), sessionId: 'session-a' };
const pending: PendingLogin = { generation: token('g'), clientId: NATIVE_CLIENT_ID, redirectUri: NATIVE_REDIRECT,
  verifier: token('v'), state: token('s'), transactionId: token('t'), expiresAt: now + 600000, returnPath: '/games/same-game' };
const envelope: SecureEnvelope = { version: 1, generation: token('g'), returnPath: '/games/same-game', pending };
const callback = `${NATIVE_REDIRECT}?code=${token('c')}&state=${token('s')}`;
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
function setup(initial: unknown = null, options?: { openExternalUrl?: (url: string) => Promise<void> }) {
  let stored = initial === null ? null : JSON.stringify(initial), serial = 0;
  const calls: { path: string; init: RequestInit }[] = [];
  let handler = async (path: string, _init: RequestInit): Promise<unknown> => {
    if (path === '/auth/methods') return { items: [{ method: 'vk', type: 'oauth', available: true }] };
    if (path === '/auth/native/transactions') return { transactionId: token('t'), expiresAt: new Date(now + 600000).toISOString(), browserStartUrl: `https://dev.gobadminton.ru/auth/native?transactionId=${token('t')}` };
    if (path === '/me') return me;
    if (path === '/me/sessions') return { items: [{ id: 'session-a', current: true, createdAt: new Date(now).toISOString(), lastSeenAt: new Date(now).toISOString(), expiresAt: credentials.refreshExpiresAt }] };
    if (path === '/auth/native/logout') return { ok: true };
    return credentials;
  };
  const store = { getItem: async (key: string) => { assert.equal(key, SECURE_AUTH_KEY); return stored; },
    setItem: async (key: string, value: string) => { assert.equal(key, SECURE_AUTH_KEY); stored = value; } };
  const api = createNativeApi(async (url, init) => {
    const path = String(url).replace('https://dev.gobadminton.ru/v1', '');
    calls.push({ path, init: init! });
    const value = await handler(path, init!);
    return value instanceof Response ? value : new Response(JSON.stringify(value));
  });
  const auth = new AuthCoordinator({ api, store, random: () => String.fromCharCode(65 + serial++).repeat(43),
    challenge: async verifier => createHash('sha256').update(verifier).digest('base64url'), now: () => now,
    openExternalUrl: options?.openExternalUrl });
  return { auth, store, calls, api, stored: () => stored, setHandler: (value: typeof handler) => { handler = value; } };
}
const sessionEnvelope = () => ({ version: 1, generation: token('g'), returnPath: '/games/same-game', session: {
  refreshToken: credentials.refreshToken, sessionId: me.session.id, actorId: me.id,
  refreshExpiresAt: credentials.refreshExpiresAt, refreshAbsoluteExpiresAt: credentials.refreshAbsoluteExpiresAt } });

test('PKCE S256 RFC vector, exact HTTPS callback, unique fields, expiry and generation', () => {
  const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  assert.equal(base64Url(createHash('sha256').update(verifier).digest()), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  assert.equal(parseCallback(callback, pending, now, token('g')), token('c'));
  for (const value of [callback + '&state=x', callback + '&code=x', callback + '&other=x', callback + '#x',
    callback.replace('https:', 'gobadminton-dev:'), callback.replace('.ru/', '.ru.evil/'), callback.replace('.ru/', '.ru:443/'),
    callback.replace('/auth/native/', '/auth/../auth/native/'), callback.replace(token('s'), token('w'))]) {
    assert.throws(() => parseCallback(value, pending, now, token('g')), NativeAuthError);
  }
  assert.throws(() => parseCallback(callback, pending, pending.expiresAt, token('g')));
  assert.throws(() => parseCallback(callback, pending, now, token('z')));
});
test('wire NativeMe accepts actual fields, rejects cookie identity, strips invented fields', () => {
  assert.deepEqual(parseNativeMe({ ...me, email: 'not-a-contract', photo: 'bad', csrfToken: 'bad' }), me);
  assert.throws(() => parseNativeMe({ ...me, session: undefined }));
  assert.throws(() => parseNativeMe({ ...me, session: { ...me.session, transport: 'cookie' } }));
});
test('versioned secure storage survives pending restart, rejects unknown version without destructive migration', async () => {
  assert.deepEqual(parseSecureEnvelope(JSON.stringify(envelope), now), envelope);
  assert.equal(parseSecureEnvelope(JSON.stringify(envelope), now + 600000)?.pending, undefined);
  const future = { ...envelope, version: 2 }, s = setup(future);
  await s.auth.hydrate(); assert.equal(s.auth.getSnapshot().notice, 'storage');
  assert.equal(await s.auth.beginLogin('/games/other'), null);
  assert.equal(s.stored(), JSON.stringify(future)); assert.equal(s.calls.length, 0);
});
test('duplicate browser/Linking callbacks exchange once, consume durable pending before call and return same game with no mutation', async () => {
  const s = setup(envelope), gate = deferred<unknown>();
  s.setHandler(async path => {
    if (path === '/auth/native/exchange') { assert.equal(JSON.parse(s.stored()!).pending, undefined); return gate.promise; }
    return me;
  });
  await s.auth.hydrate();
  const a = s.auth.callback(callback), b = s.auth.callback(callback);
  await new Promise(resolve => setImmediate(resolve)); gate.resolve(credentials);
  assert.deepEqual(await Promise.all([a, b]), ['/games/same-game', '/games/same-game']);
  assert.deepEqual(s.calls.map(call => call.path), ['/auth/native/exchange', '/me']);
  assert.equal(await s.auth.callback(callback), null);
  const secure = JSON.parse(s.stored()!); assert.equal(secure.pending, undefined); assert.equal(secure.accessToken, undefined);
  assert.equal(secure.session.actorId, me.id); assert.equal(s.auth.getSnapshot().status, 'authenticated');
});
test('refresh is singleflight and durably consumed before dispatch; ambiguous response never replays after restart', async () => {
  const s = setup(sessionEnvelope()), gate = deferred<unknown>();
  s.setHandler(async path => { if (path === '/auth/native/refresh') { assert.equal(JSON.parse(s.stored()!).session, undefined); return gate.promise; } return me; });
  const boot = s.auth.hydrate(); await new Promise(resolve => setImmediate(resolve));
  const a = s.auth.refresh(), b = s.auth.refresh(); gate.resolve(credentials); await Promise.all([boot, a, b]);
  assert.equal(s.calls.filter(c => c.path === '/auth/native/refresh').length, 1);
  const lost = setup(sessionEnvelope()); lost.setHandler(async () => { throw new Error('sensitive URL must not escape'); });
  await lost.auth.hydrate(); await lost.auth.refresh();
  assert.equal(lost.calls.length, 1); assert.equal(lost.auth.getSnapshot().me, null); assert.equal(lost.auth.getSnapshot().status, 'unverifiable');
  assert.equal(parseSecureEnvelope(lost.stored(), now)?.session, undefined);
  const restart = setup(JSON.parse(lost.stored()!)); await restart.auth.hydrate(); assert.equal(restart.calls.length, 0);
});
test('logout fences late refresh, callback and private session reads, keeping no private identity or cache', async () => {
  for (const phase of ['refresh', 'exchange', 'sessions'] as const) {
    const s = setup(phase === 'exchange' ? envelope : sessionEnvelope()), gate = deferred<unknown>();
    if (phase === 'sessions') await s.auth.hydrate();
    s.setHandler(async path => {
      if (path === `/auth/native/${phase}` || (phase === 'sessions' && path === '/me/sessions')) return gate.promise;
      return path === '/me' ? me : { ok: true };
    });
    const work = phase === 'refresh' ? s.auth.hydrate() : phase === 'exchange' ? s.auth.callback(callback) : s.auth.loadSessions();
    await new Promise(resolve => setImmediate(resolve)); await s.auth.logout();
    gate.resolve(phase === 'sessions' ? { items: [] } : credentials); await work;
    assert.equal(s.auth.getSnapshot().me, null, phase); assert.deepEqual(s.auth.getSnapshot().sessions, [], phase);
    assert.equal(s.auth.getSnapshot().status, 'guest', phase); assert.equal(JSON.parse(s.stored()!).session, undefined, phase);
  }
});
test('secure write failure blocks exchange, rotated commit failure and actor mismatch fail closed', async () => {
  const s = setup(envelope); await s.auth.hydrate(); s.store.setItem = async () => { throw new Error('device locked'); };
  assert.equal(await s.auth.callback(callback), null); assert.equal(s.calls.length, 0); assert.equal(s.auth.getSnapshot().notice, 'storage');
  const mismatch = setup(sessionEnvelope()); mismatch.setHandler(async path => path === '/me' ? { ...me, id: 'other-actor' } : credentials);
  await mismatch.auth.hydrate(); assert.equal(mismatch.auth.getSnapshot().me, null); assert.equal(JSON.parse(mismatch.stored()!).session, undefined);
  const commit = setup(envelope); let writes = 0;
  const save = commit.store.setItem; commit.store.setItem = async (key, value) => { if (++writes === 2) throw new Error('commit failed'); await save(key, value); };
  await commit.auth.callback(callback); assert.equal(commit.auth.getSnapshot().me, null);
});
test('same-game safe intent survives default-off/unavailable start and cancel; methods remain truthful', async () => {
  const s = setup(); s.setHandler(async path => path === '/auth/methods'
    ? { items: [{ method: 'vk', type: 'oauth', available: false }] } : new Response('{}', { status: 503 }));
  assert.equal(await s.auth.beginLogin('/games/same-game'), null);
  assert.equal(s.auth.getSnapshot().notice, 'unavailable'); assert.equal(s.auth.getSnapshot().returnPath, '/games/same-game');
  assert.deepEqual(s.calls.map(c => c.path), ['/auth/methods']);
  const disabled = setup(); disabled.setHandler(async path => path === '/auth/methods'
    ? { items: [{ method: 'email', type: 'email_code', available: true }] } : new Response('{}', { status: 503 }));
  assert.equal(await disabled.auth.beginLogin('/games/same-game'), null); assert.equal(disabled.auth.getSnapshot().notice, 'unavailable');
  assert.equal(JSON.parse(disabled.stored()!).returnPath, '/games/same-game');
  for (const intent of ['/games/x?join=1', '//evil/games/x', '/games/../profile', '/games/x/messages', '/games/%2fx', '/profile']) assert.equal(canonicalGamePath(intent), null);
  const cancel = setup(envelope); await cancel.auth.hydrate(); await cancel.auth.cancelLogin(); assert.equal(cancel.auth.getSnapshot().returnPath, '/games/same-game');
  assert.equal(await cancel.auth.callback(callback), null); assert.equal(cancel.calls.length, 0);
});
test('cancelled login restores usable guest Players list and detail without establishing credentials', async t => {
  const filters = { cityId: null, name: '', looking: false, trainer: false };
  const player = { publicPlayerId: 'public-guest', displayName: 'Гость', cityId: null, areaKey: null,
    level: null, bio: null, trainer: false, lookingForGame: false };
  const list = t.mock.method(publicApi, 'players', async () => ({ items: [player], nextCursor: null }));
  const detail = t.mock.method(publicApi, 'player', async () => player);
  const s = setup();
  assert.equal(s.auth.players.getSnapshot().scope, null);
  await s.auth.hydrate();
  assert.equal(s.auth.players.getSnapshot().scope, 'guest');
  const login = await s.auth.beginLogin('/games/same-game'); assert.ok(login);
  const saved = parseSecureEnvelope(s.stored(), now)!;
  assert.equal(s.auth.getSnapshot().status, 'signing-in'); assert.equal(s.auth.players.getSnapshot().scope, null);
  await s.auth.cancelLogin(login.generation);
  assert.equal(s.auth.getSnapshot().status, 'guest'); assert.equal(s.auth.getSnapshot().notice, 'cancelled');
  assert.equal(s.auth.getSnapshot().returnPath, '/games/same-game');
  assert.equal(s.auth.getSnapshot().me, null); assert.deepEqual(s.auth.getSnapshot().sessions, []);
  assert.equal(s.auth.participation.getSnapshot().actor, null);
  assert.equal(s.auth.players.getSnapshot().scope, 'guest');
  await s.auth.players.loadList(filters); await s.auth.players.loadDetail(player.publicPlayerId);
  assert.equal(s.auth.players.getSnapshot().list.status, 'ready');
  assert.deepEqual(s.auth.players.getSnapshot().list.data, { items: [player], nextCursor: null });
  assert.equal(s.auth.players.getSnapshot().detail.status, 'ready');
  assert.deepEqual(s.auth.players.getSnapshot().detail.data, player);
  assert.equal(list.mock.callCount(), 1); assert.equal(detail.mock.callCount(), 1);
  assert.equal(await s.auth.callback(`${NATIVE_REDIRECT}?code=${token('c')}&state=${saved.pending!.state}`), null);
  assert.deepEqual(s.calls.map(call => call.path), ['/auth/methods', '/auth/native/transactions']);
  const secure = parseSecureEnvelope(s.stored(), now)!;
  assert.equal(secure.pending, undefined); assert.equal(secure.session, undefined);
});
test('session authority loss clears identity and sessions; safe API never adds cookie/Origin or calls browser commands', async () => {
  const s = setup(sessionEnvelope()); await s.auth.hydrate(); await s.auth.loadSessions(); assert.equal(s.auth.getSnapshot().sessions.length, 1);
  s.setHandler(async () => new Response('{}', { status: 403 })); await s.auth.validate();
  assert.equal(s.auth.getSnapshot().me, null); assert.deepEqual(s.auth.getSnapshot().sessions, []);
  for (const { path, init } of s.calls) {
    assert.equal(init.credentials, 'omit'); assert.equal(init.redirect, 'error');
    const headers = init.headers as Record<string, string>;
    assert.equal(headers.Origin, undefined); assert.equal(headers.Cookie, undefined); assert.equal(headers['X-Native-Auth'], undefined);
    assert.doesNotMatch(path, /\/bind|\/complete|\/cancel|participations|games/);
  }
});

test('logout queues a durable clear after an already dispatched secure commit; account switch rejects old callback', async () => {
  const s = setup(envelope), write = deferred<void>(), entered = deferred<void>();
  const save = s.store.setItem; let count = 0;
  s.store.setItem = async (key, value) => { if (++count === 2) { entered.resolve(); await write.promise; } await save(key, value); };
  const callbackWork = s.auth.callback(callback); await entered.promise;
  const logout = s.auth.logout(); write.resolve(); await Promise.all([callbackWork, logout]);
  assert.equal(s.auth.getSnapshot().me, null); assert.equal(JSON.parse(s.stored()!).session, undefined);
  const switcher = setup(envelope); await switcher.auth.hydrate();
  const start = await switcher.auth.beginLogin('/games/another-game'); assert.ok(start);
  assert.equal(await switcher.auth.callback(callback), null);
  assert.equal(switcher.calls.filter(call => call.path === '/auth/native/exchange').length, 0);
  assert.equal(switcher.auth.getSnapshot().returnPath, '/games/another-game');
});

test('generated pending uses S256 and survives restart; lost exchange response cannot replay or expose credentials', async () => {
  const start = setup(); await Promise.all([start.auth.beginLogin('/games/same-game'), start.auth.beginLogin('/games/same-game')]);
  assert.equal(start.calls.filter(call => call.path === '/auth/native/transactions').length, 1);
  const saved = parseSecureEnvelope(start.stored(), now)!;
  const request = JSON.parse(start.calls.find(call => call.path === '/auth/native/transactions')!.init.body as string);
  assert.equal(request.codeChallengeMethod, 'S256'); assert.equal(request.codeChallenge, createHash('sha256').update(saved.pending!.verifier).digest('base64url'));
  assert.equal(request.clientId, NATIVE_CLIENT_ID); assert.equal(request.redirectUri, NATIVE_REDIRECT);
  const resumed = setup(saved); await resumed.auth.hydrate();
  assert.equal(resumed.auth.getSnapshot().status, 'signing-in');
  const valid = `${NATIVE_REDIRECT}?code=${token('c')}&state=${saved.pending!.state}`;
  resumed.setHandler(async () => { throw new Error('lost response contains private credentials'); });
  assert.equal(await resumed.auth.callback(valid), null); assert.equal(await resumed.auth.callback(valid), null);
  assert.equal(resumed.calls.length, 1); assert.equal(JSON.parse(resumed.stored()!).pending, undefined);
  assert.equal(resumed.auth.getSnapshot().me, null);
  assert.doesNotMatch(JSON.stringify(resumed.auth.getSnapshot()), /accessToken|refreshToken|verifier|lost response/);
});

test('private detail fallback stays inside auth core; revoked bearer and late logout response clear all private resources', async t => {
  t.mock.method(publicApi, 'game', async () => { throw new PublicApiError('unavailable', 404); });
  const game = { ...fixture, version: 7, status: 'draft', visibility: 'unlisted' };
  const s = setup(sessionEnvelope()); let revoked = false, gate: ReturnType<typeof deferred<unknown>> | null = null;
  s.setHandler(async path => {
    if (path === '/auth/native/refresh') return credentials;
    if (path === '/me') return me;
    if (path.startsWith('/me/participations')) return { items: [], nextCursor: null };
    if (path.startsWith('/me/games')) return { items: [{ ...game, management: { role: 'owner', createdByMe: true } }], nextCursor: null };
    if (path === `/games/${game.id}`) return gate ? gate.promise : revoked ? new Response('{}', { status: 401 }) : game;
    return { ok: true };
  });
  await s.auth.hydrate(); await s.auth.participation.loadManaged(); await s.auth.participation.loadDetail(game.id);
  assert.equal(s.auth.participation.getSnapshot().games[game.id]?.game?.status, 'draft');
  assert.equal(s.auth.participation.getSnapshot().details[game.id]?.game?.visibility, 'unlisted');
  const call = s.calls.find(call => call.path === `/games/${game.id}`)!;
  assert.deepEqual(call.init.headers, { Accept: 'application/json', Authorization: `Bearer ${credentials.accessToken}` });
  assert.doesNotMatch(JSON.stringify(s.auth.getSnapshot()), /accessToken|refreshToken|management/);
  revoked = true; await s.auth.participation.loadGame(game.id);
  assert.equal(s.auth.getSnapshot().status, 'guest'); assert.equal(s.auth.participation.getSnapshot().actor, null);
  assert.deepEqual(s.auth.participation.getSnapshot().games, {}); assert.deepEqual(s.auth.participation.getSnapshot().details, {});
  assert.deepEqual(s.auth.participation.getSnapshot().managed.items, []);
  // A second genuine session exercises logout while a private response is still in flight.
  const other = setup(sessionEnvelope()); gate = deferred();
  other.setHandler(async path => path === '/auth/native/refresh' ? credentials : path === '/me' ? me
    : path === `/games/${game.id}` ? gate!.promise : { items: [], nextCursor: null });
  await other.auth.hydrate(); const work = other.auth.participation.loadGame(game.id);
  await new Promise(resolve => setImmediate(resolve)); await other.auth.logout(); gate.resolve(game); await work;
  assert.deepEqual(other.auth.participation.getSnapshot().games, {});
  assert.deepEqual(other.auth.participation.getSnapshot().details, {}); assert.equal(other.auth.getSnapshot().me, null);
});

test('native player read stays within auth token boundary and logout fences late actor projection', async () => {
  const s = setup(sessionEnvelope()); await s.auth.hydrate();
  const gate = deferred<unknown>();
  s.setHandler(async (path, init) => {
    if (path.startsWith('/players?')) {
      assert.equal(new Headers(init.headers).get('Authorization'), `Bearer ${credentials.accessToken}`);
      return gate.promise;
    }
    return { ok: true };
  });
  const work = s.auth.players.loadList({ cityId: null, name: '', looking: false, trainer: false });
  await new Promise(resolve => setImmediate(resolve));
  await s.auth.logout();
  gate.resolve({ items: [{ publicPlayerId: 'public-old', displayName: 'Old actor', cityId: null, areaKey: null, level: null, bio: null, trainer: false, lookingForGame: false, canRequestContact: true }], nextCursor: null });
  await work;
  assert.equal(s.auth.players.getSnapshot().scope, 'guest'); assert.equal(s.auth.players.getSnapshot().list.data, null);
});
test('revoked player authority clears actor data without anonymous transport fallback', async () => {
  const s = setup(sessionEnvelope()); await s.auth.hydrate();
  s.setHandler(async path => path.startsWith('/players?') ? new Response('{}', { status: 401 }) : { ok: true });
  const before = s.calls.length;
  await s.auth.players.loadList({ cityId: null, name: '', looking: false, trainer: false });
  assert.equal(s.calls.length, before + 1); assert.equal(s.auth.getSnapshot().me, null);
  assert.equal(s.auth.players.getSnapshot().scope, null); assert.equal(s.auth.players.getSnapshot().list.data, null);
});

test('Messages private identity/UNKNOWN survives token refresh and cannot affect participation packets or cross logout', async () => {
  const s = setup(sessionEnvelope()); await s.auth.hydrate();
  const participation = s.auth.participation;
  s.setHandler(async path => {
    if (path === '/me') return me;
    if (path === '/me/social-profile') return { publicPlayerId: 'public-a', email: 'discard' };
    if (path === '/conversations/thread') return { id: 'thread',kind:'direct',requestState:'accepted',version:1,peer:{publicPlayerId:'public-b',displayName:'Peer'},role:'recipient',lastMessageSeq:'0',readThroughSeq:'0',unreadCount:0 };
    if (path.startsWith('/conversations/thread/messages?')) return { items:[],nextCursor:null };
    if (path === '/conversations/thread/messages') throw new Error('ambiguous transport');
    return credentials;
  });
  const r = { kind:'direct',id:'thread' } as const;
  s.auth.messages.focus(r); await new Promise(resolve => setImmediate(resolve)); s.auth.messages.draft(r,'private'); await s.auth.messages.act(r,'send');
  const packet=s.auth.messages.getSnapshot().pending['direct:thread']?.packet; assert.ok(packet);
  await s.auth.refresh(); assert.strictEqual(s.auth.participation,participation); assert.strictEqual(s.auth.messages.getSnapshot().pending['direct:thread']?.packet,packet);
  const before=s.calls.filter(c => c.path === '/conversations/thread/messages').length;
  await s.auth.logout(); await s.auth.messages.retry(r);
  assert.equal(s.calls.filter(c => c.path === '/conversations/thread/messages').length,before);
  assert.equal(s.auth.messages.getSnapshot().detail,null); assert.deepEqual(s.auth.messages.getSnapshot().pending,{});
});

test('private Messages return whitelist is exact and storage compatible; rejects actions/query/encoded tricks', () => {
  for (const path of ['/messages','/messages/direct/abc-1','/messages/game/abc_2','/messages/invitations/abc3','/games/same-game']) {
    assert.equal(canonicalReturnPath(path),path);
    assert.equal(parseSecureEnvelope(JSON.stringify({ ...envelope,returnPath:path,pending:{ ...pending,returnPath:path } }),now)?.returnPath,path);
  }
  for (const path of ['/messages?conversation=x','/messages/direct/a/accept','/messages/direct/%61','/messages/direct/a?send=yes','https://evil/messages','/messages//a','/messages/game/a#x','/messages/game/../a']) assert.equal(canonicalReturnPath(path),null);
});

test('selected new-contact return uses actual begin/callback and secure pending restart, waiting for verified identity and never sending', async () => {
  const path = '/messages/new/peer_A-1';
  for (const restart of [false, true]) {
    const start = setup(); assert.ok(await start.auth.beginLogin(path));
    const saved = parseSecureEnvelope(start.stored(), now)!;
    assert.equal(saved.returnPath, path); assert.equal(saved.pending!.returnPath, path);
    const request = start.calls.find(c => c.path === '/auth/native/transactions')!;
    assert.equal(JSON.parse(request.init.body as string).returnPath, path);
    const active = restart ? setup(saved) : start;
    await active.auth.hydrate(); assert.equal(active.auth.getSnapshot().status, 'signing-in');
    const verified = deferred<typeof me>();
    active.setHandler(async p => p === '/me' ? verified.promise : credentials);
    let completed = false;
    const callbackUrl = `${NATIVE_REDIRECT}?code=${token('c')}&state=${saved.pending!.state}`;
    const work = active.auth.callback(callbackUrl).then(value => { completed = true; return value; });
    await new Promise(r => setImmediate(r));
    assert.equal(completed, false); assert.equal(active.auth.getSnapshot().me, null);
    assert.equal(active.auth.contact.getSnapshot().actor, null);
    verified.resolve(me); assert.equal(await work, path);
    assert.equal(active.auth.getSnapshot().status, 'authenticated');
    assert.equal(active.auth.contact.getSnapshot().actor?.actorId, me.id);
    assert.equal(await active.auth.callback(callbackUrl), null);
    assert.equal(parseSecureEnvelope(active.stored(), now)?.returnPath, path);
    assert.equal(parseSecureEnvelope(active.stored(), now)?.pending, undefined);
    assert.equal(active.auth.contact.getSnapshot().command, undefined);
    for (const call of [...start.calls, ...(restart ? active.calls : [])]) {
      assert.ok(['/auth/methods', '/auth/native/transactions', '/auth/native/exchange', '/me'].includes(call.path));
    }
  }
});

test('new-contact intent admits only the exact local typed peer path, retaining old return forms and rejecting URL tricks in storage', () => {
  for (const path of ['/messages/new/peer', '/messages/new/peer_A-1', '/games/create', '/games/manage/abc-1']) {
    assert.equal(canonicalReturnPath(path), path);
    assert.equal(parseSecureEnvelope(JSON.stringify({ ...envelope, returnPath: path, pending: { ...pending, returnPath: path } }), now)?.pending?.returnPath, path);
  }
  for (const path of ['/messages/new', '/messages/new/', '/messages/new/a/send', '/messages/new/a?send=1',
    '/messages/new/a#draft', '/messages/new/%61', '/messages/new/%2Fa', '/messages/new/%252e%252e',
    '/messages/new/../a', '/messages/new/..', '/messages/new/a\\b', '/messages/new/a\nb', '/messages/new/a\n', '/messages/new/a\r\n',
    '/messages/new/a\u0000', '/messages/new/а', '/messages/new/' + 'a'.repeat(129),
    '//dev.gobadminton.ru/messages/new/a', 'https://dev.gobadminton.ru/messages/new/a',
    'https://evil.test/messages/new/a', 'gobadminton-dev:///messages/new/a',
    '/messages/other/a', '/messages/new//a', '/messages/direct/a\\b', '/messages/game/%61',
    '/messages/invitations/a?accept=1', '/games/%61', '/games/a#x', '/games/a?join=1']) {
    assert.equal(canonicalReturnPath(path), null, path);
    assert.throws(() => parseSecureEnvelope(JSON.stringify({ ...envelope, returnPath: path, pending: { ...pending, returnPath: path } }), now), NativeAuthError);
  }
});

test('new root management owner shares secure actor fences, leaves Messages UNKNOWN untouched, never dispatches on callback', async t => {
  const s=setup({...envelope,returnPath:'/games/create',pending:{...pending,returnPath:'/games/create'}});
  assert.equal(await s.auth.callback(callback),'/games/create');
  assert.equal(s.calls.filter(c=>c.path==='/games').length,0);
  t.mock.method(publicApi,'venues',async()=>({items:[fixture.venue],nextCursor:null}));
  t.mock.method(publicApi,'cities',async()=>[{id:'city-1',nameRu:'Казань',nameEn:'Kazan',countryCode:'RU',defaultTimezone:'Europe/Moscow'}]);
  const social = {publicPlayerId:'public-a',version:1,cityId:'city-1',trainer:false,displayName:'Creator',areaKey:null,level:null,bio:null,
    directoryVisible:false,contactPolicy:'closed',consentPolicyVersion:null,optedInAt:null,radarConsented:false,
    radarConsentPolicyVersion:null,radarConsentedAt:null,socialEligible:false,lookingForGame:null};
  const owner=s.auth.gameManagement, participation=s.auth.participation;
  s.setHandler(async (path,init)=>{
    if(path==='/me')return me;
    if(path==='/auth/native/refresh')return credentials;
    if(path==='/me/social-profile')return init.method === 'PATCH' ? {...social,...JSON.parse(init.body as string),version:2} : social;
    if(path==='/me/game-preferences')return {version:0,defaultPublicGameContact:null};
    if(path==='/conversations/thread')return {id:'thread',kind:'direct',requestState:'accepted',version:1,peer:{publicPlayerId:'public-b',displayName:'Peer'},role:'recipient',lastMessageSeq:'0',readThroughSeq:'0',unreadCount:0};
    if(path.startsWith('/conversations/thread/messages?'))return {items:[],nextCursor:null};
    if(path==='/conversations/thread/messages'||path==='/games')throw new Error('ambiguous');
    return {ok:true};
  });
  const resource={kind:'direct',id:'thread'} as const;
  s.auth.messages.focus(resource); await new Promise(resolve=>setImmediate(resolve)); s.auth.messages.draft(resource,'private'); await s.auth.messages.act(resource,'send');
  const message=s.auth.messages.getSnapshot().pending['direct:thread']?.packet; assert.ok(message);
  await owner.loadContext('city-1'); owner.update({venueId:fixture.venue.id,date:'2026-11-20',time:'18:30',contact:'@creator'}); owner.preview();
  owner.bindCreationView(); await owner.publishPreview();
  const packet=owner.getSnapshot().command?.packet; assert.ok(packet); assert.equal(owner.getSnapshot().command?.status,'unknown');
  assert.equal(s.auth.messages.getSnapshot().pending['direct:thread']?.packet,message);
  const participationBefore = participation.getSnapshot();
  await s.auth.profile.load(); s.auth.profile.update({displayName:'Публичное имя'}); await s.auth.profile.save();
  assert.equal(s.auth.profile.getSnapshot().profile?.version,2);
  assert.strictEqual(owner.getSnapshot().command?.packet,packet);
  assert.strictEqual(s.auth.messages.getSnapshot().pending['direct:thread']?.packet,message);
  assert.strictEqual(participation.getSnapshot(),participationBefore);
  await s.auth.refresh(); assert.strictEqual(s.auth.gameManagement,owner); assert.strictEqual(s.auth.participation,participation);
  assert.strictEqual(owner.getSnapshot().command?.packet,packet); assert.strictEqual(s.auth.messages.getSnapshot().pending['direct:thread']?.packet,message);
  assert.equal(s.calls.filter(c=>c.path==='/games').length,1);
  assert.doesNotMatch(JSON.stringify(owner.getSnapshot()),/accessToken|refreshToken|verifier/);
  await s.auth.logout(); assert.equal(owner.getSnapshot().command,undefined); assert.equal(owner.getSnapshot().form.contact,'');
});

test('involuntary auth loss preserves UNKNOWN create until authoritative same-owner callback; explicit logout clears it', async t => {
  const s = setup(sessionEnvelope()); await s.auth.hydrate();
  t.mock.method(publicApi,'venues',async () => ({items:[fixture.venue],nextCursor:null}));
  const owner = s.auth.gameManagement, verified = deferred<unknown>();
  let phase: 'unknown' | 'lost' | 'return' | 'reconcile' = 'unknown';
  s.setHandler(async path => {
    if (path === '/me') return phase === 'return' ? verified.promise : me;
    if (path === '/me/social-profile') return {cityId:'city-1',trainer:false,displayName:'Creator'};
    if (path === '/me/game-preferences') return {version:0,defaultPublicGameContact:null};
    if (path === '/games') {
      if (phase !== 'reconcile') throw new Error('UNKNOWN create');
      return {...fixture,status:'draft',version:7};
    }
    if (path.endsWith('/publish')) throw new Error('UNKNOWN publish');
    if (path === '/auth/native/refresh' && phase === 'lost') throw new Error('lost session');
    if (path === '/auth/methods') return {items:[{method:'vk',type:'oauth',available:true}]};
    if (path === '/auth/native/transactions') return {transactionId:token('t'),expiresAt:new Date(now+600000).toISOString(),browserStartUrl:`https://dev.gobadminton.ru/auth/native?transactionId=${token('t')}`};
    if (path === '/auth/native/exchange') return {...credentials,sessionId:'new-session'};
    return {ok:true};
  });
  await owner.loadContext('city-1'); owner.update({venueId:fixture.venue.id,date:'2026-11-20',time:'18:30',contact:'@private-creator'});
  owner.preview(); owner.bindCreationView(); await owner.publishPreview();
  const original = owner.getSnapshot().command!.packet;
  assert.equal(owner.getSnapshot().command?.status,'unknown');
  phase = 'lost'; await s.auth.refresh();
  assert.equal(s.auth.getSnapshot().status,'unverifiable'); assert.equal(owner.getSnapshot().command,undefined);
  assert.equal(owner.getSnapshot().form.contact,''); assert.equal(owner.getSnapshot().preview,null);
  await owner.reconcile(); assert.equal(s.calls.filter(c => c.path === '/games').length,1);
  await s.auth.beginLogin('/games/create');
  const login = JSON.parse(s.stored()!).pending as PendingLogin;
  phase = 'return';
  const work = s.auth.callback(`${NATIVE_REDIRECT}?code=${token('c')}&state=${login.state}`);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(owner.getSnapshot().actor,null); assert.equal(owner.getSnapshot().command,undefined);
  verified.resolve({...me,session:{...me.session,id:'new-session'}});
  assert.equal(await work,'/games/create');
  const restored = owner.getSnapshot().command!;
  assert.equal(restored.status,'unknown'); assert.equal(restored.packet.key,original.key); assert.strictEqual(restored.packet.body,original.body);
  assert.equal(restored.packet.actor.sessionId,'new-session'); assert.notEqual(restored.packet.actor.generation,original.actor.generation);
  assert.equal(s.calls.filter(c => c.path === '/games').length,1);
  phase = 'reconcile'; await owner.reconcile();
  const creates = s.calls.filter(c => c.path === '/games');
  assert.equal(creates.length,2); assert.equal(creates[1]!.init.body,creates[0]!.init.body);
  assert.equal((creates[1]!.init.headers as Record<string,string>)['Idempotency-Key'],original.key);
  assert.equal(s.calls.filter(c => c.path.endsWith('/publish')).length,0);
  assert.equal(owner.getSnapshot().created?.status,'draft');
  // Explicit logout must also erase an active UNKNOWN, not merely its visible reference.
  // Session rotate cleared the create-view lease; rebind before user create/publish intent.
  owner.bindCreationView();
  phase = 'unknown'; await owner.publishDraft(fixture.id); assert.equal(owner.getSnapshot().command?.status,'unknown');
  await s.auth.logout(); assert.equal(owner.getSnapshot().command,undefined); assert.equal(owner.getSnapshot().creationReference,null);
  assert.equal(owner.getSnapshot().actor,null); assert.equal(owner.getSnapshot().form.contact,'');
  await s.auth.beginLogin('/games/create');
  const next = JSON.parse(s.stored()!).pending as PendingLogin;
  phase = 'return'; await s.auth.callback(`${NATIVE_REDIRECT}?code=${token('d')}&state=${next.state}`);
  assert.equal(owner.getSnapshot().command,undefined); assert.equal(owner.getSnapshot().creationReference,null);
});

test('root profile owner never copies email-looking auth name; UNKNOWN reauth restores same actor only and explicit logout wipes it', async t => {
  t.mock.method(publicApi,'cities',async () => [{id:'city',nameRu:'Казань',nameEn:'Kazan',countryCode:'RU',defaultTimezone:'Europe/Moscow'}]);
  const dto = {publicPlayerId:null,version:0,displayName:'',cityId:null,areaKey:null,level:null,bio:null,directoryVisible:false,
    contactPolicy:'closed',consentPolicyVersion:null,optedInAt:null,radarConsented:false,radarConsentPolicyVersion:null,
    radarConsentedAt:null,socialEligible:false,trainer:false,lookingForGame:null};
  const s = setup(sessionEnvelope()); let lost = false;
  s.setHandler(async (path,init) => {
    if (path === '/me') return {...me,displayName:'private@example.test'};
    if (path === '/me/social-profile') {
      if (init.method === 'PATCH') { lost = true; throw new Error('lost private request'); }
      return dto;
    }
    return path === '/auth/native/logout' ? {ok:true} : credentials;
  });
  const emptyFive = {displayName:'',cityId:'',areaKey:'',bio:'',levelChoice:{kind:'none' as const}};
  await s.auth.hydrate(); await s.auth.profile.load();
  assert.deepEqual(s.auth.profile.getSnapshot().draft,emptyFive);
  assert.deepEqual(Object.keys(s.auth.profile.getSnapshot().draft).sort(),['areaKey','bio','cityId','displayName','levelChoice']);
  assert.doesNotMatch(JSON.stringify(s.auth.profile.getSnapshot()),/private@example/);
  s.auth.profile.update({displayName:'Публичное имя',cityId:'city',areaKey:'sokol',bio:'О себе частное',levelChoice:{kind:'ntrp',levelId:'3.5'}});
  await s.auth.profile.save(); assert.equal(lost,true);
  const packet = s.auth.profile.getSnapshot().command!.packet;
  if (packet.kind !== 'profile') throw new Error('expected profile packet');
  assert.equal(packet.body.areaKey,'sokol'); assert.equal(packet.body.bio,'О себе частное');
  assert.deepEqual(packet.body.level,{scaleId:'ntrp',scaleVersion:1,levelId:'3.5',provenance:'self_declared'});
  // Loss of verified identity quarantines private state. Starting reauth is not explicit logout.
  s.setHandler(async () => { throw new NativeAuthError('network'); }); await s.auth.validate();
  assert.equal(s.auth.profile.getSnapshot().actor,null); assert.equal(s.auth.profile.getSnapshot().command,undefined);
  assert.deepEqual(s.auth.profile.getSnapshot().draft,emptyFive);
  const start = await (async () => {
    s.setHandler(async path => path === '/auth/methods' ? {items:[{method:'vk',type:'oauth',available:true}]}
      : {transactionId:token('t'),expiresAt:new Date(now+600000).toISOString(),browserStartUrl:`https://dev.gobadminton.ru/auth/native?transactionId=${token('t')}`});
    return s.auth.beginLogin('/games/create');
  })(); assert.ok(start);
  const saved = parseSecureEnvelope(s.stored(),now)!;
  s.setHandler(async path => path === '/me' ? {...me,session:{...me.session,id:'profile-returned-session'}} : {...credentials,sessionId:'profile-returned-session'});
  await s.auth.callback(`${NATIVE_REDIRECT}?code=${token('c')}&state=${saved.pending!.state}`);
  assert.equal(s.auth.profile.getSnapshot().command?.status,'unknown');
  assert.strictEqual(s.auth.profile.getSnapshot().command?.packet,packet);
  assert.equal(s.calls.filter(c => c.init.method === 'PATCH').length,1);
  s.setHandler(async () => ({...dto,version:1,displayName:packet.body.displayName,cityId:packet.body.cityId,
    areaKey:packet.body.areaKey,bio:packet.body.bio,level:packet.body.level}));
  await s.auth.profile.reconcile();
  const sent = s.calls.filter(c => c.init.method === 'PATCH');
  assert.equal(sent.length,2); assert.equal(sent[0]?.init.body,sent[1]?.init.body);
  assert.equal((sent[1]?.init.headers as Record<string,string>)['Idempotency-Key'],packet.key);
  assert.equal(s.auth.profile.getSnapshot().actor?.sessionId,'profile-returned-session');
  assert.equal(s.auth.profile.getSnapshot().profile?.version,1);
  // A subsequent independent UNKNOWN is erased by explicit logout; private draft fields clear.
  await s.auth.profile.load();
  s.auth.profile.update({displayName:'Следующее имя',areaKey:'метро',bio:'второе',levelChoice:{kind:'pilot',levelId:'beginner'}});
  s.setHandler(async () => { throw new Error('unknown again'); }); await s.auth.profile.save();
  assert.equal(s.auth.profile.getSnapshot().command?.status,'unknown');
  assert.equal(s.auth.profile.getSnapshot().command?.packet.kind,'profile');
  const pendingPacket = s.auth.profile.getSnapshot().command?.packet;
  assert.equal(pendingPacket?.kind === 'profile' ? pendingPacket.body.areaKey : undefined,'метро');
  await s.auth.logout(); assert.equal(s.auth.profile.getSnapshot().command,undefined); assert.equal(s.auth.profile.getSnapshot().profile,null);
  assert.deepEqual(s.auth.profile.getSnapshot().draft,emptyFive);
});

test('root unsent contact draft survives unverifiable reauth only after authoritative same-owner new-session callback; logout erases quarantine', async () => {
  const s = setup(sessionEnvelope()), path = '/messages/new/peer';
  const player = { publicPlayerId: 'peer', displayName: 'Игрок', cityId: null, areaKey: null, bio: null, level: null,
    trainer: false, lookingForGame: false, canRequestContact: true };
  const contact = { targetPublicPlayerId: 'peer', state: 'none', canRequestContact: true };
  const reads = async (p: string) => p === '/me' ? me : p.startsWith('/players/') ? player : p.startsWith('/me/contact-state?') ? contact : credentials;
  s.setHandler(reads); await s.auth.hydrate(); await s.auth.contact.open('peer'); s.auth.contact.draft('peer', 'Привет');
  const previous = s.auth.contact.getSnapshot().actor!;
  assert.equal(s.auth.contact.getSnapshot().command, undefined);
  s.setHandler(async () => { throw new NativeAuthError('network'); }); await s.auth.validate();
  assert.equal(s.auth.getSnapshot().status, 'unverifiable');
  assert.equal(s.auth.contact.getSnapshot().target, null); assert.deepEqual(s.auth.contact.getSnapshot().drafts, {});
  const loginResponses = async (p: string) => p === '/auth/methods' ? { items: [{ method: 'vk', type: 'oauth', available: true }] }
    : { transactionId: token('t'), expiresAt: new Date(now + 600000).toISOString(), browserStartUrl: `https://dev.gobadminton.ru/auth/native?transactionId=${token('t')}` };
  s.setHandler(loginResponses);
  assert.ok(await s.auth.beginLogin(path));
  const login = parseSecureEnvelope(s.stored(), now)!.pending!, verified = deferred<typeof me>();
  assert.deepEqual(s.auth.contact.getSnapshot().drafts, {});
  s.setHandler(async p => p === '/me' ? verified.promise : { ...credentials, sessionId: 'returned-A' });
  const work = s.auth.callback(`${NATIVE_REDIRECT}?code=${token('c')}&state=${login.state}`);
  await new Promise(r => setImmediate(r));
  assert.equal(s.auth.contact.getSnapshot().actor, null); assert.deepEqual(s.auth.contact.getSnapshot().drafts, {});
  verified.resolve({ ...me, session: { ...me.session, id: 'returned-A' } }); assert.equal(await work, path);
  const restored = s.auth.contact.getSnapshot();
  assert.equal(restored.actor?.actorId, previous.actorId); assert.equal(restored.actor?.sessionId, 'returned-A');
  assert.notEqual(restored.actor?.generation, previous.generation);
  assert.equal(restored.target, 'peer'); assert.equal(restored.drafts.peer, 'Привет'); assert.equal(restored.command, undefined);
  s.setHandler(reads); await s.auth.contact.open('peer'); s.auth.contact.draft('peer', 'Продолжение');
  assert.equal(s.auth.contact.getSnapshot().drafts.peer, 'Продолжение');
  assert.equal(s.calls.filter(c => c.path === '/conversations/requests').length, 0);
  s.setHandler(async () => { throw new NativeAuthError('network'); }); await s.auth.validate();
  await s.auth.logout();
  assert.deepEqual(s.auth.contact.getSnapshot().drafts, {});
  // A subsequent verified same-owner login cannot recover explicitly forgotten private state.
  s.setHandler(loginResponses); assert.ok(await s.auth.beginLogin(path));
  const next = parseSecureEnvelope(s.stored(), now)!.pending!;
  s.setHandler(reads); assert.equal(await s.auth.callback(`${NATIVE_REDIRECT}?code=${token('d')}&state=${next.state}`), path);
  assert.equal(s.auth.contact.getSnapshot().actor?.actorId, me.id);
  assert.deepEqual(s.auth.contact.getSnapshot().drafts, {}); assert.equal(s.auth.contact.getSnapshot().target, null);
  assert.equal(s.calls.filter(c => c.path === '/conversations/requests').length, 0);
});

test('root contact UNKNOWN stays hidden until authoritative same-actor reauth; callbacks never send and account B/logout erase private packets', async () => {
  const s = setup(sessionEnvelope());
  const player = {publicPlayerId:'peer',displayName:'Игрок',cityId:null,areaKey:null,bio:null,level:null,trainer:false,lookingForGame:false,canRequestContact:true};
  const state = {targetPublicPlayerId:'peer',state:'none',canRequestContact:true};
  const conversation = {id:'contact-thread',kind:'direct',requestState:'accepted',version:1,peer:{publicPlayerId:'peer',displayName:'Игрок'},
    role:'initiator',lastMessageSeq:'1',readThroughSeq:'0',unreadCount:0};
  const receipt = {messageId:'first-message',conversationId:conversation.id,seq:'1',createdAt:'2026-11-14T12:00:00.000Z',outcome:'duplicate'};
  s.setHandler(async path => path === '/me' ? me : path.startsWith('/players/') ? player : path.startsWith('/me/contact-state?') ? state
    : path === '/conversations/requests' ? new Response(JSON.stringify({code:'PRIVATE_TEXT_CONTENT_REJECTED'}),{status:503}) : credentials);
  await s.auth.hydrate(); await s.auth.contact.open('peer'); s.auth.contact.draft('peer','  Привет  '); await s.auth.contact.send();
  const packet = s.auth.contact.getSnapshot().command!.packet;
  assert.equal(s.auth.contact.getSnapshot().command?.status,'unknown');
  s.setHandler(async () => { throw new NativeAuthError('network'); }); await s.auth.validate();
  assert.equal(s.auth.contact.getSnapshot().actor,null); assert.equal(s.auth.contact.getSnapshot().command,undefined);
  assert.deepEqual(s.auth.contact.getSnapshot().drafts,{});
  s.setHandler(async path => path === '/auth/methods' ? {items:[{method:'vk',type:'oauth',available:true}]}
    : {transactionId:token('t'),expiresAt:new Date(now+600000).toISOString(),browserStartUrl:`https://dev.gobadminton.ru/auth/native?transactionId=${token('t')}`});
  await s.auth.beginLogin('/messages'); const login = parseSecureEnvelope(s.stored(),now)!.pending!;
  const verified = deferred<typeof me>();
  s.setHandler(async path => path === '/me' ? verified.promise : {...credentials,sessionId:'contact-return'});
  const work = s.auth.callback(`${NATIVE_REDIRECT}?code=${token('c')}&state=${login.state}`);
  await new Promise(r => setImmediate(r)); assert.equal(s.auth.contact.getSnapshot().command,undefined);
  verified.resolve({...me,session:{...me.session,id:'contact-return'}}); await work;
  assert.strictEqual(s.auth.contact.getSnapshot().command!.packet,packet);
  assert.equal(s.calls.filter(c => c.path === '/conversations/requests').length,1);
  s.setHandler(async path => path.startsWith('/players/') ? player : path.startsWith('/me/contact-state?') ? state : {conversation,receipt});
  await s.auth.contact.open('peer'); await s.auth.contact.reconcile();
  const writes=s.calls.filter(c => c.path === '/conversations/requests'); assert.equal(writes.length,2);
  assert.equal(writes[0]!.init.body,writes[1]!.init.body);
  assert.equal((writes[1]!.init.headers as Record<string,string>)['Idempotency-Key'],packet.key);
  assert.equal(s.auth.contact.getSnapshot().conversation?.id,conversation.id);
  await s.auth.contact.open('peer'); s.auth.contact.draft('peer','Следующее');
  s.setHandler(async path => { if(path === '/conversations/requests') throw Error('lost response'); return path.startsWith('/players/') ? player : state; });
  await s.auth.contact.send(); assert.equal(s.auth.contact.getSnapshot().command?.status,'unknown');
  // Refresh /me detects a changed principal and follows the existing account containment path.
  s.setHandler(async path => path === '/me' ? {...me,id:'actor-b'} : credentials); await s.auth.validate();
  assert.equal(s.auth.contact.getSnapshot().actor,null); assert.equal(s.auth.contact.getSnapshot().command,undefined);
  await s.auth.logout(); assert.deepEqual(s.auth.contact.getSnapshot().drafts,{});
});

test('root validation and verified login resume the same focused safety form without sending; account B and explicit logout erase it', async () => {
  const s = setup(sessionEnvelope()); await s.auth.hydrate(); const safety = s.auth.safety;
  const context = {peerId:'peer',name:'Игрок'}, originalActor = safety.getSnapshot().actor!;
  // Keep the same screen mounted: NativeSafety's useFocusEffect cleans up and opens on auth.status changes.
  let status = s.auth.getSnapshot().status, cleanup: (() => void) | undefined;
  const focus = () => {
    cleanup?.(); cleanup = undefined;
    if (s.auth.getSnapshot().status !== 'authenticated') return;
    safety.open(context); const view = safety.getSnapshot().viewGeneration;
    cleanup = () => safety.blur(view);
  };
  focus();
  const unsubscribe = s.auth.subscribe(() => {
    const next = s.auth.getSnapshot().status;
    if (next !== status) { status = next; focus(); }
  });
  try {
    const old = safety.getSnapshot().viewGeneration;
    safety.choose('player',old,originalActor); safety.edit('spam','Synthetic unsent report draft',old,originalActor);
    const loseAuthority = async () => {
      s.setHandler(async () => { throw new NativeAuthError('network'); }); await s.auth.validate();
      assert.equal(s.auth.getSnapshot().status,'unverifiable'); assert.equal(safety.getSnapshot().actor,null);
      assert.equal(safety.getSnapshot().context,null); assert.equal(safety.getSnapshot().detail,''); assert.equal(safety.getSnapshot().dialog,null);
    };
    const login = async (id: string, sessionId: string) => {
      s.setHandler(async path => path === '/auth/methods' ? {items:[{method:'vk',type:'oauth',available:true}]}
        : {transactionId:token('t'),expiresAt:new Date(now+600000).toISOString(),browserStartUrl:`https://dev.gobadminton.ru/auth/native?transactionId=${token('t')}`});
      assert.ok(await s.auth.beginLogin('/players/peer'));
      const pending = parseSecureEnvelope(s.stored(),now)!.pending!, verified = deferred<typeof me>();
      s.setHandler(async path => path === '/me' ? verified.promise : {...credentials,sessionId});
      const work = s.auth.callback(`${NATIVE_REDIRECT}?code=${token('c')}&state=${pending.state}`);
      await new Promise(r => setImmediate(r));
      assert.equal(safety.getSnapshot().actor,null); assert.equal(safety.getSnapshot().detail,'');
      verified.resolve({...me,id,session:{...me.session,id:sessionId}}); await work;
      assert.equal(s.auth.getSnapshot().status,'authenticated'); assert.equal(safety.getSnapshot().actor?.actorId,id);
    };
    await loseAuthority(); await login(me.id,'safety-resumed');
    const resumed = safety.getSnapshot(), current = resumed.actor!;
    assert.equal(current.sessionId,'safety-resumed'); assert.notEqual(current.generation,originalActor.generation);
    assert.notEqual(resumed.viewGeneration,old); assert.deepEqual(resumed.context,context);
    assert.equal(resumed.detail,'Synthetic unsent report draft'); assert.equal(resumed.reason,'spam'); assert.equal(resumed.dialog,'player');
    assert.equal(resumed.selected,null); assert.equal(resumed.consent,false); assert.equal(resumed.command,undefined);
    safety.edit('other','stale',old,originalActor); safety.cancel(old,originalActor);
    await safety.submit([],old,originalActor); await safety.reconcile(old,originalActor);
    assert.equal(safety.getSnapshot().detail,'Synthetic unsent report draft');
    safety.edit('spam','Resumed typing',resumed.viewGeneration,current);
    assert.equal(safety.getSnapshot().detail,'Resumed typing');
    await loseAuthority(); await login('actor-b','safety-B');
    assert.equal(safety.getSnapshot().detail,''); assert.equal(safety.getSnapshot().reason,'harassment'); assert.equal(safety.getSnapshot().dialog,null);
    const b = safety.getSnapshot(); safety.choose('player',b.viewGeneration,b.actor); safety.edit('other','B private draft',b.viewGeneration,b.actor);
    await loseAuthority(); await s.auth.logout(); await login('actor-b','safety-B-after-logout');
    assert.equal(safety.getSnapshot().detail,''); assert.equal(safety.getSnapshot().reason,'harassment'); assert.equal(safety.getSnapshot().dialog,null);
    assert.equal(safety.getSnapshot().selected,null); assert.equal(safety.getSnapshot().consent,false); assert.equal(safety.getSnapshot().command,undefined);
    assert.equal(s.calls.filter(c => c.path === '/reports' || c.path.startsWith('/me/blocks/')).length,0);
  } finally { unsubscribe(); cleanup?.(); }
});

test('root safety UNKNOWN is hidden until verified same-owner reauth, then reconciles the original frozen packet; logout erases late work', async () => {
  const s = setup(sessionEnvelope()); await s.auth.hydrate(); const safety = s.auth.safety;
  const context = {peerId:'peer',name:'Игрок'}, originalActor = safety.getSnapshot().actor!;
  safety.open(context); let v = safety.getSnapshot().viewGeneration; safety.choose('player',v,originalActor); safety.edit('other','Private draft',v,originalActor);
  s.setHandler(async () => { throw new Error('uncertain network'); }); await safety.submit([],v,originalActor);
  const packet = safety.getSnapshot().command!.packet;
  s.setHandler(async () => { throw new NativeAuthError('network'); }); await s.auth.validate();
  assert.equal(safety.getSnapshot().command,undefined); assert.equal(safety.getSnapshot().detail,''); assert.equal(safety.getSnapshot().actor,null);
  s.setHandler(async path => path === '/auth/methods' ? {items:[{method:'vk',type:'oauth',available:true}]}
    : {transactionId:token('t'),expiresAt:new Date(now+600000).toISOString(),browserStartUrl:`https://dev.gobadminton.ru/auth/native?transactionId=${token('t')}`});
  await s.auth.beginLogin('/players/peer'); const login = parseSecureEnvelope(s.stored(),now)!.pending!, verified = deferred<typeof me>();
  s.setHandler(async path => path === '/me' ? verified.promise : {...credentials,sessionId:'safety-return'});
  const work = s.auth.callback(`${NATIVE_REDIRECT}?code=${token('c')}&state=${login.state}`); await new Promise(r => setImmediate(r));
  assert.equal(safety.getSnapshot().command,undefined); verified.resolve({...me,session:{...me.session,id:'safety-return'}}); await work;
  assert.strictEqual(safety.getSnapshot().command?.packet,packet); assert.equal(safety.getSnapshot().consent,false);
  assert.equal(packet.actor.sessionId,originalActor.sessionId); assert.equal(s.calls.filter(c => c.path === '/reports').length,1);
  s.setHandler(async () => ({reportId:'ec05b131-750e-4b91-a1a1-425373c3fba0',status:'submitted',createdAt:'2026-11-14T00:00:00Z'}));
  safety.open(context); v=safety.getSnapshot().viewGeneration; await safety.reconcile(v,safety.getSnapshot().actor);
  const writes=s.calls.filter(c => c.path === '/reports'); assert.equal(writes.length,2); assert.equal(writes[0]!.init.body,writes[1]!.init.body);
  assert.equal((writes[1]!.init.headers as Record<string,string>)['Idempotency-Key'],packet.key);
  const gate=deferred<unknown>(); s.setHandler(async path => path.startsWith('/me/blocks/') ? gate.promise : {ok:true});
  safety.choose('block',v,safety.getSnapshot().actor); const late=safety.submit([],v,safety.getSnapshot().actor);
  await new Promise(r => setImmediate(r)); await s.auth.logout(); gate.resolve({publicPlayerId:'peer',blocked:true}); await late;
  assert.equal(safety.getSnapshot().command,undefined); assert.equal(safety.getSnapshot().context,null); assert.deepEqual(safety.getSnapshot().lastBlocks,{});
});

test('root verified block immediately fences contact/direct writes and retains both existing UNKNOWN owners and accepted history', async () => {
  const s=setup(sessionEnvelope()); let blocked=false;
  const player={publicPlayerId:'peer',displayName:'Игрок',cityId:null,areaKey:null,bio:null,level:null,trainer:false,lookingForGame:false,canRequestContact:true};
  const header={id:'thread',kind:'direct',requestState:'accepted',version:1,peer:{publicPlayerId:'peer',displayName:'Игрок'},role:'initiator',lastMessageSeq:'1',readThroughSeq:'0',unreadCount:1};
  const m={id:'message',conversationId:'thread',seq:'1',kind:'text',authorPublicPlayerId:'peer',createdAt:'2026-11-14T00:00:00Z',contentState:'live',text:'Accepted history'};
  s.setHandler(async (path,init) => {
    if (path === '/me') return me;
    if (path === '/auth/native/refresh') return credentials;
    if (path.startsWith('/me/contact-state?')) return {targetPublicPlayerId:'peer',state:'none',canRequestContact:true};
    if (path.startsWith('/players/')) return blocked ? new Response('{}',{status:404}) : player;
    if (path.startsWith('/players?')) return {items:blocked ? [{...player,publicPlayerId:'other'}] : [player,{...player,publicPlayerId:'other'}],nextCursor:null};
    if (path === '/conversations/requests' || path === '/conversations/thread/messages' && init.method === 'POST') throw new Error('uncertain');
    if (path === '/conversations/thread') return blocked ? { ...header, version: 2, requestState: 'closed', unreadCount: 0 } : header;
    if (path === '/me/inbox/counts') return { pendingRequestCount: 0, pendingInvitationCount: 0, dmUnread: blocked ? 0 : 1, gameChatUnread: 0 };
    if (path.startsWith('/me/inbox?')) return { items: [], nextCursor: null, counts: { pendingRequestCount: 0, pendingInvitationCount: 0, dmUnread: blocked ? 0 : 1, gameChatUnread: 0 } };
    if (path.startsWith('/conversations/thread/messages?')) return {items:[m],nextCursor:null};
    if (path === '/me/social-profile') return {publicPlayerId:'own'};
    if (path === '/me/blocks/peer') { blocked=true; return {publicPlayerId:'peer',blocked:true}; }
    throw new Error('Unexpected isolated route');
  });
  await s.auth.hydrate(); await s.auth.players.loadList({cityId:null,name:'',looking:false,trainer:false}); await s.auth.players.loadDetail('peer');
  await s.auth.contact.open('peer'); s.auth.contact.draft('peer','Keep contact'); await s.auth.contact.send();
  const contact=s.auth.contact.getSnapshot().command!.packet, r={kind:'direct',id:'thread'} as const;
  s.auth.messages.focus(r); await new Promise(done => setImmediate(done)); assert.equal(s.auth.messages.getSnapshot().detail?.status,'ready',JSON.stringify(s.auth.messages.getSnapshot())); s.auth.messages.draft(r,'Keep message'); await s.auth.messages.act(r,'send');
  const message=s.auth.messages.getSnapshot().pending['direct:thread']!.packet;
  const profile=s.auth.profile.getSnapshot(), participation=s.auth.participation.getSnapshot(), management=s.auth.gameManagement.getSnapshot();
  const safety=s.auth.safety; safety.open({peerId:'peer',name:'Игрок',conversationId:'thread'}); const state=safety.getSnapshot();
  safety.choose('block',state.viewGeneration,state.actor); await safety.submit([],state.viewGeneration,state.actor);
  assert.equal(safety.getSnapshot().command,undefined); assert.equal(safety.getSnapshot().lastBlocks.peer,true);
  assert.strictEqual(s.auth.contact.getSnapshot().command?.packet,contact); assert.strictEqual(s.auth.messages.getSnapshot().pending['direct:thread']?.packet,message);
  assert.equal(s.auth.contact.getSnapshot().command?.status,'unknown'); assert.equal(s.auth.messages.getSnapshot().pending['direct:thread']?.state,'unknown');
  assert.deepEqual(s.auth.messages.getSnapshot().detail?.messages.map(m => m.text),['Accepted history']);
  const count=s.calls.filter(c => c.init.method === 'POST').length; await s.auth.contact.reconcile(); await s.auth.messages.retry(r);
  assert.equal(s.calls.filter(c => c.init.method === 'POST').length,count);
  await new Promise(done => setImmediate(done));
  assert.equal(s.auth.messages.getSnapshot().detail?.header?.version, 2);
  assert.equal((s.auth.messages.getSnapshot().detail?.header as { requestState: string }).requestState, 'closed');
  assert.equal(s.auth.messages.getSnapshot().counts?.dmUnread, 0);
  assert.deepEqual(s.auth.messages.getSnapshot().inbox?.items, []);
  assert.ok(s.calls.some(c => c.path.startsWith('/me/inbox?') && c.init.method === 'GET'));
  assert.ok(s.calls.some(c => c.path === '/me/inbox/counts' && c.init.method === 'GET'));
  assert.strictEqual(s.auth.messages.getSnapshot().pending['direct:thread']?.packet, message);
  assert.equal(s.calls.filter(c => c.init.method === 'POST').length, count);
  assert.deepEqual(s.auth.players.getSnapshot().list.data?.items.map(p => p.publicPlayerId),['other']);
  assert.equal(s.auth.players.getSnapshot().detail.status,'error');
  assert.strictEqual(s.auth.profile.getSnapshot(),profile); assert.strictEqual(s.auth.participation.getSnapshot(),participation); assert.strictEqual(s.auth.gameManagement.getSnapshot(),management);
});

test('cold startup with no safety receipt or DM and profile 404 still permits an explicit idempotent unblock without inferring state', async () => {
  const s = setup(sessionEnvelope());
  const peer = 'ec05b131-750e-4b91-a1a1-425373c3fba0';
  s.setHandler(async (path, init) => {
    if (path === '/me') return me;
    if (path === '/auth/native/refresh') return credentials;
    if (path === `/players/${peer}`) return new Response('{}', { status: 404 });
    if (path === `/me/blocks/${peer}`) { assert.equal(init.method, 'DELETE'); return { publicPlayerId: peer, blocked: false }; }
    throw new Error(`Unexpected route: ${path}`);
  });
  await s.auth.hydrate(); await s.auth.players.loadDetail(peer);
  assert.equal(s.auth.players.getSnapshot().detail.status, 'error');
  const owner = s.auth.safety;
  assert.deepEqual(owner.getSnapshot().lastBlocks, {}); assert.equal(s.auth.messages.getSnapshot().detail, null);
  // The validated profile route mounts this neutral context regardless of profile-read outcome.
  owner.open({ peerId: peer, name: 'Игрок' });
  const state = owner.getSnapshot();
  assert.equal(s.calls.filter(c => c.init.method !== 'GET' && !c.path.startsWith('/auth/')).length, 0);
  owner.choose('unblock', state.viewGeneration, state.actor);
  assert.equal(s.calls.filter(c => c.path.startsWith('/me/blocks/')).length, 0);
  await owner.submit([], state.viewGeneration, state.actor);
  const writes = s.calls.filter(c => c.path.startsWith('/me/blocks/'));
  assert.equal(writes.length, 1); assert.equal(writes[0]!.init.method, 'DELETE'); assert.equal(writes[0]!.init.body, '{}');
  assert.ok((writes[0]!.init.headers as Record<string,string>)['Idempotency-Key']);
  assert.equal(owner.getSnapshot().lastBlocks[peer], false);
});

test('prior block then external server unblock and same-owner reauth retains history but uses current server contact/direct authority', async () => {
  const s = setup(sessionEnvelope()); let blocked = false;
  const player = { publicPlayerId: 'peer', displayName: 'Игрок', cityId: null, areaKey: null, bio: null, level: null, trainer: false, lookingForGame: false, canRequestContact: true };
  const header = { id: 'thread', kind: 'direct', requestState: 'accepted', version: 2, peer: { publicPlayerId: 'peer', displayName: 'Игрок' }, role: 'initiator', lastMessageSeq: '0', readThroughSeq: '0', unreadCount: 0 };
  const server = async (path: string): Promise<unknown> => {
    if (path === '/me') return me;
    if (path === '/auth/native/refresh') return credentials;
    if (path === '/me/blocks/peer') { blocked = true; return { publicPlayerId: 'peer', blocked: true }; }
    if (path === '/players/peer') return blocked ? new Response('{}', { status: 404 }) : player;
    if (path.startsWith('/me/contact-state?')) return { targetPublicPlayerId: 'peer', state: 'none', canRequestContact: !blocked };
    if (path === '/me/social-profile') return { publicPlayerId: 'own' };
    if (path === '/conversations/thread') return header;
    if (path.startsWith('/conversations/thread/messages?')) return { items: [], nextCursor: null };
    if (path === '/conversations/thread/messages') throw new Error('deliberate UNKNOWN');
    throw new Error(`Unexpected route: ${path}`);
  };
  s.setHandler(server); await s.auth.hydrate();
  const safety = s.auth.safety; safety.open({ peerId: 'peer', name: 'Игрок' }); let state = safety.getSnapshot();
  safety.choose('block', state.viewGeneration, state.actor); await safety.submit([], state.viewGeneration, state.actor);
  assert.equal(s.auth.messages.isPeerSafetyHeld('peer'), true); assert.equal(s.auth.contact.mayDispatchSafety('peer'), false);
  assert.equal(safety.getSnapshot().lastBlocks.peer, true);
  blocked = false; // A later authorized server action; never inferred from local receipt history.
  s.setHandler(async () => { throw new NativeAuthError('network'); }); await s.auth.validate();
  assert.equal(safety.getSnapshot().actor, null);
  s.setHandler(async path => path === '/auth/methods' ? { items: [{ method: 'vk', type: 'oauth', available: true }] }
    : { transactionId: token('t'), expiresAt: new Date(now + 600000).toISOString(), browserStartUrl: `https://dev.gobadminton.ru/auth/native?transactionId=${token('t')}` });
  await s.auth.beginLogin('/players/peer'); const login = parseSecureEnvelope(s.stored(), now)!.pending!;
  s.setHandler(async path => path === '/me' ? { ...me, session: { ...me.session, id: 'returned' } } : { ...credentials, sessionId: 'returned' });
  await s.auth.callback(`${NATIVE_REDIRECT}?code=${token('c')}&state=${login.state}`);
  assert.equal(safety.getSnapshot().lastBlocks.peer, true);
  assert.equal(s.auth.messages.isPeerSafetyHeld('peer'), false); assert.equal(s.auth.contact.mayDispatchSafety('peer'), true);
  s.setHandler(server);
  await s.auth.contact.open('peer'); assert.equal(s.auth.contact.getSnapshot().status, 'ready');
  const r = { kind: 'direct', id: 'thread' } as const;
  s.auth.messages.focus(r); await new Promise(done => setImmediate(done));
  assert.equal(s.auth.messages.getSnapshot().detail?.status, 'ready');
  s.auth.messages.draft(r, 'Current authority'); await s.auth.messages.act(r, 'send');
  assert.equal(s.calls.filter(c => c.path === '/conversations/thread/messages' && c.init.method === 'POST').length, 1);
  assert.equal(s.calls.filter(c => c.path === '/me/blocks/peer').length, 1);
  assert.equal(safety.getSnapshot().lastBlocks.peer, true); state = safety.getSnapshot();
  assert.equal(state.command, undefined);
});

test('root lost block replay after external unblock and same-owner reauth keeps historical receipt out of current fences and rereads authority', async () => {
  const s = setup(sessionEnvelope()); let blocked = false, attempts = 0, version = 2;
  const player = { publicPlayerId: 'peer', displayName: 'Игрок', cityId: null, areaKey: null, bio: null, level: null, trainer: false, lookingForGame: false, canRequestContact: true };
  const header = { id: 'thread', kind: 'direct', requestState: 'accepted', version: 2, peer: { publicPlayerId: 'peer', displayName: 'Игрок' }, role: 'initiator', lastMessageSeq: '0', readThroughSeq: '0', unreadCount: 0 };
  const server = async (path: string, init: RequestInit): Promise<unknown> => {
    if (path === '/me') return me;
    if (path === '/auth/native/refresh') return credentials;
    if (path === '/me/blocks/peer') {
      assert.equal(init.method, 'PUT'); attempts++;
      if (attempts === 1) { blocked = true; throw new Error('executed block; response lost'); }
      version = 3; return { publicPlayerId: 'peer', blocked: true }; // Original actor-owned receipt only.
    }
    if (path === '/players/peer') return { ...player, displayName: `Server ${version}` };
    if (path.startsWith('/me/contact-state?')) return { targetPublicPlayerId: 'peer', state: 'none', canRequestContact: !blocked };
    if (path === '/me/social-profile') return { publicPlayerId: 'own' };
    if (path === '/conversations/thread') return { ...header, version };
    if (path.startsWith('/conversations/thread/messages?')) return { items: [], nextCursor: null };
    const counts = { pendingRequestCount: 0, pendingInvitationCount: 0, dmUnread: version, gameChatUnread: 0 };
    if (path === '/me/inbox/counts') return counts;
    if (path.startsWith('/me/inbox?')) return { items: [], nextCursor: null, counts };
    throw new Error(`Unexpected route: ${path}`);
  };
  s.setHandler(server); await s.auth.hydrate();
  const safety = s.auth.safety, context = { peerId: 'peer', name: 'Игрок', conversationId: 'thread' };
  safety.open(context); const original = safety.getSnapshot();
  safety.choose('block', original.viewGeneration, original.actor); await safety.submit([], original.viewGeneration, original.actor);
  const packet = safety.getSnapshot().command!.packet, bytes = JSON.stringify(packet);
  assert.equal(blocked, true); assert.equal(safety.getSnapshot().command?.status, 'unknown');
  blocked = false; // A later external authorized unblock, not another local write.
  s.setHandler(async () => { throw new NativeAuthError('network'); }); await s.auth.validate();
  s.setHandler(async path => path === '/auth/methods' ? { items: [{ method: 'vk', type: 'oauth', available: true }] }
    : { transactionId: token('t'), expiresAt: new Date(now + 600000).toISOString(), browserStartUrl: `https://dev.gobadminton.ru/auth/native?transactionId=${token('t')}` });
  await s.auth.beginLogin('/players/peer'); const login = parseSecureEnvelope(s.stored(), now)!.pending!;
  s.setHandler(async path => path === '/me' ? { ...me, session: { ...me.session, id: 'returned' } } : { ...credentials, sessionId: 'returned' });
  await s.auth.callback(`${NATIVE_REDIRECT}?code=${token('c')}&state=${login.state}`);
  assert.strictEqual(safety.getSnapshot().command?.packet, packet);
  s.setHandler(server); await s.auth.contact.open('peer'); await s.auth.players.loadDetail('peer');
  const resource = { kind: 'direct', id: 'thread' } as const;
  s.auth.messages.focus(resource); await new Promise(done => setImmediate(done));
  assert.equal(s.auth.messages.getSnapshot().detail?.header?.version, 2);
  safety.open(context); const current = safety.getSnapshot(), start = s.calls.length;
  await safety.reconcile(original.viewGeneration, original.actor); assert.equal(s.calls.length, start);
  await safety.reconcile(current.viewGeneration, current.actor); await new Promise(done => setImmediate(done));
  assert.equal(safety.getSnapshot().command, undefined); assert.equal(safety.getSnapshot().lastBlocks.peer, true);
  assert.equal(blocked, false); assert.equal(s.auth.messages.isPeerSafetyHeld('peer'), false);
  assert.equal(s.auth.contact.mayDispatchSafety('peer'), true); assert.equal(s.auth.contact.getSnapshot().status, 'ready');
  assert.equal(s.auth.contact.getSnapshot().player?.displayName, 'Server 3');
  assert.equal(s.auth.players.getSnapshot().detail.data?.displayName, 'Server 3');
  assert.equal(s.auth.messages.getSnapshot().detail?.header?.version, 3);
  assert.equal(s.auth.messages.getSnapshot().counts?.dmUnread, 3);
  assert.doesNotMatch(safety.getSnapshot().notice ?? '', /Игрок заблокирован|Блокировка снята/);
  const writes = s.calls.filter(c => c.init.method !== 'GET' && !c.path.startsWith('/auth/'));
  assert.equal(writes.length, 2); assert.deepEqual(writes.map(c => c.path), ['/me/blocks/peer', '/me/blocks/peer']);
  assert.equal(writes[0]!.init.body, writes[1]!.init.body);
  assert.equal((writes[1]!.init.headers as Record<string,string>)['Idempotency-Key'], packet.key);
  assert.equal(JSON.stringify(packet), bytes); assert.equal(packet.actor.sessionId, 'session-a');
  assert.notEqual(current.actor?.sessionId, packet.actor.sessionId);
  assert.ok(s.calls.slice(start).some(c => c.path.startsWith('/me/contact-state?') && c.init.method === 'GET'));
});

test('root controlled direct private404 after safety hides private DTOs while preserving the exact message UNKNOWN for authorized recovery', async () => {
  const s = setup(sessionEnvelope()); let denied = false, recover = false;
  const resource = { kind: 'direct', id: 'thread' } as const;
  const header = { id: 'thread', kind: 'direct', requestState: 'accepted', version: 1, peer: { publicPlayerId: 'peer', displayName: 'Private peer' }, role: 'initiator', lastMessageSeq: '1', readThroughSeq: '0', unreadCount: 1 };
  const message = { id: 'message', conversationId: 'thread', seq: '1', kind: 'text', authorPublicPlayerId: 'peer', createdAt: '2026-11-14T00:00:00Z', contentState: 'live', text: 'Private accepted history' };
  s.setHandler(async (path, init) => {
    if (path === '/me') return me;
    if (path === '/auth/native/refresh') return credentials;
    if (path === '/me/social-profile') return { publicPlayerId: 'own' };
    if (path === '/conversations/thread') return denied ? new Response('{}', { status: 404 }) : header;
    if (path.startsWith('/conversations/thread/messages?')) return { items: [message], nextCursor: '1' };
    if (path === '/conversations/thread/messages' && init.method === 'POST') {
      if (!recover) throw new Error('send response lost');
      return { messageId: message.id, conversationId: 'thread', seq: message.seq, createdAt: message.createdAt, outcome: 'duplicate' };
    }
    const counts = { pendingRequestCount: 0, pendingInvitationCount: 0, dmUnread: 1, gameChatUnread: 0 };
    if (path.startsWith('/me/inbox?')) return { items: [], counts, nextCursor: null };
    if (path === '/me/inbox/counts') return counts;
    if (path === '/me/blocks/peer') { denied = init.method === 'PUT'; return { publicPlayerId: 'peer', blocked: denied }; }
    throw new Error(`Unexpected route: ${path}`);
  });
  await s.auth.hydrate(); s.auth.messages.focus(resource); await new Promise(done => setImmediate(done));
  assert.equal(s.auth.messages.getSnapshot().detail?.status, 'ready');
  s.auth.messages.draft(resource, 'Original private draft'); await s.auth.messages.act(resource, 'send');
  const packet = s.auth.messages.getSnapshot().pending['direct:thread']!.packet, bytes = JSON.stringify(packet);
  const safety = s.auth.safety; safety.open({ peerId: 'peer', name: 'Private peer', conversationId: 'thread' });
  let state = safety.getSnapshot(); safety.choose('block', state.viewGeneration, state.actor); await safety.submit([], state.viewGeneration, state.actor);
  await new Promise(done => setImmediate(done));
  const hidden = s.auth.messages.getSnapshot();
  assert.equal(hidden.detail?.status, 'error'); assert.equal(hidden.detail?.header, null); assert.deepEqual(hidden.detail?.messages, []);
  assert.deepEqual(hidden.detail?.members, []); assert.equal(hidden.detail?.cursor, null); assert.equal(hidden.detail?.ownId, null);
  assert.equal(hidden.inbox, null); assert.equal(hidden.counts, null);
  assert.strictEqual(hidden.pending['direct:thread']?.packet, packet); assert.equal(hidden.pending['direct:thread']?.state, 'unknown');
  assert.equal(hidden.drafts['direct:thread'], 'Original private draft'); assert.equal(JSON.stringify(packet), bytes);
  await s.auth.messages.retry(resource);
  assert.equal(s.calls.filter(c => c.init.method === 'POST' && c.path === '/conversations/thread/messages').length, 1);
  state = safety.getSnapshot(); safety.choose('unblock', state.viewGeneration, state.actor); await safety.submit([], state.viewGeneration, state.actor);
  await new Promise(done => setImmediate(done));
  assert.equal(s.auth.messages.getSnapshot().detail?.status, 'ready');
  assert.deepEqual(s.auth.messages.getSnapshot().detail?.messages.map(m => m.text), ['Private accepted history']);
  assert.strictEqual(s.auth.messages.getSnapshot().pending['direct:thread']?.packet, packet);
  assert.equal(s.calls.filter(c => c.init.method === 'POST' && c.path === '/conversations/thread/messages').length, 1);
  recover = true; await s.auth.messages.retry(resource); await new Promise(done => setImmediate(done));
  const sends = s.calls.filter(c => c.init.method === 'POST' && c.path === '/conversations/thread/messages');
  assert.equal(sends.length, 2); assert.equal(sends[0]!.init.body, sends[1]!.init.body);
  assert.equal((sends[1]!.init.headers as Record<string,string>)['Idempotency-Key'], packet.key);
  assert.equal(s.auth.messages.getSnapshot().pending['direct:thread'], undefined);
});

test('venue-create auth intent accepts only exact typed UUID route and survives secure return parsing', async () => {
  const route = '/games/create/venue/11111111-1111-4111-8111-111111111111';
  assert.equal(canonicalReturnPath(route),route);
  for (const invalid of [route+'?cityId=other',route+'#publish',route+'\n',route+'/publish',route.replace('11111111-','%31'+'1111111-'),'/games/create/venue/not-a-uuid','https://dev.gobadminton.ru'+route]) assert.equal(canonicalReturnPath(invalid),null);
  const start = setup(); assert.ok(await start.auth.beginLogin(route));
  const saved = parseSecureEnvelope(start.stored(),now)!;
  assert.equal(saved.returnPath,route); assert.equal(saved.pending?.returnPath,route);
  const resumed = setup(saved); await resumed.auth.hydrate();
  resumed.setHandler(async path => path === '/me' ? me : credentials);
  assert.equal(await resumed.auth.callback(`${NATIVE_REDIRECT}?code=${token('c')}&state=${saved.pending!.state}`),route);
  assert.equal(resumed.auth.getSnapshot().status,'authenticated');
  assert.equal(resumed.auth.gameManagement.getSnapshot().command,undefined);
  assert.equal(resumed.auth.gameManagement.getSnapshot().preview,null);
  assert.ok(![...start.calls,...resumed.calls].some(c => c.path === '/games' || c.path.endsWith('/publish')));
  const cancelled = setup(); await cancelled.auth.beginLogin(route); await cancelled.auth.cancelLogin();
  assert.equal(cancelled.auth.getSnapshot().status,'guest');
  assert.equal(parseSecureEnvelope(cancelled.stored(),now)?.returnPath,route);
  assert.equal(cancelled.auth.gameManagement.getSnapshot().command,undefined);

});


test('permanent Header profile action preserves only typed venue intent through real profile save and profile return handler', async t => {
  const header = readFileSync(new URL('../src/components/ui.tsx',import.meta.url),'utf8');
  const handler = header.match(/accessibilityLabel="Профиль" onPress=\{(.+)\}/)![1];
  const headerBody = header.slice(header.indexOf('export function Header('),header.indexOf('  return <View style={styles.header}>'))
    .replace('export function','function') + `  return (${handler});\n}`;
  const route = '/games/create/venue/11111111-1111-4111-8111-111111111111';
  function pressHeader(pathname: string) {
    let destination: {pathname:string;params:{returnTo?:string}} | undefined;
    const render = runInNewContext(`(${stripTypeScriptTypes(headerBody)})`, {
      useRouter:() => ({push:(path: typeof destination) => { destination = path; }}),usePathname:() => pathname,
      canonicalGamePath,canonicalVenueCreatePath,
      useAuth: () => ({ status: 'authenticated', me, profile: { subscribe: () => () => {}, getSnapshot: () => ({ status: 'ready', profile: null }), load: async () => {} } }),
      playerInitials, headerAvatarPresentation,
      useState: (initial: unknown) => [typeof initial === 'function' ? (initial as () => unknown)() : initial, () => {}],
      useEffect: () => {},
      useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
    }) as (props: object) => () => void;
    render({})(); return destination!;
  }
  assert.deepEqual({...pressHeader('/games/existing').params},{returnTo:'/games/existing'});
  assert.deepEqual({...pressHeader('/games/create').params},{returnTo:'/games/create'});
  for (const invalid of [route+'?cityId=x',route+'#publish',route+'\n',route+'/publish',route.replace('11111111-','%31'+'1111111-'),
    '/games/create/venue/not-a-uuid','https://dev.gobadminton.ru'+route,'//evil'+route,'/messages','/games/manage/x','/venues/11111111-1111-4111-8111-111111111111']) {
    assert.deepEqual({...pressHeader(invalid).params},{},invalid);
  }
  const destination = pressHeader(route); assert.equal(destination.pathname,'/profile'); assert.equal(destination.params.returnTo,route);
  t.mock.method(publicApi,'cities',async () => [{id:'city',nameRu:'Казань',nameEn:'Kazan',countryCode:'RU',defaultTimezone:'Europe/Moscow'}]);
  const s = setup(sessionEnvelope()); let dto = {publicPlayerId:'own',displayName:'',cityId:null as string | null,version:0,
    trainer:false,areaKey:null,level:null,bio:null,directoryVisible:false,contactPolicy:'closed',consentPolicyVersion:null,
    optedInAt:null,radarConsented:false,radarConsentPolicyVersion:null,radarConsentedAt:null,socialEligible:false,lookingForGame:null};
  s.setHandler(async (path,init) => {
    if (path === '/me') return me;
    if (path === '/auth/native/refresh') return credentials;
    if (path === '/me/social-profile') {
      if (init.method === 'PATCH') dto = {...dto,...JSON.parse(init.body as string),version:1};
      return dto;
    }
    throw new Error(`Unexpected route: ${path}`);
  });
  await s.auth.hydrate(); await s.auth.profile.load();
  s.auth.profile.update({displayName:'Хозяин',cityId:'city'}); await s.auth.profile.save();
  assert.equal(s.auth.profile.getSnapshot().profile?.displayName,'Хозяин');
  const profile = readFileSync(new URL('../app/profile.tsx',import.meta.url),'utf8');
  const returnHandler = profile.match(/title="Вернуться к игре" onPress=\{(.+)\} \/>/)![1];
  const profileBody = profile.slice(profile.indexOf('export default function Profile()'),profile.indexOf('  return <Page'))
    .replace('export default function','function') + `  return (${returnHandler});\n}`;
  const returned: string[] = [];
  const render = runInNewContext(`(${stripTypeScriptTypes(profileBody)})`, {
    useAuth:() => ({...s.auth.getSnapshot(),gameManagement:s.auth.gameManagement}),
    useRouter:() => ({replace:(path: string) => returned.push(path)}),
    usePreferences:() => ({preferences:{cityId:'search-city'}}),useLocalSearchParams:() => destination.params,
    useState:() => [false,() => {}],useRef:() => ({current:false}),canonicalReturnPath,
  }) as () => () => void;
  const start = s.calls.length; render()(); await new Promise(done => setImmediate(done));
  assert.deepEqual(returned,[route]); assert.equal(s.calls.length,start);
  assert.equal(s.auth.gameManagement.getSnapshot().preview,null); assert.equal(s.auth.gameManagement.getSnapshot().command,undefined);
  assert.equal(s.auth.gameManagement.getSnapshot().form.venueId,'');
  assert.equal(s.calls.filter(c => c.path === '/games' || c.path.endsWith('/publish')).length,0);
});

test('owning public native intent adapts exact Games map context while verified auth and rejected callbacks retain their authority', async () => {
  const {publicGamesIntent}=await import('../src/maps.ts');
  const protocol=await import('../src/native-auth-protocol.ts');
  const source=readFileSync(new URL('../app/+native-intent.tsx',import.meta.url),'utf8');
  const body=source.slice(source.indexOf('export async function redirectSystemPath')).replace('export async function','async function');
  let callbacks=0;
  const redirect=runInNewContext(`(${stripTypeScriptTypes(body)})`,{
    URL,publicGamesIntent,...protocol,nativeAuth:{callback:async()=>{callbacks++;return '/profile';},getSnapshot:()=>({returnPath:null})},
  }) as (input:{path:string;initial:boolean})=>Promise<string>;
  const cityId='a0000000-0000-4000-8000-000000000001';
  const accepted=await redirect({path:`https://dev.gobadminton.ru/games?view=map&cityId=${cityId}&day=2026-11-20&activity=trainer_led`,initial:true});
  const url=new URL(accepted,'https://dev.gobadminton.ru');assert.equal(url.pathname,'/games/map');
  assert.equal(url.searchParams.get('cityId'),cityId);assert.equal(url.searchParams.get('activity'),'trainer_led');assert.equal(url.searchParams.get('day'),'2026-11-20');
  assert.equal(url.searchParams.get('origin'),'external');assert.equal(callbacks,0);
  for (const invalid of [
    `https://evil.example/games?view=map`,`gobadminton-dev://host/games?view=map`,`gobadminton-dev://games/map`,`gobadminton-dev://games?view=map`,
    `/games?view=map&returnTo=https://evil.example`,`/games?view=map&cityId=${cityId}&cityId=${cityId}`,
    `/games?view=map&day=2026-02-30`,`/games?view=map#publish`,`/games?view=map\n`,
  ]) assert.equal(await redirect({path:invalid,initial:false}),'/games',invalid);
  assert.equal(await redirect({path:`${NATIVE_REDIRECT}?code=${token('c')}&state=${token('s')}`,initial:true}),'/profile');assert.equal(callbacks,1);
  assert.equal(await redirect({path:`gobadminton-dev://host/auth/native/callback?code=${token('c')}&state=${token('s')}`,initial:true}),'/profile');assert.equal(callbacks,1);
  assert.equal(await redirect({path:'/messages/direct/thread',initial:false}),'/messages/direct/thread');
  const venue='/games/create/venue/11111111-1111-4111-8111-111111111111';
  assert.equal(await redirect({path:venue,initial:false}),venue);assert.equal(protocol.canonicalReturnPath(venue),venue);
  assert.equal(protocol.canonicalReturnPath('/games/map?returnTo=https://evil.example'),null);
});


test('mounted Radar runtime uses existing root actor/session and foreground lifecycle, without auto-enable or replacing Header typed returns',async()=>{
  const s=setup(sessionEnvelope());await s.auth.hydrate();
  const runtime=readFileSync(new URL('../src/radar-runtime.tsx',import.meta.url),'utf8');
  const body=runtime.slice(runtime.indexOf('export function RadarProvider('),runtime.indexOf('  return <Context.Provider')).replace('export function','function')+'  return owner;\n}';
  let lifecycle:((state:string)=>void)|undefined,cleanup:(()=>void)|undefined;
  const render=runInNewContext(`(${stripTypeScriptTypes(body)})`,{
    useState:(factory:()=>unknown)=>[factory()],useLayoutEffect:(effect:()=>()=>void)=>{cleanup=effect();},
    RadarCoordinator,nativeAuth:s.auth,
    Location:{getForegroundPermissionsAsync:async()=>{throw Error('No automatic location permission');},requestForegroundPermissionsAsync:async()=>{throw Error('No automatic permission prompt');},hasServicesEnabledAsync:async()=>true,getCurrentPositionAsync:async()=>{throw Error('No automatic GPS');},Accuracy:{Balanced:3}},
    Crypto:{randomUUID:()=> 'fixture-radar-key'},AppState:{currentState:'active',addEventListener:(_event:string,fn:typeof lifecycle)=>{lifecycle=fn;return {remove:()=>{lifecycle=undefined;}};}},
  }) as (props:object)=>RadarCoordinator;
  const owner=render({});await new Promise(resolve=>setImmediate(resolve));
  assert.equal(owner.getSnapshot().actor?.sessionId,me.session.id);assert.equal(owner.getSnapshot().enabling,false);
  assert.equal(s.calls.some(c=>c.path==='/me/radar/activations'&&c.init.method==='POST'),false);
  lifecycle!('background');assert.equal(owner.getSnapshot().rows.length,0);assert.equal(owner.getSnapshot().pins.length,0);
  await s.auth.logout();assert.equal(owner.getSnapshot().actor,null);cleanup!();
  const layout=readFileSync(new URL('../app/_layout.tsx',import.meta.url),'utf8');assert.equal((layout.match(/<RadarProvider>/g)??[]).length,1);
  assert.match(layout,/<AuthProvider><RadarProvider>/);
  const header=readFileSync(new URL('../src/components/ui.tsx',import.meta.url),'utf8');assert.match(header,/<RadarControls compact/);
});

test('real AuthCoordinator preview port and ContactEditor composer wire keep Radar proof session-bound, without ordinary player authority',async()=>{
  const s=setup(sessionEnvelope());await s.auth.hydrate();const a=s.auth.participation.getSnapshot().actor!;
  let valid=true, blockAttempts=0;const expires=Date.now()+60000;
  const context=Object.freeze({kind:'radar' as const,actor:a,target:'radar-peer',resultRef:'u1.original',queryRef:'query',activationId:'activation',generation:1,expiresAt:expires,valid:()=>valid});
  const preview={player:{publicPlayerId:'radar-peer',displayName:'Radar peer',level:null,trainer:false,canRequestContact:true},proximityBand:null,upcomingGames:[],
    radar:{consentPolicyVersion:'radar-geographic-sharing-v2',validUntil:new Date(expires).toISOString(),distance:null,geo:{latitude:55.75,longitude:37.62,crs:'EPSG:4326',model:'regional_grid_1000m_v1',gridSizeMeters:1000,uncertaintyMeters:1000,quality:'degraded',sourceTimestampBucket:new Date().toISOString(),sourceAgeSeconds:1}}};
  s.setHandler(async path=>{
    if(path==='/radar/results/preview')return preview;
    if(path.startsWith('/me/contact-state?'))return {targetPublicPlayerId:'radar-peer',state:'none',canRequestContact:true};
    if(path==='/conversations/requests')throw Error('timeout');
    if(path==='/me/blocks/radar-peer'){if(++blockAttempts===1)throw Error('lost block receipt');return {publicPlayerId:'radar-peer',blocked:true};}
    if(path==='/auth/native/logout')return {ok:true};
    throw Error('Unexpected Radar-only fallback '+path);
  });
  assert.equal(s.auth.contact.stageRadar(context),true);await s.auth.contact.openComposer('radar-peer');assert.equal(s.auth.contact.getSnapshot().status,'ready');
  s.auth.contact.draft('radar-peer','Proof message');await s.auth.contact.send();
  const write=s.calls.find(c=>c.path==='/conversations/requests')!;assert.equal(JSON.parse(write.init.body as string).discoveryProof,'u1.original');
  const packet=s.auth.contact.getSnapshot().command!.packet;valid=false;s.auth.contact.invalidateRadar();await s.auth.contact.reconcile();
  assert.strictEqual(s.auth.contact.getSnapshot().command!.packet,packet);assert.equal(s.calls.filter(c=>c.path==='/conversations/requests').length,1);
  // A replayed safety receipt rereads this same Radar context, even after it expired.
  const safety=s.auth.safety;safety.open({peerId:'radar-peer',name:'Radar peer'});
  const view=safety.getSnapshot();safety.choose('block',view.viewGeneration,view.actor);
  await safety.submit([],view.viewGeneration,view.actor);assert.equal(safety.getSnapshot().command?.status,'unknown');
  await safety.reconcile(view.viewGeneration,view.actor);await new Promise(done=>setImmediate(done));
  assert.equal(s.auth.contact.getSnapshot().status,'unavailable');
  assert.strictEqual(s.auth.contact.getSnapshot().command!.packet,packet);
  assert.equal(s.calls.filter(c=>c.path==='/conversations/requests').length,1);
  assert.equal(s.calls.some(c=>c.path.startsWith('/players/')),false);
  await s.auth.logout();assert.equal(s.auth.contact.getSnapshot().actor,null);
});

test('bare browse real login → durable pending → hydrate/callback → entry; cancel never writes interest or message',async()=>{
  const {hydratedEntryRoute,emptyPreferences}=await import('../src/entry.ts');
  assert.equal(canonicalReturnPath('/players/browse'),'/players/browse');
  const s=setup();await s.auth.hydrate();const login=await s.auth.beginLogin('/players/browse');assert.ok(login);
  const secure=parseSecureEnvelope(s.stored(),now)!;assert.equal(secure.pending?.returnPath,'/players/browse');
  const restart=setup(secure);await restart.auth.hydrate();
  const returned=await restart.auth.callback(`${NATIVE_REDIRECT}?code=${token('c')}&state=${secure.pending!.state}`);
  assert.equal(returned,'/players/browse');
  assert.equal(hydratedEntryRoute(emptyPreferences,true,restart.auth.getSnapshot()),'/players/browse');
  const cancelled=setup();await cancelled.auth.hydrate();await cancelled.auth.beginLogin('/players/browse');await cancelled.auth.cancelLogin();
  assert.equal(cancelled.auth.getSnapshot().status,'guest');
  for(const session of [s,restart,cancelled])assert.equal(session.calls.filter(c=>c.path.includes('play-interests')||c.path.includes('conversations')||c.path.includes('/messages')).length,0);
  for(const path of ['/players','/players/browse/','/players/browse?name=a','/players/browse#x','/players/%62rowse','/players/browse\n','/players/browse/send','https://user:pass@dev.gobadminton.ru/players/browse','//dev.gobadminton.ru/players/browse'])assert.equal(canonicalReturnPath(path),null);
});

const interestReceipt = {interestId:'10000000-0000-4000-8000-000000000001',version:'9007199254740993',outcome:'mutual'};
function interestPacket(auth:AuthCoordinator):PlayInterestPacket {
  return Object.freeze({kind:'send',path:'/play-interests',target:'peer',key:'auth-interest-key',
    actor:Object.freeze({...auth.participation.getSnapshot().actor!}),body:Object.freeze({targetPublicPlayerId:'peer'})});
}
test('actual closed interest wrappers read captured IDs and dispatch one frozen packet for the current actor',async()=>{
  const s=setup(sessionEnvelope());await s.auth.hydrate();const packet=interestPacket(s.auth);
  s.setHandler(async path=>path.startsWith('/me/play-interest-states?')?{items:[]} : interestReceipt);
  const ids=['peer'];const read=s.auth.playInterestStates(ids,packet.actor);ids[0]='changed';await read;
  await s.auth.playInterestMutation(packet,()=>true);
  const get=s.calls.find(c=>c.path.startsWith('/me/play-interest-states?'))!;
  assert.equal(get.path,'/me/play-interest-states?publicPlayerId=peer');
  const writes=s.calls.filter(c=>c.path==='/play-interests');assert.equal(writes.length,1);
  assert.deepEqual(JSON.parse(String(writes[0]!.init.body)),{targetPublicPlayerId:'peer'});
  assert.equal((writes[0]!.init.headers as Record<string,string>)['Idempotency-Key'],packet.key);
});
test('interest wrapper rechecks actor and permit after real token acquisition: stale authority makes zero POSTs',async()=>{
  for(const change of ['actor','permit'] as const){
    const s=setup(sessionEnvelope());await s.auth.hydrate();const packet=interestPacket(s.auth),gate=deferred<unknown>();
    let permitted=true;
    s.setHandler(async path=>path==='/auth/native/refresh'?gate.promise:path==='/me'?me:{ok:true});
    const rotation=s.auth.refresh();await new Promise(done=>setImmediate(done));
    const write=s.auth.playInterestMutation(packet,()=>permitted);const rejected=assert.rejects(write);
    if(change==='actor')await s.auth.logout();else permitted=false;
    gate.resolve(credentials);await rotation;await rejected;
    assert.equal(s.calls.filter(c=>c.path==='/play-interests').length,0,change);
  }
});
test('interest wrapper rejects a reply after actor rotation and routes 401 through existing auth failure without resend',async()=>{
  const stale=setup(sessionEnvelope());await stale.auth.hydrate();const gate=deferred<unknown>();
  stale.setHandler(async path=>path==='/play-interests'?gate.promise:{ok:true});
  const pending=stale.auth.playInterestMutation(interestPacket(stale.auth),()=>true);const rejected=assert.rejects(pending);
  await new Promise(done=>setImmediate(done));await stale.auth.logout();gate.resolve(interestReceipt);await rejected;
  assert.equal(stale.calls.filter(c=>c.path==='/play-interests').length,1);
  const denied=setup(sessionEnvelope());await denied.auth.hydrate();
  denied.setHandler(async()=>new Response('{}',{status:401}));
  await assert.rejects(denied.auth.playInterestMutation(interestPacket(denied.auth),()=>true),NativeAuthError);
  assert.equal(denied.auth.getSnapshot().status,'guest');assert.equal(denied.auth.participation.getSnapshot().actor,null);
  await denied.auth.validate();
  assert.equal(denied.calls.filter(c=>c.path==='/play-interests').length,1);
});
test('mounted interest runtime → real AuthCoordinator → native API; Close/background retire late mutual and never resend',async()=>{
  const s=setup(sessionEnvelope());await s.auth.hydrate();const gate=deferred<unknown>(),tokenGate=deferred<unknown>();
  const none={relationship:'none',interestId:null,version:null,capabilities:{canSend:true,canWithdraw:false}};
  s.setHandler(async path=>path==='/auth/native/refresh'?tokenGate.promise:path==='/me'?me:path.startsWith('/me/play-interest-states?')?{items:[none]}:path==='/play-interests'?gate.promise:{ok:true});
  const runtime=readFileSync(new URL('../src/play-interest-runtime.tsx',import.meta.url),'utf8');
  const body=runtime.slice(runtime.indexOf('export function PlayInterestProvider('),runtime.indexOf('  return <Context.Provider')).replace('export function','function')+'  return owner;\n}';
  let lifecycle:((state:string)=>void)|undefined,cleanup:(()=>void)|undefined;
  const render=runInNewContext(`(${stripTypeScriptTypes(body)})`,{
    useState:(factory:()=>unknown)=>[factory()],useLayoutEffect:(effect:()=>()=>void)=>{cleanup=effect();},
    PlayInterestCoordinator,nativeAuth:s.auth,Crypto:{randomUUID:()=> 'actual-runtime-key'},
    AppState:{currentState:'active',addEventListener:(_event:string,fn:typeof lifecycle)=>{lifecycle=fn;return {remove:()=>{lifecycle=undefined;}};}},
  }) as (props:object)=>PlayInterestCoordinator;
  const owner=render({});assert.equal(owner.getSnapshot().actor?.sessionId,me.session.id);
  const peer={publicPlayerId:'peer',displayName:'Партнёр',cityId:null,areaKey:null,level:null,bio:null,trainer:false,lookingForGame:true};
  owner.stage({cityId:null,name:'',areaKey:'north',looking:true,trainer:false},{items:[peer],nextCursor:null});owner.enter();
  await owner.refresh(['peer']);const rotation=s.auth.refresh();
  const sending=owner.act('send','peer',owner.getSnapshot().episode,{publicPlayerId:'self',displayName:'Я'});
  await new Promise(done=>setImmediate(done));assert.equal(s.calls.filter(c=>c.path==='/play-interests').length,0);
  tokenGate.resolve(credentials);await rotation;
  await new Promise(done=>setImmediate(done));assert.equal(s.calls.filter(c=>c.path==='/play-interests').length,1);
  owner.exit();lifecycle!('background');gate.resolve(interestReceipt);await sending;
  assert.equal(owner.getSnapshot().match,null);lifecycle!('active');owner.enter();
  assert.equal(owner.getSnapshot().match,null);assert.equal(s.calls.filter(c=>c.path==='/play-interests').length,1);
  await s.auth.logout();assert.equal(owner.getSnapshot().actor,null);cleanup!();
  const nav=readFileSync(new URL('../src/components/main-navigation.tsx',import.meta.url),'utf8');
  assert.equal((nav.match(/<PlayInterestProvider>/g)??[]).length,1);
  assert.match(nav,/<PlayInterestProvider><View/);
});

// Execute the actual component's hook/event body. React Native layout/animation are host stubs;
// auth, packet owner, closed ports, HTTP parsing and business results are the real source.
async function mountBrowseEvents(owner:PlayInterestCoordinator, options:{guest?:boolean;tutorial?:boolean}={}) {
  const pure=await import('../src/player-browse.ts');
  const source=readFileSync(new URL('../src/components/player-browse.tsx',import.meta.url),'utf8');
  const body=source.slice(source.indexOf('export function PlayerBrowse('),source.indexOf('  return <ScreenFrame>')).replace('export function','function')+
    '  return {handlers,action,vertical,undo,finishTutorial,setSize,info,tutorial,blocked,card,intent,reopenTutorial};\n}';
  const cells:unknown[]=[],effects:{deps:unknown[];cleanup?:()=>void}[]=[];
  const jobs:(()=>void)[]=[],writes:{key:string;value:string}[]=[],details:string[]=[];
  let cursor=0,login=0,close=0,back:(()=>boolean)|undefined;
  const useState=(init:unknown)=>{
    const n=cursor++;if(!(n in cells))cells[n]=typeof init==='function'?(init as ()=>unknown)():init;
    return [cells[n],(value:unknown)=>{cells[n]=typeof value==='function'?(value as (previous:unknown)=>unknown)(cells[n]):value;}];
  };
  const useRef=(value:unknown)=>{const n=cursor++;if(!(n in cells))cells[n]={current:value};return cells[n];};
  const effect=(fn:()=>void|(()=>void),deps:unknown[])=>{
    const n=cursor++,old=effects[n];
    if(old && deps.length===old.deps.length && deps.every((v,i)=>Object.is(v,old.deps[i])))return;
    jobs.push(()=>{old?.cleanup?.();const cleanup=fn();effects[n]={deps,cleanup:typeof cleanup==='function'?cleanup:undefined};});
  };
  class ValueXY { x={interpolate:()=>0};setValue(){}stopAnimation(){}getTranslateTransform(){return [];} }
  const renderBody=runInNewContext(`(${stripTypeScriptTypes(body)})`,{
    ...pure,useState,useRef,useEffect:effect,useLayoutEffect:effect,useRouter:()=>({push:()=>{throw Error('Unexpected navigation');}}),
    useReduceMotion:()=>false,useSafeAreaInsets:()=>({bottom:16}),useWindowDimensions:()=>({height:780,width:360,fontScale:1}),playerMediaUrl:()=>null,
    findNodeHandle:()=>null,AccessibilityInfo:{announceForAccessibility:()=>{},setAccessibilityFocus:()=>{}},
    Animated:{ValueXY,timing:()=>({start:(done?:(result:{finished:boolean})=>void)=>done?.({finished:true})})},
    PanResponder:{create:(value:unknown)=>value},
    BackHandler:{addEventListener:(_name:string,fn:()=>boolean)=>{back=fn;return {remove:()=>{back=undefined;}};}},
    AsyncStorage:{getItem:async()=>options.tutorial?null:'complete',setItem:async(key:string,value:string)=>{writes.push({key,value});}},
  }) as (props:object)=>{handlers:Record<string,(event:unknown,gesture?:unknown)=>unknown>;action:(kind:string)=>void;
    vertical:(up:boolean)=>void;undo:()=>void;finishTutorial:()=>void;setSize:(size:object)=>void;info:number|null;tutorial:number;blocked:boolean;card?:string;intent:string|null;reopenTutorial:()=>void};
  const render=()=>{
    cursor=0;
    const value=renderBody({owner,state:owner.getSnapshot(),self:options.guest?null:{publicPlayerId:'self',displayName:'Мой профиль'},focused:true,
      status:'ready',loadingMore:false,moreError:false,onMore:()=>{},onRetry:()=>{},onClose:()=>{close++;owner.exit();},
      onLogin:()=>{login++;},onProfileRetry:()=>{},onDetail:(id:string)=>details.push(id),detail:{id:'',status:'idle',data:null,error:null}});
    jobs.splice(0).forEach(fn=>fn());return value;
  };
  let value=render();await new Promise(done=>setImmediate(done));value=render();
  value.setSize({width:360,height:500});value=render();
  return {render,writes,details,login:()=>login,close:()=>close,back:()=>back!(),
    cleanup:()=>effects.forEach(e=>e.cleanup?.())};
}
test('real component gesture and button → mounted root owner → closed auth ports → native API; stale card cannot send',async()=>{
  const s=setup(sessionEnvelope());await s.auth.hydrate();
  const none={relationship:'none',interestId:null,version:null,capabilities:{canSend:true,canWithdraw:false}};
  const gate=deferred<unknown>();
  s.setHandler(async path=>path.startsWith('/me/play-interest-states?')?{items:[none]}:path==='/play-interests'?gate.promise:{ok:true});
  const owner=new PlayInterestCoordinator({read:s.auth.playInterestStates,send:s.auth.playInterestMutation,random:()=> 'component-wire-key'});
  owner.setActor(s.auth.participation.getSnapshot().actor);
  const peer={publicPlayerId:'peer',displayName:'Партнёр',cityId:null,areaKey:null,level:null,bio:'О себе',trainer:false,lookingForGame:true};
  owner.stage({cityId:'city',name:'Парт',areaKey:'north',looking:true,trainer:false},{items:[peer,{...peer,publicPlayerId:'other'}],nextCursor:null});owner.enter();
  const ui=await mountBrowseEvents(owner);let card=ui.render();assert.equal(card.blocked,false);
  const start={nativeEvent:{timestamp:1000}},move={nativeEvent:{timestamp:1020}},release={nativeEvent:{timestamp:1021}};
  card.handlers.onStartShouldSetPanResponder!(start);
  assert.equal(card.handlers.onMoveShouldSetPanResponder!(move,{dx:30,dy:0}),true);
  card.handlers.onPanResponderMove!(move,{dx:30,dy:0});assert.equal(ui.render().intent,'request');
  card.handlers.onPanResponderRelease!(release,{dx:30,dy:0});assert.equal(ui.render().intent,null);
  card.action('request');await new Promise(done=>setImmediate(done));
  assert.equal(s.calls.filter(c=>c.path==='/play-interests').length,1);
  assert.deepEqual(JSON.parse(String(s.calls.find(c=>c.path==='/play-interests')!.init.body)),{targetPublicPlayerId:'peer'});
  gate.resolve(interestReceipt);await new Promise(done=>setImmediate(done));assert.equal(owner.getSnapshot().match?.peer.publicPlayerId,'peer');
  owner.dismiss();owner.select('other');ui.render();card.action('request');
  assert.equal(s.calls.filter(c=>c.path==='/play-interests').length,1,'retired peer callback cannot send to the new card');
  card=ui.render();card.vertical(true);card=ui.render();assert.equal(card.info,0);assert.deepEqual(ui.details,['other']);
  ui.back();card=ui.render();assert.equal(card.info,null);
  card.action('skip');card=ui.render();assert.equal(card.card,undefined);card.undo();card=ui.render();assert.equal(card.card,'other');
  ui.back();assert.equal(ui.close(),1);
  ui.cleanup();
});
test('actual guest component tutorial persists only after both steps for this actor; explicit request only opens login',async()=>{
  const owner=new PlayInterestCoordinator({read:async()=>{throw Error('Guest private read');},send:async()=>{throw Error('Guest POST');},random:()=> 'guest-key'});
  owner.stage({cityId:null,name:'',looking:false,trainer:false},{items:[{publicPlayerId:'peer',displayName:'Гость',cityId:null,areaKey:null,level:null,bio:null,trainer:false,lookingForGame:true}],nextCursor:null});owner.enter();
  const ui=await mountBrowseEvents(owner,{guest:true,tutorial:true});let card=ui.render();
  assert.equal(card.tutorial,1);card.action('request');assert.equal(ui.login(),0);assert.equal(ui.writes.length,0);
  card.finishTutorial();card=ui.render();assert.equal(card.tutorial,2);assert.equal(ui.writes.length,0);
  card.finishTutorial();await new Promise(done=>setImmediate(done));card=ui.render();assert.equal(card.tutorial,0);
  assert.deepEqual(ui.writes,[{key:'gb-player-gallery-tutorial-v3:guest',value:'complete'}]);
  card.reopenTutorial();card=ui.render();assert.equal(card.tutorial,1);assert.equal(ui.writes.length,1);
  ui.back();card=ui.render();assert.equal(card.tutorial,0);assert.equal(ui.writes.length,1);
  card.action('request');assert.equal(ui.login(),1);assert.equal(owner.getSnapshot().command,null);
  assert.equal(owner.getSnapshot().selected,'peer');ui.cleanup();
});

test('actual friendly-match contact entry rechecks ordinary ContactState only on explicit CTA, with no message send or Radar proof',async()=>{
  const s=setup(sessionEnvelope());await s.auth.hydrate();
  const source=readFileSync(new URL('../src/components/friendly-match.tsx',import.meta.url),'utf8');
  const body=source.slice(source.indexOf('export async function openFriendlyContact('),source.indexOf('export function FriendlyMatch(')).replace('export async function','async function');
  const {sameActor}=await import('../src/participation.ts');
  const open=runInNewContext(`(${stripTypeScriptTypes(body)})`,{sameActor}) as (match:object,contact:AuthCoordinator['contact'],valid:()=>boolean)=>Promise<string|null>;
  const peer={publicPlayerId:'peer',displayName:'Партнёр',cityId:null,areaKey:null,level:null,bio:null,trainer:false,lookingForGame:true,canRequestContact:true};
  s.setHandler(async path=>path==='/players/peer'?peer:path.startsWith('/me/contact-state?')?{targetPublicPlayerId:'peer',state:'none',canRequestContact:true}:{ok:true});
  const match={actor:s.auth.participation.getSnapshot().actor!,episode:1,self:{publicPlayerId:'self',displayName:'Я'},peer,receipt:interestReceipt};
  const before=s.calls.length;assert.equal(s.auth.contact.getSnapshot().target,null);
  assert.equal(await open(match,s.auth.contact,()=>false),null);assert.equal(s.calls.length,before);
  assert.equal(await open(match,s.auth.contact,()=>true),'/messages/new/peer');
  assert.equal(s.calls.some(c=>c.path==='/radar/results/preview'),false);
  assert.equal(s.calls.some(c=>c.init.method==='POST' && (c.path.includes('conversations') || c.path.includes('messages'))),false);
  s.setHandler(async path=>path==='/players/peer'?{...peer,canRequestContact:false}:{targetPublicPlayerId:'peer',state:'none',canRequestContact:false});
  assert.equal(await open(match,s.auth.contact,()=>true),null);
});

test('browse own hidden profile public-avatar 404 stays isolated from the authenticated catalog', async t => {
  t.mock.method(publicApi,'cities',async()=>[]);
  const own={publicPlayerId:'own-hidden',version:1,displayName:'Своё публичное имя',cityId:null,areaKey:null,level:null,bio:null,
    directoryVisible:false,contactPolicy:'closed',consentPolicyVersion:null,optedInAt:null,radarConsented:false,
    radarConsentPolicyVersion:null,radarConsentedAt:null,socialEligible:false,trainer:false,lookingForGame:null,
    avatar:{uploadedUrl:null,providerUrl:null}};
  const peer={publicPlayerId:'peer-visible',displayName:'Партнёр',cityId:null,areaKey:null,level:null,bio:null,trainer:false,lookingForGame:true};
  const page={items:[peer],nextCursor:null};
  const s=setup(sessionEnvelope());
  s.setHandler(async path=>{
    if(path==='/auth/native/refresh')return credentials;
    if(path==='/me')return me;
    if(path==='/me/social-profile')return own;
    if(path.startsWith('/players?'))return page;
    if(path==='/players/own-hidden')return new Response('{}',{status:404});
    throw new Error(`Unexpected route ${path}`);
  });
  await s.auth.hydrate();await s.auth.profile.load();
  await s.auth.players.loadList({cityId:null,name:'',looking:false,trainer:false});
  const before=s.auth.players.getSnapshot().list;
  assert.equal(before.status,'ready');
  // Execute the actual route effect so removing its isolated-detail flag fails this regression.
  const route=readFileSync(new URL('../app/players/browse.tsx',import.meta.url),'utf8');
  const effect=route.match(/useEffect\(\(\) => \{(\s*if \(focused && scope && ownId\)[\s\S]*?)\n {2}\}, \[focused, scope, ownId, auth.players\]\);/);
  assert.ok(effect);
  let pending:Promise<void>|undefined;
  const original=s.auth.players.loadDetail;
  t.mock.method(s.auth.players,'loadDetail',(id:string,isolated?:boolean)=>{pending=original(id,isolated);return pending;});
  runInNewContext(`(()=>{${effect[1]}})()`,{focused:true,scope:s.auth.players.getSnapshot().scope,ownId:own.publicPlayerId,auth:s.auth});
  assert.ok(pending);await pending;
  assert.equal(s.auth.players.getSnapshot().list,before);
  assert.deepEqual(s.auth.players.getSnapshot().list.data,page);
  assert.equal(s.auth.players.getSnapshot().detail.status,'error');
  assert.equal(s.auth.players.getSnapshot().detail.data,null);
  const mediaEffect=route.match(/useEffect\(\(\) => \{(\s*const detail = catalog.detail;[\s\S]*?)\n {2}\}, \[scope, ownId, own\?\.displayName, catalog.detail\]\);/);
  assert.ok(mediaEffect);
  let media:unknown={avatar:'previously-public'};
  runInNewContext(stripTypeScriptTypes(`(()=>{${mediaEffect[1]}})()`),{catalog:s.auth.players.getSnapshot(),scope:s.auth.players.getSnapshot().scope,
    ownId:own.publicPlayerId,own,setSelfMedia:(value:unknown)=>{media=value;}});
  assert.equal(media,null,'unavailable public media falls back to the authoritative own name');
  assert.deepEqual(s.auth.profile.getSnapshot().profile,own);
  assert.equal(s.auth.getSnapshot().status,'authenticated');
  assert.deepEqual(s.calls.filter(c=>c.path==='/players/own-hidden').map(c=>c.init.method),['GET']);
});

test('R3 guest hub/results login and pending restart retain exact Entry return and never auto-write postgame',async()=>{
  const {hydratedEntryRoute,emptyPreferences}=await import('../src/entry.ts');
  for(const path of ['/my-games','/my-games/selected-game_A/results']) {
    const normal=setup();await normal.auth.hydrate();assert.ok(await normal.auth.beginLogin(path));
    assert.equal(hydratedEntryRoute(emptyPreferences,true,normal.auth.getSnapshot()),'/profile');
    const pending=parseSecureEnvelope(normal.stored(),now)!.pending!;
    assert.equal(pending.returnPath,path);
    assert.equal(await normal.auth.callback(`${NATIVE_REDIRECT}?code=${token('c')}&state=${pending.state}`),path);
    assert.equal(hydratedEntryRoute(emptyPreferences,true,normal.auth.getSnapshot()),path);
    assert.equal(normal.auth.postgame.getSnapshot().actor?.actorId,me.id);
    assert.equal(normal.calls.filter(c=>/outcome|attendance|postgame-reminders/.test(c.path)).length,0);
    const first=setup();await first.auth.hydrate();await first.auth.beginLogin(path);
    const cold=setup(JSON.parse(first.stored()!));await cold.auth.hydrate();
    assert.equal(cold.auth.getSnapshot().status,'signing-in');assert.equal(hydratedEntryRoute(emptyPreferences,true,cold.auth.getSnapshot()),'/profile');
    const recovered=parseSecureEnvelope(cold.stored(),now)!.pending!;
    assert.equal(await cold.auth.callback(`${NATIVE_REDIRECT}?code=${token('c')}&state=${recovered.state}`),path);
    assert.equal(hydratedEntryRoute(emptyPreferences,true,cold.auth.getSnapshot()),path);
    assert.equal(cold.calls.filter(c=>c.init.method !== 'GET' && !c.path.startsWith('/auth/')).length,0);
    assert.equal(cold.auth.postgame.getSnapshot().command,null);
  }
  for(const path of ['/my-games?x=1','/my-games#x','/my-games\n','/my-games/a/results\n','/my-games/a/results?x=1','/my-games/%61/results','/my-games/a%2fb/results','/my-games/a/results/ack','//evil/my-games','https://dev.gobadminton.ru/my-games']) assert.equal(canonicalReturnPath(path),null,path);
});

test('real root postgame ports fence actor/game/context receipts and quarantine UNKNOWN until explicit sameactor reconcile',async()=>{
  const s=setup(sessionEnvelope());await s.auth.hydrate();let writes=0;
  const base={gameId:'selected-game',outcome:{value:'unknown',version:0,reason:null,provenance:null},allowedActions:{canRecordOutcome:true}};
  s.setHandler(async(path,init)=>{
    if(path === '/me') return me;
    if(path === '/games/selected-game/results') return base;
    if(path === '/games/selected-game/outcome') {writes++;assert.equal(init.method,'PUT');return new Response(JSON.stringify({code:'VERSION_CONFLICT'}),{status:503});}
    if(path.startsWith('/me/postgame-reminders'))return {items:[],installed:true,writesEnabled:true};
    return credentials;
  });
  await s.auth.postgame.loadResults('selected-game');s.auth.postgame.review({kind:'outcome',gameId:'selected-game',body:{expectedVersion:0,outcome:'held'}});await s.auth.postgame.confirm();
  const original=s.auth.postgame.getSnapshot().command!.packet;assert.equal(writes,1);
  await s.auth.postgame.loadResults('selected-game');assert.equal(s.auth.postgame.getSnapshot().command?.packet,original);
  s.setHandler(async()=>{throw new NativeAuthError('network');});await s.auth.validate();assert.equal(s.auth.postgame.getSnapshot().actor,null);assert.equal(s.auth.postgame.getSnapshot().command,null);
  s.setHandler(async path=>path === '/auth/methods' ? {items:[{method:'vk',type:'oauth',available:true}]} : {transactionId:token('t'),expiresAt:new Date(now+600000).toISOString(),browserStartUrl:`https://dev.gobadminton.ru/auth/native?transactionId=${token('t')}`});
  await s.auth.beginLogin('/my-games/selected-game/results');const resumedPending=parseSecureEnvelope(s.stored(),now)!.pending!;
  const verification=deferred<typeof me>();s.setHandler(async path=>path === '/me' ? verification.promise : credentials);
  const verifying=s.auth.callback(`${NATIVE_REDIRECT}?code=${token('c')}&state=${resumedPending.state}`);await new Promise(r=>setImmediate(r));assert.equal(s.auth.postgame.getSnapshot().actor,null);
  verification.resolve(me);await verifying;assert.equal(s.auth.postgame.getSnapshot().command?.packet,original);assert.equal(writes,1);
  s.setHandler(async(path,init)=>{
    if(path === '/games/selected-game/outcome') {writes++;assert.equal((init.headers as Record<string,string>)['Idempotency-Key'],original.key);assert.deepEqual(JSON.parse(String(init.body)),original.body);
      return {...base,outcome:{value:'held',version:1,reason:null,provenance:{source:'manager_explicit',recordedAt:new Date(now).toISOString(),createdAt:new Date(now).toISOString()}}};}
    if(path === '/games/selected-game/results')return base;
    return {items:[],installed:true,writesEnabled:true};
  });
  await s.auth.postgame.reconcile('selected-game');assert.equal(writes,2);assert.equal(s.auth.postgame.getSnapshot().command,null);
  await s.auth.logout();assert.equal(s.auth.postgame.getSnapshot().actor,null);assert.equal(s.auth.postgame.getSnapshot().command,null);
});

test('bare venue login and cold restore never auto write or expand arbitrary routes', async () => {
  const path = '/venues/00000000-0000-4000-8000-000000000001';
  const f = setup(); await f.auth.hydrate();
  await f.auth.beginLogin(path); assert.equal(f.auth.getSnapshot().returnPath,path);
  await f.auth.callback(callback); assert.equal(f.auth.getSnapshot().returnPath,path);
  assert.equal(f.calls.filter(c => /community-rating|\/comments|\/reports/.test(c.path)).length,0);
  for (const value of [path+'\n',path+'?vote=4',path+'#reply',path+'/comments',path.replace('venues','%76enues')]) assert.equal(canonicalReturnPath(value),null);
});

test('closed community ports use real same-actor auth, exact packet and permit; invalid bearer does not fetch guest comments', async () => {
  const {freezePacket} = await import('../src/venue-community.ts');
  const venueId='00000000-0000-4000-8000-000000000001';
  const s=setup(sessionEnvelope());await s.auth.hydrate();const actor=s.auth.participation.getSnapshot().actor!;
  const packet=freezePacket(actor,{venueId,canonicalVenueId:venueId},{kind:'upsert',value:4,expectedVersion:0},'00000000-0000-4000-8000-000000000002');
  s.setHandler(async()=>({ok:true}));
  await s.auth.communityOwn(venueId,actor);
  await assert.rejects(s.auth.communityMutation(packet,()=>false));
  assert.equal(s.calls.filter(c=>c.path===`/venues/${venueId}/community-rating`).length,0);
  await s.auth.communityMutation(packet,()=>true);
  const write=s.calls.find(c=>c.path===`/venues/${venueId}/community-rating`)!;
  assert.deepEqual(JSON.parse(String(write.init.body)),{expectedVersion:0,value:4});assert.equal(write.init.method,'PUT');
  s.setHandler(async()=>new Response('{}',{status:401}));
  const before=s.calls.length;
  await assert.rejects(s.auth.communityComments({venueId,order:'asc',parentCommentId:null,cursor:null},actor));
  assert.equal(s.auth.participation.getSnapshot().actor,null);
  const comments=s.calls.slice(before).filter(c=>c.path.includes('/comments'));
  assert.equal(comments.length,1);assert.match((comments[0]!.init.headers as Record<string,string>).Authorization!,/^Bearer /);
});

const roleHandle = 'a'.repeat(32);
const gameAuthorGoal: PublicRoleLocalGoal = {
  mode: 'author', role: 'organization', roleHandle, origin: { kind: 'game', gameId: 'same-game' },
};
const gameReaderGoal: PublicRoleLocalGoal = {
  mode: 'reader', role: 'organization', roleHandle, origin: { kind: 'game', gameId: 'same-game' },
};
const profileReaderGoal: PublicRoleLocalGoal = {
  mode: 'reader', role: 'training', roleHandle, origin: { kind: 'profile', publicPlayerId: 'public-peer-a' },
};

test('#522 family1: cold game-author goal survives stored-bytes restart; duplicate callback exchanges once; blank claim; zero business writes', async () => {
  const path = publicRoleGoalPath(gameAuthorGoal)!;
  assert.equal(path, '/games/same-game');
  const first = setup(); await first.auth.hydrate();
  assert.ok(await first.auth.beginLogin(path, gameAuthorGoal));
  const pending = parseSecureEnvelope(first.stored(), now)!.pending!;
  assert.deepEqual(pending.goal, gameAuthorGoal);
  assert.equal(JSON.stringify(pending).includes('consent'), false);
  assert.equal(JSON.stringify(pending).includes('displayName'), false);
  // Reconstruct coordinator from durable bytes (process death before callback).
  const cold = setup(JSON.parse(first.stored()!)); await cold.auth.hydrate();
  assert.equal(cold.auth.getSnapshot().status, 'signing-in');
  assert.deepEqual(parseSecureEnvelope(cold.stored(), now)!.pending!.goal, gameAuthorGoal);
  const verified = deferred<typeof me>();
  cold.setHandler(async path => path === '/me' ? verified.promise : credentials);
  const a = cold.auth.callback(`${NATIVE_REDIRECT}?code=${token('c')}&state=${pending.state}`);
  const b = cold.auth.callback(`${NATIVE_REDIRECT}?code=${token('c')}&state=${pending.state}`);
  await new Promise(r => setImmediate(r));
  assert.equal(cold.auth.postgame.getSnapshot().publicSurface, null);
  verified.resolve(me);
  assert.deepEqual(await Promise.all([a, b]), [path, path]);
  assert.equal(cold.calls.filter(c => c.path === '/auth/native/exchange').length, 1);
  const secure = parseSecureEnvelope(cold.stored(), now)!;
  assert.equal(secure.pending, undefined);
  assert.deepEqual(secure.unclaimedPublicRoleGoal && {
    mode: secure.unclaimedPublicRoleGoal.mode,
    role: secure.unclaimedPublicRoleGoal.role,
    roleHandle: secure.unclaimedPublicRoleGoal.roleHandle,
    origin: secure.unclaimedPublicRoleGoal.origin,
  }, gameAuthorGoal);
  const claimed = await cold.auth.claimPublicRoleGoal();
  assert.deepEqual(claimed, gameAuthorGoal);
  assert.equal(parseSecureEnvelope(cold.stored(), now)!.unclaimedPublicRoleGoal, undefined);
  assert.equal(await cold.auth.claimPublicRoleGoal(), null);
  assert.equal(cold.calls.filter(c => c.init.method && c.init.method !== 'GET' && !c.path.startsWith('/auth/')).length, 0);
  assert.equal(cold.auth.postgame.getSnapshot().publicDraft, null);
  assert.equal(cold.auth.postgame.getSnapshot().publicConsentHash, null);
});

test('#522 family2: profile and game reader goals restore typed origin; metadata stays out of transaction/callback', async () => {
  for (const goal of [profileReaderGoal, gameReaderGoal]) {
    const path = publicRoleGoalPath(goal)!;
    assert.equal(canonicalReturnPath(path), path);
    const s = setup(); await s.auth.hydrate();
    assert.ok(await s.auth.beginLogin(path, goal));
    const pending = parseSecureEnvelope(s.stored(), now)!.pending!;
    assert.deepEqual(pending.goal, goal);
    const tx = s.calls.find(c => c.path === '/auth/native/transactions')!;
    const body = JSON.parse(String(tx.init.body));
    assert.equal(body.returnPath, path);
    assert.equal('goal' in body, false);
    assert.equal(JSON.stringify(body).includes(roleHandle), false);
    assert.equal(await s.auth.callback(`${NATIVE_REDIRECT}?code=${token('c')}&state=${pending.state}`), path);
    const claimed = await s.auth.claimPublicRoleGoal();
    assert.deepEqual(claimed, goal);
  }
  assert.equal(canonicalPlayerPath('/players/browse'), null);
  assert.equal(canonicalPlayerPath('/players/public-peer-a'), '/players/public-peer-a');
  assert.equal(canonicalReturnPath('/players/browse'), '/players/browse');
});

test('#522 family3: post-commit pre-claim restart reopens once; second restart and failed clear never open', async () => {
  const path = publicRoleGoalPath(gameAuthorGoal)!;
  const first = setup(); await first.auth.hydrate();
  assert.ok(await first.auth.beginLogin(path, gameAuthorGoal));
  const pending = parseSecureEnvelope(first.stored(), now)!.pending!;
  assert.equal(await first.auth.callback(`${NATIVE_REDIRECT}?code=${token('c')}&state=${pending.state}`), path);
  const mid = JSON.parse(first.stored()!);
  assert.ok(mid.unclaimedPublicRoleGoal);
  // Death after session commit, before host claim.
  const resumed = setup(mid); await resumed.auth.hydrate();
  assert.equal(resumed.auth.getSnapshot().status, 'authenticated');
  const once = await resumed.auth.claimPublicRoleGoal();
  assert.deepEqual(once, gameAuthorGoal);
  assert.equal(parseSecureEnvelope(resumed.stored(), now)!.unclaimedPublicRoleGoal, undefined);
  // Second restart after successful claim — nothing left to open.
  const again = setup(JSON.parse(resumed.stored()!)); await again.auth.hydrate();
  assert.equal(await again.auth.claimPublicRoleGoal(), null);
  // Failed durable clear write must not hand a goal to the host.
  const blocked = setup(mid); await blocked.auth.hydrate();
  const realSet = blocked.store.setItem.bind(blocked.store);
  blocked.store.setItem = async () => { throw new Error('disk full'); };
  assert.equal(await blocked.auth.claimPublicRoleGoal(), null);
  blocked.store.setItem = realSet;
  assert.equal(blocked.auth.getSnapshot().notice, 'storage');
});

test('#522 family4: cancel/expiry/unavailable then generic login; obsolete cancel cannot clear newer pending', async () => {
  const path = publicRoleGoalPath(gameAuthorGoal)!;
  const cancelled = setup(); await cancelled.auth.hydrate();
  cancelled.auth.postgame.rememberPendingPublicAuthor({ roleHandle, role: 'organization', gameId: 'same-game' });
  assert.ok(await cancelled.auth.beginLogin(path, gameAuthorGoal));
  const gen = parseSecureEnvelope(cancelled.stored(), now)!.generation;
  await cancelled.auth.cancelLogin(gen);
  assert.equal(cancelled.auth.postgame.getSnapshot().pendingPublicAuthor, null);
  assert.equal(parseSecureEnvelope(cancelled.stored(), now)?.pending, undefined);
  assert.ok(await cancelled.auth.beginLogin('/games/create'));
  assert.equal(parseSecureEnvelope(cancelled.stored(), now)!.pending!.goal, undefined);
  assert.equal(await cancelled.auth.callback(
    `${NATIVE_REDIRECT}?code=${token('c')}&state=${parseSecureEnvelope(cancelled.stored(), now)!.pending!.state}`,
  ), '/games/create');
  assert.equal(await cancelled.auth.claimPublicRoleGoal(), null);

  const expired = setup(); await expired.auth.hydrate();
  assert.ok(await expired.auth.beginLogin(path, gameAuthorGoal));
  const stalePending = parseSecureEnvelope(expired.stored(), now)!;
  const past = { ...stalePending, pending: { ...stalePending.pending!, expiresAt: now - 1 } };
  const coldExpired = setup(past); await coldExpired.auth.hydrate();
  assert.equal(coldExpired.auth.getSnapshot().status, 'guest');
  assert.equal(parseSecureEnvelope(coldExpired.stored(), now)?.pending, undefined);

  const unavailable = setup(); await unavailable.auth.hydrate();
  unavailable.auth.postgame.rememberPendingPublicReader({
    roleHandle, role: 'organization', origin: { kind: 'game', gameId: 'same-game' },
  });
  unavailable.setHandler(async path => path === '/auth/methods'
    ? { items: [{ method: 'vk', type: 'oauth', available: false }] }
    : credentials);
  assert.equal(await unavailable.auth.beginLogin(path, gameAuthorGoal), null);
  assert.equal(unavailable.auth.postgame.getSnapshot().pendingPublicReader, null);

  const race = setup(); await race.auth.hydrate();
  assert.ok(await race.auth.beginLogin(path, gameAuthorGoal));
  const oldGen = parseSecureEnvelope(race.stored(), now)!.generation;
  assert.ok(await race.auth.beginLogin(path, gameAuthorGoal));
  const newer = parseSecureEnvelope(race.stored(), now)!;
  assert.notEqual(newer.generation, oldGen);
  await race.auth.cancelLogin(oldGen);
  assert.ok(parseSecureEnvelope(race.stored(), now)!.pending);
  assert.deepEqual(parseSecureEnvelope(race.stored(), now)!.pending!.goal, gameAuthorGoal);
});

test('#522 family5: logout and account switch drop unclaimed goals; delayed claim cannot inherit', async () => {
  const path = publicRoleGoalPath(gameAuthorGoal)!;
  const s = setup(); await s.auth.hydrate();
  assert.ok(await s.auth.beginLogin(path, gameAuthorGoal));
  const pending = parseSecureEnvelope(s.stored(), now)!.pending!;
  assert.equal(await s.auth.callback(`${NATIVE_REDIRECT}?code=${token('c')}&state=${pending.state}`), path);
  assert.ok(parseSecureEnvelope(s.stored(), now)!.unclaimedPublicRoleGoal);
  await s.auth.logout();
  assert.equal(parseSecureEnvelope(s.stored(), now)?.unclaimedPublicRoleGoal, undefined);
  assert.equal(await s.auth.claimPublicRoleGoal(), null);

  const switcher = setup(); await switcher.auth.hydrate();
  assert.ok(await switcher.auth.beginLogin(path, gameAuthorGoal));
  const login = parseSecureEnvelope(switcher.stored(), now)!.pending!;
  const verified = deferred<typeof me>();
  switcher.setHandler(async p => p === '/me' ? verified.promise : { ...credentials, sessionId: 'goal-session' });
  const work = switcher.auth.callback(`${NATIVE_REDIRECT}?code=${token('c')}&state=${login.state}`);
  await new Promise(r => setImmediate(r));
  await switcher.auth.logout();
  verified.resolve({ ...me, session: { ...me.session, id: 'goal-session' } });
  assert.equal(await work, null);
  assert.equal(await switcher.auth.claimPublicRoleGoal(), null);
});

test('#522 family6: legacy v1 / future envelope / adversarial goals fail closed without private retention', async () => {
  assert.deepEqual(parsePublicRoleLocalGoal({
    ...gameAuthorGoal, consent: true, text: 'leak', command: { key: 'x' }, displayName: 'Secret',
  }, '/games/same-game'), gameAuthorGoal);
  assert.equal(parsePublicRoleLocalGoal({
    mode: 'author', role: 'organization', roleHandle, origin: { kind: 'profile', publicPlayerId: 'peer' },
  }, '/players/peer'), null);
  assert.equal(parsePublicRoleLocalGoal(gameAuthorGoal, '/games/other'), null);
  assert.equal(parsePublicRoleLocalGoal({
    mode: 'reader', role: 'organization', roleHandle, origin: { kind: 'profile', publicPlayerId: 'browse' },
  }, '/players/browse'), null);
  for (const bad of [
    '/players/peer?x=1', '/players/peer#x', '/players/peer\n', '/players/%70eer', '/players/peer/extra',
    '/games/same-game?role=1', '//evil/players/peer',
  ]) assert.equal(canonicalReturnPath(bad), null, bad);

  const legacy = { version: 1, generation: token('g'), returnPath: '/games/same-game', pending: {
    generation: token('g'), clientId: NATIVE_CLIENT_ID, redirectUri: NATIVE_REDIRECT,
    verifier: token('v'), state: token('s'), transactionId: token('t'), expiresAt: now + 600000,
    returnPath: '/games/same-game',
  } };
  assert.deepEqual(parseSecureEnvelope(JSON.stringify(legacy), now)?.pending?.goal, undefined);

  const injected = {
    version: 1, generation: token('g'), returnPath: '/games/same-game',
    pending: {
      ...legacy.pending,
      goal: { ...gameAuthorGoal, draft: 'x', receiptToken: 'r', idempotencyKey: 'k' },
    },
  };
  const parsed = parseSecureEnvelope(JSON.stringify(injected), now)!;
  assert.deepEqual(parsed.pending!.goal, gameAuthorGoal);
  assert.equal(JSON.stringify(parsed.pending!.goal).includes('draft'), false);

  const future = { version: 2, generation: token('g'), returnPath: null, pending: legacy.pending };
  const frozen = setup(future); await frozen.auth.hydrate();
  assert.equal(frozen.auth.getSnapshot().notice, 'storage');
  assert.equal(frozen.stored(), JSON.stringify(future));
  assert.equal(await frozen.auth.beginLogin('/games/same-game', gameAuthorGoal), null);
});

test('#522 QA1: concurrent claims with delayed clear yield exactly one non-null goal', async () => {
  const path = publicRoleGoalPath(gameAuthorGoal)!;
  const first = setup(); await first.auth.hydrate();
  assert.ok(await first.auth.beginLogin(path, gameAuthorGoal));
  const pending = parseSecureEnvelope(first.stored(), now)!.pending!;
  assert.equal(await first.auth.callback(`${NATIVE_REDIRECT}?code=${token('c')}&state=${pending.state}`), path);
  const mid = JSON.parse(first.stored()!);
  assert.ok(mid.unclaimedPublicRoleGoal);
  const s = setup(mid); await s.auth.hydrate();
  const gate = deferred<void>();
  const realSet = s.store.setItem.bind(s.store);
  s.store.setItem = async (key, value) => { await gate.promise; return realSet(key, value); };
  const a = s.auth.claimPublicRoleGoal();
  const b = s.auth.claimPublicRoleGoal();
  await new Promise(r => setImmediate(r));
  gate.resolve();
  const results = await Promise.all([a, b]);
  assert.equal(results.filter(goal => goal !== null).length, 1);
  assert.deepEqual(results.find(goal => goal !== null), gameAuthorGoal);
  assert.equal(parseSecureEnvelope(s.stored(), now)!.unclaimedPublicRoleGoal, undefined);
  assert.equal(await s.auth.claimPublicRoleGoal(), null);
});

test('#522 QA1: cancel while exchange/me blocked retires goal; obsolete cancel preserves newer pending', async () => {
  const path = publicRoleGoalPath(gameAuthorGoal)!;
  const blocked = setup(); await blocked.auth.hydrate();
  assert.ok(await blocked.auth.beginLogin(path, gameAuthorGoal));
  const login = parseSecureEnvelope(blocked.stored(), now)!.pending!;
  const generation = login.generation;
  const meGate = deferred<typeof me>();
  blocked.setHandler(async p => p === '/me' ? meGate.promise : credentials);
  const work = blocked.auth.callback(`${NATIVE_REDIRECT}?code=${token('c')}&state=${login.state}`);
  await new Promise(r => setImmediate(r));
  assert.equal(parseSecureEnvelope(blocked.stored(), now)?.pending, undefined);
  await blocked.auth.cancelLogin(generation);
  assert.equal(blocked.auth.getSnapshot().status, 'guest');
  assert.equal(blocked.auth.getSnapshot().notice, 'cancelled');
  meGate.resolve(me);
  assert.equal(await work, null);
  assert.equal(parseSecureEnvelope(blocked.stored(), now)?.unclaimedPublicRoleGoal, undefined);
  assert.equal(await blocked.auth.claimPublicRoleGoal(), null);

  const race = setup(); await race.auth.hydrate();
  assert.ok(await race.auth.beginLogin(path, gameAuthorGoal));
  const oldGen = parseSecureEnvelope(race.stored(), now)!.generation;
  assert.ok(await race.auth.beginLogin(path, gameAuthorGoal));
  const newer = parseSecureEnvelope(race.stored(), now)!;
  assert.notEqual(newer.generation, oldGen);
  await race.auth.cancelLogin(oldGen);
  assert.ok(parseSecureEnvelope(race.stored(), now)!.pending);
  assert.deepEqual(parseSecureEnvelope(race.stored(), now)!.pending!.goal, gameAuthorGoal);
});

test('#522 QA1: deadline crossing during delayed claim store never hands off', async () => {
  const path = publicRoleGoalPath(gameAuthorGoal)!;
  let clock = now - 1;
  let stored: string | null = JSON.stringify({
    version: 1,
    generation: token('g'),
    returnPath: path,
    session: {
      refreshToken: credentials.refreshToken, sessionId: me.session.id, actorId: me.id,
      refreshExpiresAt: credentials.refreshExpiresAt, refreshAbsoluteExpiresAt: credentials.refreshAbsoluteExpiresAt,
    },
    unclaimedPublicRoleGoal: {
      ...gameAuthorGoal, generation: token('g'), expiresAt: now, actorId: me.id, sessionId: me.session.id,
    },
  });
  let serial = 0;
  let advanceOnWrite = false;
  const writes: string[] = [];
  const auth = new AuthCoordinator({
    api: createNativeApi(async (url) => {
      const p = String(url).replace('https://dev.gobadminton.ru/v1', '');
      if (p === '/me') return new Response(JSON.stringify(me));
      if (p === '/auth/native/refresh') return new Response(JSON.stringify(credentials));
      return new Response(JSON.stringify(credentials));
    }),
    store: {
      getItem: async () => stored,
      setItem: async (_key, value) => {
        if (advanceOnWrite) {
          await new Promise<void>(resolve => setImmediate(resolve));
          clock = now + 1;
        }
        stored = value;
        writes.push(value);
      },
    },
    random: () => String.fromCharCode(65 + serial++).repeat(43),
    challenge: async verifier => createHash('sha256').update(verifier).digest('base64url'),
    now: () => clock,
  });
  await auth.hydrate();
  assert.equal(auth.getSnapshot().status, 'authenticated');
  advanceOnWrite = true;
  assert.equal(await auth.claimPublicRoleGoal(), null);
  assert.equal(parseSecureEnvelope(stored, clock)?.unclaimedPublicRoleGoal, undefined);
  assert.equal(auth.getSnapshot().status, 'authenticated');
});

test('#522 QA1: cold hydrate and warm validate durably retire expired pending goal bytes', async () => {
  const path = publicRoleGoalPath(gameAuthorGoal)!;
  const seeded = setup(); await seeded.auth.hydrate();
  assert.ok(await seeded.auth.beginLogin(path, gameAuthorGoal));
  const expired = JSON.parse(seeded.stored()!);
  expired.pending.expiresAt = now - 1;

  const cold = setup(expired);
  await cold.auth.hydrate();
  assert.equal(cold.auth.getSnapshot().status, 'guest');
  assert.equal(cold.auth.getSnapshot().returnPath, path);
  const coldBytes = JSON.parse(cold.stored()!);
  assert.equal(coldBytes.pending, undefined);
  assert.equal(coldBytes.unclaimedPublicRoleGoal, undefined);
  assert.equal(coldBytes.returnPath, path);

  let clock = now;
  let bytes: string | null = null;
  let serial = 0;
  const warm = new AuthCoordinator({
    api: createNativeApi(async (url) => {
      const p = String(url).replace('https://dev.gobadminton.ru/v1', '');
      if (p === '/auth/methods') {
        return new Response(JSON.stringify({ items: [{ method: 'vk', type: 'oauth', available: true }] }));
      }
      if (p === '/auth/native/transactions') {
        return new Response(JSON.stringify({
          transactionId: token('t'),
          expiresAt: new Date(clock + 600000).toISOString(),
          browserStartUrl: `https://dev.gobadminton.ru/auth/native?transactionId=${token('t')}`,
        }));
      }
      if (p === '/me') return new Response(JSON.stringify(me));
      return new Response(JSON.stringify(credentials));
    }),
    store: {
      getItem: async () => bytes,
      setItem: async (_key, value) => { bytes = value; },
    },
    random: () => String.fromCharCode(65 + serial++).repeat(43),
    challenge: async verifier => createHash('sha256').update(verifier).digest('base64url'),
    now: () => clock,
  });
  await warm.hydrate();
  assert.ok(await warm.beginLogin(path, gameAuthorGoal));
  assert.equal(warm.getSnapshot().status, 'signing-in');
  const pending = parseSecureEnvelope(bytes, clock)!.pending!;
  assert.deepEqual(pending.goal, gameAuthorGoal);
  clock = pending.expiresAt + 1;
  await warm.validate();
  assert.equal(warm.getSnapshot().status, 'guest');
  assert.equal(warm.getSnapshot().notice, 'signin');
  assert.equal(warm.getSnapshot().returnPath, path);
  const retired = JSON.parse(bytes!);
  assert.equal(retired.pending, undefined);
  assert.equal(retired.returnPath, path);
});

test('#522 QA2: cold expiry cleanup SecureStore write failure fail-closes hydrate (not guest+writable)', async () => {
  const path = publicRoleGoalPath(gameAuthorGoal)!;
  const seeded = setup(); await seeded.auth.hydrate();
  assert.ok(await seeded.auth.beginLogin(path, gameAuthorGoal));
  const expired = JSON.parse(seeded.stored()!);
  expired.pending.expiresAt = now - 1;
  // Keep raw expired pending bytes; cold parse drops them from memory and must rewrite.
  const raw = JSON.stringify(expired);
  let serial = 0;
  let writeCount = 0;
  const auth = new AuthCoordinator({
    api: createNativeApi(async () => new Response(JSON.stringify(credentials))),
    store: {
      getItem: async () => raw,
      setItem: async () => {
        writeCount += 1;
        throw new Error('disk full');
      },
    },
    random: () => String.fromCharCode(65 + serial++).repeat(43),
    challenge: async verifier => createHash('sha256').update(verifier).digest('base64url'),
    now: () => now,
  });
  await auth.hydrate();
  assert.equal(writeCount, 1);
  assert.equal(auth.getSnapshot().status, 'unverifiable');
  assert.equal(auth.getSnapshot().notice, 'storage');
  // Expired goal bytes remain in store; fail-closed must block a subsequent login write path.
  assert.equal(await auth.beginLogin(path), null);
  assert.equal(auth.getSnapshot().status, 'unverifiable');
  assert.equal(auth.getSnapshot().notice, 'storage');
});
test('#522 APK44: game-contact preference AuthCoordinator fences, PATCH transport, creation prefill untouched', async t => {
  const s = setup(sessionEnvelope());
  await s.auth.hydrate();
  const owner = s.auth.gameContactPreference;
  const calls: { path: string; method?: string; body?: unknown; key?: string }[] = [];
  let preference = { version: 0, defaultPublicGameContact: null as string | null };
  s.setHandler(async (path, init) => {
    if (path === '/me') return me;
    if (path === '/auth/native/refresh') return credentials;
    if (path === '/me/game-preferences') {
      calls.push({
        path,
        method: init.method,
        body: init.body ? JSON.parse(String(init.body)) : undefined,
        key: (init.headers as Record<string, string> | undefined)?.['Idempotency-Key'],
      });
      if ((init.method ?? 'GET') === 'PATCH') {
        const body = JSON.parse(String(init.body)) as { expectedVersion: number; defaultPublicGameContact: string | null };
        preference = { version: body.expectedVersion + 1, defaultPublicGameContact: body.defaultPublicGameContact };
        return preference;
      }
      return preference;
    }
    if (path === '/me/social-profile') return { cityId: 'city-1', trainer: false, displayName: 'Creator' };
    return { ok: true };
  });
  await owner.load();
  assert.equal(calls.some(c => c.method === 'PATCH'), false);
  owner.updateDraft('telegram:@auth');
  await owner.save();
  const save = calls.find(c => c.method === 'PATCH');
  assert.ok(save);
  assert.deepEqual(save!.body, { expectedVersion: 0, defaultPublicGameContact: 'telegram:@auth' });
  assert.ok(save!.key && save!.key.length >= 16);
  assert.equal(owner.getSnapshot().preference?.defaultPublicGameContact, 'telegram:@auth');

  await s.auth.refresh();
  assert.strictEqual(s.auth.gameContactPreference, owner);
  assert.equal(owner.getSnapshot().preference?.defaultPublicGameContact, 'telegram:@auth');

  // Creation prefill uses ordinary GET; later preference save must not overwrite user-edited create form.
  t.mock.method(publicApi, 'venues', async () => ({ items: [fixture.venue], nextCursor: null }));
  const management = s.auth.gameManagement;
  await management.loadContext('city-1');
  assert.equal(management.getSnapshot().form.contact, 'telegram:@auth');
  management.update({ contact: '@user-edited' });
  assert.equal(management.getSnapshot().form.contact, '@user-edited');
  owner.updateDraft('telegram:@other');
  await owner.save();
  assert.equal(management.getSnapshot().form.contact, '@user-edited');
  assert.equal(owner.getSnapshot().preference?.defaultPublicGameContact, 'telegram:@other');

  const patchCount = calls.filter(c => c.method === 'PATCH').length;
  await s.auth.logout();
  assert.equal(owner.getSnapshot().actor, null);
  assert.equal(owner.getSnapshot().command, undefined);
  assert.equal(owner.getSnapshot().preference, null);
  owner.updateDraft('@guest');
  await owner.save();
  assert.equal(calls.filter(c => c.method === 'PATCH').length, patchCount);
});
test('#522 APK48: court-booking AuthCoordinator fences, GET/PUT transport, no auto-write', async () => {
  const s = setup(sessionEnvelope());
  await s.auth.hydrate();
  const owner = s.auth.gameCourtBooking;
  const gameId = '10000000-0000-4000-8000-000000000010';
  const calls: { path: string; method?: string; body?: unknown; key?: string }[] = [];
  let row = {
    gameId, status: 'unspecified', version: 0, updatedAt: null as string | null,
    declarationSource: 'organizer_declared', allowedActions: { canUpdate: true },
  };
  s.setHandler(async (path, init) => {
    if (path === '/me') return me;
    if (path === '/auth/native/refresh') return credentials;
    if (path === `/games/${gameId}/court-booking`) {
      calls.push({
        path,
        method: init.method,
        body: init.body ? JSON.parse(String(init.body)) : undefined,
        key: (init.headers as Record<string, string> | undefined)?.['Idempotency-Key'],
      });
      if ((init.method ?? 'GET') === 'PUT') {
        const body = JSON.parse(String(init.body)) as { expectedVersion: number; status: string };
        row = {
          ...row,
          status: body.status,
          version: body.expectedVersion + 1,
          updatedAt: '2026-11-24T12:00:00.000Z',
        };
        return row;
      }
      return row;
    }
    if (path.startsWith('/me/games')) return { items: [{ id: gameId, management: { role: 'owner', createdByMe: true } }], nextCursor: null };
    return { ok: true };
  });
  // Managed proof needs parent membership ready (GameManagement detail).
  s.auth.gameManagement.getSnapshot().details[gameId] = {
    status: 'ready',
    management: { role: 'owner', createdByMe: true },
    participants: [],
    cursor: null,
    roster: 'ready',
  };
  owner.focus(gameId, 'managed');
  await owner.load();
  assert.equal(calls.some(c => c.method === 'PUT'), false);
  assert.equal(owner.getSnapshot().booking?.version, 0);
  owner.updateDraft('arranging');
  await owner.save();
  const put = calls.find(c => c.method === 'PUT');
  assert.ok(put);
  assert.deepEqual(put!.body, { expectedVersion: 0, status: 'arranging' });
  assert.ok(put!.key && put!.key.length >= 16);
  assert.equal(owner.getSnapshot().booking?.status, 'arranging');

  await s.auth.refresh();
  assert.strictEqual(s.auth.gameCourtBooking, owner);
  assert.equal(owner.getSnapshot().booking?.status, 'arranging');

  const putCount = calls.filter(c => c.method === 'PUT').length;
  await s.auth.logout();
  assert.equal(owner.getSnapshot().actor, null);
  assert.equal(owner.getSnapshot().command, undefined);
  assert.equal(owner.getSnapshot().booking, null);
  owner.updateDraft('not_arranged');
  await owner.save();
  assert.equal(calls.filter(c => c.method === 'PUT').length, putCount);
});

test('#522 APK52/FIX3: AuthCoordinator saveCreationCover openView+transport; create-view retire → zero PUT', async t => {
  async function run(retireView: boolean) {
    const s = setup(sessionEnvelope());
    await s.auth.hydrate();
    t.mock.method(publicApi, 'venues', async () => ({ items: [fixture.venue], nextCursor: null }));
    const management = s.auth.gameManagement;
    const cover = s.auth.gameCover;
    const gameId = retireView
      ? '10000000-0000-4000-8000-000000000153'
      : '10000000-0000-4000-8000-000000000152';
    const hex = 'ab'.repeat(32);
    const gameUrl = `/v1/media/game-covers/${hex}.png`;
    const draft = { ...fixture, id: gameId, status: 'draft' as const, version: 7 };
    const puts: string[] = [];
    let row = { version: 7, hasCover: false, cover: { uploadedUrl: null as string | null } };
    let latest: Omit<typeof draft, 'status'> & { status: 'draft' | 'published' } = { ...draft };
    const createGate = deferred<typeof draft>();
    s.setHandler(async (path, init) => {
      if (path === '/me') return me;
      if (path === '/auth/native/refresh') return credentials;
      if (path === '/me/social-profile') return { cityId: 'city-1', trainer: false, displayName: 'Creator' };
      if (path === '/me/game-preferences') return { version: 0, defaultPublicGameContact: null };
      if (path === `/games/${gameId}/cover`) {
        if ((init.method ?? 'GET') === 'PUT') {
          puts.push('PUT');
          row = { version: row.version + 1, hasCover: true, cover: { uploadedUrl: gameUrl } };
          latest = { ...latest, version: row.version };
          return row;
        }
        return row;
      }
      if (path.startsWith('/me/games')) {
        return { items: [{ ...latest, version: latest.version, management: { role: 'owner', createdByMe: true } }], nextCursor: null };
      }
      if (path === `/games/${gameId}`) return { ...latest };
      if (path === '/games' && (init.method ?? 'GET') === 'POST') {
        if (retireView) return createGate.promise;
        latest = { ...draft };
        return draft;
      }
      if (path === `/games/${gameId}/publish`) {
        latest = { ...draft, status: 'published', version: row.version + 1 };
        return latest;
      }
      if (path.includes('/participations')) return { items: [], nextCursor: null };
      return { ok: true };
    });

    await management.loadContext('city-1');
    management.update({ venueId: fixture.venue.id, date: '2026-11-20', time: '18:30', contact: '@creator' });
    management.preview();
    management.setCreationPhoto({ mime: 'image/jpeg', bytes: new Uint8Array([255, 216, 255, 217]) });
    const release = management.bindCreationView();
    if (!retireView) {
      await management.publishPreview();
      assert.equal(puts.length, 1);
      assert.equal(management.getSnapshot().created?.status, 'published');
      assert.equal(cover.getSnapshot().access?.hasCover, true);
      release();
      return;
    }
    const work = management.publishPreview();
    await new Promise(r => setImmediate(r));
    release();
    createGate.resolve(draft);
    await work;
    assert.equal(puts.length, 0);
    assert.equal(management.getSnapshot().created?.status, 'draft');
    assert.equal(management.getSnapshot().created?.id, gameId);
  }

  await run(false);
  await run(true);
});

test('#522 FIX4: deferred token after create-view retire during cover mutate → zero PUT', async t => {
  const s = setup(sessionEnvelope());
  await s.auth.hydrate();
  t.mock.method(publicApi, 'venues', async () => ({ items: [fixture.venue], nextCursor: null }));
  const management = s.auth.gameManagement;
  const gameId = '10000000-0000-4000-8000-000000000154';
  const hex = 'ab'.repeat(32);
  const gameUrl = `/v1/media/game-covers/${hex}.png`;
  const draft = { ...fixture, id: gameId, status: 'draft' as const, version: 7 };
  const puts: string[] = [];
  const refreshGate = deferred<typeof credentials>();
  let row = { version: 7, hasCover: false, cover: { uploadedUrl: null as string | null } };
  let expireForMutate = false;
  s.setHandler(async (path, init) => {
    if (path === '/me') return me;
    if (path === '/auth/native/refresh') return expireForMutate ? refreshGate.promise : credentials;
    if (path === '/me/social-profile') return { cityId: 'city-1', trainer: false, displayName: 'Creator' };
    if (path === '/me/game-preferences') return { version: 0, defaultPublicGameContact: null };
    if (path === `/games/${gameId}/cover`) {
      if ((init.method ?? 'GET') === 'PUT') {
        puts.push('PUT');
        row = { version: row.version + 1, hasCover: true, cover: { uploadedUrl: gameUrl } };
        return row;
      }
      // After authoritative cover GET for create→cover, expire so mutate awaits refresh.
      if (expireForMutate) {
        const access = (s.auth as unknown as { access: { expiresAt: number } | null }).access;
        if (access) access.expiresAt = 0;
      }
      return row;
    }
    if (path.startsWith('/me/games')) {
      return { items: [{ ...draft, version: row.version, management: { role: 'owner', createdByMe: true } }], nextCursor: null };
    }
    if (path === `/games/${gameId}`) return { ...draft, version: row.version, status: 'draft' };
    if (path === '/games' && (init.method ?? 'GET') === 'POST') {
      expireForMutate = true;
      return draft;
    }
    if (path === `/games/${gameId}/publish`) {
      return { ...draft, status: 'published', version: row.version + 1 };
    }
    if (path.includes('/participations')) return { items: [], nextCursor: null };
    return { ok: true };
  });
  await management.loadContext('city-1');
  management.update({ venueId: fixture.venue.id, date: '2026-11-20', time: '18:30', contact: '@creator' });
  management.preview();
  management.setCreationPhoto({ mime: 'image/jpeg', bytes: new Uint8Array([255, 216, 255, 217]) });
  const release = management.bindCreationView();
  const work = management.publishPreview();
  await new Promise(r => setImmediate(r));
  await new Promise(r => setImmediate(r));
  assert.equal(management.getSnapshot().created?.status, 'draft');
  // Late boundary: retire create lease while cover mutate token refresh is deferred.
  release();
  refreshGate.resolve(credentials);
  await work;
  assert.equal(puts.length, 0);
  assert.equal(management.getSnapshot().created?.status, 'draft');
  assert.equal(management.getSnapshot().created?.id, gameId);
});

test('#522 FIX4: deferred profile/token during create-publish after lease retire → zero publish POST', async t => {
  const s = setup(sessionEnvelope());
  await s.auth.hydrate();
  t.mock.method(publicApi, 'venues', async () => ({ items: [fixture.venue], nextCursor: null }));
  const management = s.auth.gameManagement;
  const gameId = '10000000-0000-4000-8000-000000000155';
  const draft = { ...fixture, id: gameId, status: 'draft' as const, version: 7 };
  const publishPosts: string[] = [];
  const profileGate = deferred<unknown>();
  let profileReads = 0;
  s.setHandler(async (path, init) => {
    if (path === '/me') return me;
    if (path === '/auth/native/refresh') return credentials;
    if (path === '/me/social-profile') {
      profileReads += 1;
      if (profileReads > 1) return profileGate.promise;
      return { cityId: 'city-1', trainer: false, displayName: 'Creator' };
    }
    if (path === '/me/game-preferences') return { version: 0, defaultPublicGameContact: null };
    if (path.startsWith('/me/games')) {
      return { items: [{ ...draft, management: { role: 'owner', createdByMe: true } }], nextCursor: null };
    }
    if (path === `/games/${gameId}`) return { ...draft, status: 'draft' };
    if (path === '/games' && (init.method ?? 'GET') === 'POST') return draft;
    if (path === `/games/${gameId}/publish`) {
      publishPosts.push(path);
      return { ...draft, status: 'published', version: 8 };
    }
    if (path.includes('/participations')) return { items: [], nextCursor: null };
    return { ok: true };
  });
  await management.loadContext('city-1');
  management.update({ venueId: fixture.venue.id, date: '2026-11-20', time: '18:30', contact: '@creator' });
  management.preview();
  // Omit photo → create→publish; retire during publish profile await.
  const release = management.bindCreationView();
  const work = management.publishPreview();
  await new Promise(r => setImmediate(r));
  assert.equal(management.getSnapshot().created?.status, 'draft');
  release();
  profileGate.resolve({ cityId: 'city-1', trainer: false, displayName: 'Creator' });
  await work;
  assert.equal(publishPosts.length, 0);
  assert.equal(management.getSnapshot().created?.status, 'draft');
  assert.deepEqual(management.getSnapshot().creationReference, { id: gameId, version: 7 });
});

test('#522 FIX8: deferred token during initial create after view retire → zero POST /games', async t => {
  const s = setup(sessionEnvelope());
  await s.auth.hydrate();
  t.mock.method(publicApi, 'venues', async () => ({ items: [fixture.venue], nextCursor: null }));
  const management = s.auth.gameManagement;
  const gameId = '10000000-0000-4000-8000-000000000158';
  const draft = { ...fixture, id: gameId, status: 'draft' as const, version: 7 };
  const createPosts: string[] = [];
  const refreshGate = deferred<typeof credentials>();
  let deferRefresh = false;
  s.setHandler(async (path, init) => {
    if (path === '/me') return me;
    if (path === '/auth/native/refresh') return deferRefresh ? refreshGate.promise : credentials;
    if (path === '/me/social-profile') return { cityId: 'city-1', trainer: false, displayName: 'Creator' };
    if (path === '/me/game-preferences') return { version: 0, defaultPublicGameContact: null };
    if (path.startsWith('/me/games')) {
      return { items: [{ ...draft, management: { role: 'owner', createdByMe: true } }], nextCursor: null };
    }
    if (path === `/games/${gameId}`) return { ...draft, status: 'draft' };
    if (path === '/games' && (init.method ?? 'GET') === 'POST') {
      createPosts.push(path);
      return draft;
    }
    if (path.includes('/participations')) return { items: [], nextCursor: null };
    return { ok: true };
  });
  await management.loadContext('city-1');
  management.update({ venueId: fixture.venue.id, date: '2026-11-20', time: '18:30', contact: '@creator' });
  management.preview();
  // Expire only for the create send so POST awaits refresh after lease capture.
  deferRefresh = true;
  const access = (s.auth as unknown as { access: { expiresAt: number } | null }).access;
  if (access) access.expiresAt = 0;
  const release = management.bindCreationView();
  const work = management.publishPreview();
  await new Promise(r => setImmediate(r));
  assert.equal(management.isCreationContinuationLive(), true);
  // Retire create view while token refresh is deferred — initial POST must not fire.
  release();
  refreshGate.resolve(credentials);
  await work;
  assert.equal(createPosts.length, 0);
  assert.equal(management.getSnapshot().created, null);
  assert.equal(management.getSnapshot().command, undefined);
});

test('#522 APK51: game-cover AuthCoordinator fences, GET/PUT/DELETE transport, no auto-publish', async () => {
  const s = setup(sessionEnvelope());
  await s.auth.hydrate();
  const owner = s.auth.gameCover;
  const gameId = '10000000-0000-4000-8000-000000000051';
  const hex = 'cd'.repeat(32);
  const gameUrl = `/v1/media/game-covers/${hex}.png`;
  const calls: { path: string; method?: string; key?: string; version?: string; contentType?: string }[] = [];
  let row = { version: 3, hasCover: false, cover: { uploadedUrl: null as string | null } };
  s.setHandler(async (path, init) => {
    if (path === '/me') return me;
    if (path === '/auth/native/refresh') return credentials;
    if (path === `/games/${gameId}/cover`) {
      const headers = init.headers as Record<string, string> | undefined;
      calls.push({
        path,
        method: init.method,
        key: headers?.['Idempotency-Key'],
        version: headers?.['X-Game-Version'],
        contentType: headers?.['Content-Type'],
      });
      if ((init.method ?? 'GET') === 'PUT') {
        row = { version: row.version + 1, hasCover: true, cover: { uploadedUrl: gameUrl } };
        return row;
      }
      if (init.method === 'DELETE') {
        row = { version: row.version + 1, hasCover: false, cover: { uploadedUrl: null } };
        return row;
      }
      return row;
    }
    if (path.startsWith('/me/games')) {
      return { items: [{ id: gameId, version: row.version, management: { role: 'owner', createdByMe: true } }], nextCursor: null };
    }
    if (path === `/games/${gameId}`) {
      return { ...fixture, id: gameId, version: row.version, status: 'draft' };
    }
    if (path.includes('/participations')) return { items: [], nextCursor: null };
    return { ok: true };
  });
  await owner.load(gameId);
  assert.equal(calls.some(c => c.method === 'PUT' || c.method === 'DELETE'), false);
  assert.equal(owner.getSnapshot().access?.hasCover, false);
  await owner.change(async () => Object.freeze({
    mime: 'image/jpeg' as const,
    bytes: new Uint8Array([255, 216, 255, 217]),
  }));
  const put = calls.find(c => c.method === 'PUT');
  assert.ok(put);
  assert.equal(put!.version, '3');
  assert.equal(put!.contentType, 'image/jpeg');
  assert.ok(put!.key && put!.key.length >= 16);
  assert.equal(owner.getSnapshot().access?.hasCover, true);
  assert.equal(owner.getSnapshot().access?.version, 4);
  await owner.remove();
  const del = calls.find(c => c.method === 'DELETE');
  assert.ok(del);
  assert.equal(del!.contentType, 'application/json');
  assert.equal(owner.getSnapshot().access?.hasCover, false);

  await s.auth.refresh();
  assert.strictEqual(s.auth.gameCover, owner);

  const mutCount = calls.filter(c => c.method === 'PUT' || c.method === 'DELETE').length;
  await s.auth.logout();
  assert.equal(owner.getSnapshot().actor, null);
  assert.equal(owner.getSnapshot().command, undefined);
  assert.equal(owner.getSnapshot().access, null);
  await owner.change(async () => Object.freeze({
    mime: 'image/jpeg' as const,
    bytes: new Uint8Array([255, 216, 255, 217]),
  }));
  assert.equal(calls.filter(c => c.method === 'PUT' || c.method === 'DELETE').length, mutCount);
});

test('#522 FIX3: AuthCoordinator delayed-token cover-lock throws CoverLockNoSendError; preserves UNKNOWN', async () => {
  const gameId = '10000000-0000-4000-8000-000000000053';
  const s = setup(sessionEnvelope());
  await s.auth.hydrate();
  const management = s.auth.gameManagement;
  const cover = s.auth.gameCover;
  const refreshGate = deferred<unknown>();
  const draft = { ...fixture, id: gameId, status: 'draft' as const, version: 2 };
  const publishPosts: string[] = [];
  let failPublish = true;
  s.setHandler(async (path, init) => {
    if (path === '/me') return me;
    if (path === '/auth/native/refresh') return refreshGate.promise;
    if (path.startsWith('/me/games')) {
      return { items: [{ ...draft, management: { role: 'owner', createdByMe: true } }], nextCursor: null };
    }
    if (path === `/games/${gameId}` && (init.method ?? 'GET') === 'GET') return draft;
    if (path.includes('/participations')) return { items: [], nextCursor: null };
    if (path === '/me/social-profile') {
      return { cityId: fixture.venue.cityId, trainer: false, displayName: 'Хозяин' };
    }
    if (path === `/games/${gameId}/publish`) {
      publishPosts.push(path);
      if (failPublish) throw Object.assign(new Error('network lost'), { name: 'TypeError' });
      return { ...draft, status: 'published', version: 3 };
    }
    return { ok: true };
  });
  await management.loadDetail(gameId);
  assert.equal(management.getSnapshot().details[gameId]?.status, 'ready');
  await management.publishDraft(gameId);
  assert.equal(management.getSnapshot().command?.status, 'unknown');
  const original = management.getSnapshot().command!.packet;
  assert.equal(original.kind, 'publish');
  assert.equal(publishPosts.length, 1);
  failPublish = false;

  // Flip the same blocksManagedWrites the auth port rechecks after token (not incidental catch inference).
  let lockAfterToken = false;
  const realBlocks = cover.blocksManagedWrites.bind(cover);
  cover.blocksManagedWrites = (id: string) => lockAfterToken || realBlocks(id);

  const refreshWork = s.auth.refresh();
  await new Promise(r => setImmediate(r));
  const reconcileWork = management.reconcile();
  await new Promise(r => setImmediate(r));
  assert.equal(management.getSnapshot().command?.status, 'sending');
  lockAfterToken = true;
  refreshGate.resolve(credentials);
  await Promise.all([reconcileWork, refreshWork.catch(() => {})]);

  assert.equal(publishPosts.length, 1);
  assert.equal(management.getSnapshot().command?.status, 'unknown');
  assert.equal(management.getSnapshot().command?.packet.key, original.key);
  assert.strictEqual(management.getSnapshot().command?.packet, original);
  assert.match(management.getSnapshot().notice ?? '', /фото/);
});

test('#522 FIX6: cover receipt onReceipt soft-refreshes management detail without loading flash', async () => {
  const gameId = '10000000-0000-4000-8000-000000000056';
  const s = setup(sessionEnvelope());
  await s.auth.hydrate();
  const cover = s.auth.gameCover;
  const management = s.auth.gameManagement;
  const hex = 'ef'.repeat(32);
  const gameUrl = `/v1/media/game-covers/${hex}.png`;
  let row = { version: 2, hasCover: false, cover: { uploadedUrl: null as string | null } };
  let managedCalls = 0;
  const secondManaged = deferred<{ items: unknown[]; nextCursor: null }>();
  s.setHandler(async (path, init) => {
    if (path === '/me') return me;
    if (path === '/auth/native/refresh') return credentials;
    if (path === `/games/${gameId}/cover`) {
      if ((init.method ?? 'GET') === 'PUT') {
        row = { version: row.version + 1, hasCover: true, cover: { uploadedUrl: gameUrl } };
        return row;
      }
      return row;
    }
    if (path.startsWith('/me/games')) {
      managedCalls += 1;
      const item = { ...fixture, id: gameId, status: 'draft' as const, version: row.version, management: { role: 'owner', createdByMe: true } };
      if (managedCalls === 1) return { items: [item], nextCursor: null };
      await secondManaged.promise;
      return { items: [{ ...item, version: row.version }], nextCursor: null };
    }
    if (path === `/games/${gameId}`) {
      return { ...fixture, id: gameId, version: row.version, status: 'draft' };
    }
    if (path.includes('/participations')) return { items: [], nextCursor: null };
    return { ok: true };
  });

  await management.loadDetail(gameId);
  assert.equal(management.getSnapshot().details[gameId]?.status, 'ready');
  assert.ok(management.getSnapshot().details[gameId]?.game);

  const release = cover.openView(gameId);
  await new Promise(r => setImmediate(r));
  assert.equal(cover.getSnapshot().status, 'ready');

  const save = cover.change(async () => Object.freeze({
    mime: 'image/jpeg' as const,
    bytes: new Uint8Array([255, 216, 255, 217]),
  }));
  await save;
  // onReceipt started the second managed read and is held — shell must stay ready.
  for (let i = 0; i < 40 && managedCalls < 2; i += 1) await new Promise(r => setImmediate(r));
  assert.equal(managedCalls, 2);
  assert.equal(management.getSnapshot().details[gameId]?.status, 'ready', 'onReceipt must not flash loading');
  assert.ok(management.getSnapshot().details[gameId]?.game);
  assert.equal(cover.getSnapshot().access?.hasCover, true);
  assert.equal(gameCoverMutationSucceeded(cover.getSnapshot()), true);
  secondManaged.resolve({ items: [], nextCursor: null });
  await new Promise(r => setImmediate(r));
  assert.equal(management.getSnapshot().details[gameId]?.status, 'ready');
  release();
});

test('#522 FIX2: game-cover deferred-token admission — close/background/ABA/account → zero mutate', async () => {
  const gameId = '10000000-0000-4000-8000-000000000052';
  async function run(interrupt: 'background' | 'close-view' | 'game-ABA' | 'account') {
    const s = setup(sessionEnvelope());
    await s.auth.hydrate();
    const owner = s.auth.gameCover;
    const mutates: string[] = [];
    const refreshGate = deferred<unknown>();
    let row = { version: 2, hasCover: false, cover: { uploadedUrl: null as string | null } };
    s.setHandler(async (path, init) => {
      if (path === '/me') return me;
      if (path === '/auth/native/refresh') return refreshGate.promise;
      if (path === `/games/${gameId}/cover`) {
        if ((init.method ?? 'GET') === 'PUT' || init.method === 'DELETE') {
          mutates.push(String(init.method));
          row = { version: row.version + 1, hasCover: init.method === 'PUT', cover: { uploadedUrl: null } };
          return row;
        }
        return row;
      }
      if (path.startsWith('/games/other-game/cover')) {
        return { version: 1, hasCover: false, cover: { uploadedUrl: null } };
      }
      if (path.startsWith('/me/games')) {
        return { items: [{ id: gameId, version: row.version, management: { role: 'owner', createdByMe: true } }], nextCursor: null };
      }
      if (path === `/games/${gameId}`) {
        return { ...fixture, id: gameId, version: row.version, status: 'draft' };
      }
      if (path.includes('/participations')) return { items: [], nextCursor: null };
      return { ok: true };
    });

    const release = owner.openView(gameId);
    await new Promise(r => setImmediate(r));
    assert.equal(owner.getSnapshot().status, 'ready', interrupt);

    const refreshWork = s.auth.refresh();
    await new Promise(r => setImmediate(r));
    const changeWork = owner.change(async () => Object.freeze({
      mime: 'image/jpeg' as const,
      bytes: new Uint8Array([255, 216, 255, 217]),
    }));
    await new Promise(r => setImmediate(r));
    assert.equal(owner.getSnapshot().command?.status, 'sending', interrupt);

    if (interrupt === 'background') owner.setForeground(false);
    else if (interrupt === 'close-view') release();
    else if (interrupt === 'game-ABA') owner.openView('other-game');
    else owner.setActor({ actorId: 'other', sessionId: 's2', generation: 99 });

    refreshGate.resolve(credentials);
    await Promise.all([changeWork, refreshWork.catch(() => {})]);
    assert.equal(mutates.length, 0, interrupt);
    if (interrupt === 'background' || interrupt === 'close-view') {
      assert.equal(owner.getSnapshot().command?.status, 'unknown', interrupt);
      assert.equal(owner.getSnapshot().uncertain, true, interrupt);
    }
  }

  await run('background');
  await run('close-view');
  await run('game-ABA');
  await run('account');
});

test('#522 APK48: delayed token actor/view permit yields zero PUT', async () => {
  const s = setup(sessionEnvelope());
  await s.auth.hydrate();
  const owner = s.auth.gameCourtBooking;
  const gameId = '10000000-0000-4000-8000-000000000010';
  const puts: unknown[] = [];
  const refreshGate = deferred<unknown>();
  s.setHandler(async (path, init) => {
    if (path === '/me') return me;
    if (path === '/auth/native/refresh') return refreshGate.promise;
    if (path === `/games/${gameId}/court-booking`) {
      if ((init.method ?? 'GET') === 'PUT') {
        puts.push(init.body ? JSON.parse(String(init.body)) : null);
        return {
          gameId, status: 'arranging', version: 1, updatedAt: '2026-11-24T12:00:00.000Z',
          declarationSource: 'organizer_declared', allowedActions: { canUpdate: true },
        };
      }
      return {
        gameId, status: 'unspecified', version: 0, updatedAt: null,
        declarationSource: 'organizer_declared', allowedActions: { canUpdate: true },
      };
    }
    if (path.startsWith('/me/games')) return { items: [{ id: gameId, management: { role: 'owner', createdByMe: true } }], nextCursor: null };
    return { ok: true };
  });
  s.auth.gameManagement.getSnapshot().details[gameId] = {
    status: 'ready',
    management: { role: 'owner', createdByMe: true },
    participants: [],
    cursor: null,
    roster: 'ready',
  };
  owner.focus(gameId, 'managed');
  await owner.load();
  owner.updateDraft('arranging');
  // Hold rotation so PUT permit rechecks after token await; invalidate view/foreground while waiting.
  const refreshWork = s.auth.refresh();
  await new Promise(resolve => setImmediate(resolve));
  const saveWork = owner.save();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(owner.getSnapshot().command?.status, 'sending');
  owner.setForeground(false);
  refreshGate.resolve(credentials);
  await Promise.all([saveWork, refreshWork]);
  assert.equal(puts.length, 0);
  assert.equal(owner.getSnapshot().command?.status, 'unknown');
});

test('#522 APK49: private venue contacts AuthCoordinator fences, separate GET, logout clear', async () => {
  const s = setup(sessionEnvelope());
  await s.auth.hydrate();
  const owner = s.auth.privateGameVenueContacts;
  const gameId = '10000000-0000-4000-8000-000000000010';
  const venueId = '20000000-0000-4000-8000-000000000020';
  const calls: { path: string; method?: string; auth?: string; credentials?: RequestCredentials }[] = [];
  const detail = {
    id: gameId, version: 1, title: 'Fixture', status: 'published', visibility: 'public',
    organizer: { id: me.id, displayName: 'Host', publicContact: 'tg' },
    venue: {
      id: venueId, name: 'Hall', address: 'Addr', cityId: 'c', timezone: 'Europe/Moscow',
      contactPhone: '+7 (999) 123-45-67', contactWebsite: 'https://example.org/booking', bookingNote: 'Note',
    },
    startsAt: '2026-12-01T10:00:00.000Z', endsAt: '2026-12-01T12:00:00.000Z',
    applicationDeadlineAt: '2026-11-30T10:00:00.000Z', timezone: 'Europe/Moscow',
    capacity: 4, confirmedCount: 1, externalReservedCount: 0, availablePlaces: 3,
    formatKey: 'doubles', levelRule: { scaleId: 'ntrp', scaleVersion: 1, allowedLevelIds: ['3.0'] },
    settlement: { mode: 'external', purpose: 'no_trainer_fee', priceMinor: null, currency: null, terms: 'x' },
    activityKind: 'regular', trainingDescription: null, trainer: null,
  };
  s.setHandler(async (path, init) => {
    if (path === '/me') return me;
    if (path === '/auth/native/refresh') return credentials;
    if (path === `/games/${gameId}`) {
      const headers = (init.headers ?? {}) as Record<string, string>;
      calls.push({
        path,
        method: init.method ?? 'GET',
        auth: headers.Authorization,
        credentials: init.credentials,
      });
      return detail;
    }
    return { ok: true };
  });
  owner.focus(gameId, venueId);
  await owner.load();
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.path, `/games/${gameId}`);
  assert.equal(calls[0]!.auth, `Bearer ${credentials.accessToken}`);
  assert.equal(calls[0]!.credentials, 'omit');
  assert.equal(owner.getSnapshot().projection?.phone?.url, 'tel:+79991234567');
  assert.equal(owner.getSnapshot().projection?.bookingNote, 'Note');

  await s.auth.refresh();
  assert.strictEqual(s.auth.privateGameVenueContacts, owner);
  assert.equal(owner.getSnapshot().projection?.phone?.url, 'tel:+79991234567');

  const getCount = calls.length;
  const permit = owner.renderedPermit(owner.getSnapshot().projection!.phone!);
  assert.ok(permit);
  await s.auth.logout();
  assert.equal(owner.getSnapshot().actor, null);
  assert.equal(owner.getSnapshot().projection, null);
  assert.equal(await owner.open(permit!), 'blocked');
  assert.equal(calls.length, getCount);
});

test('#522 APK49: delayed token surface permit yields zero private contacts GET', async () => {
  const s = setup(sessionEnvelope());
  await s.auth.hydrate();
  const owner = s.auth.privateGameVenueContacts;
  const gameId = '10000000-0000-4000-8000-000000000010';
  const venueId = '20000000-0000-4000-8000-000000000020';
  const gets: string[] = [];
  const refreshGate = deferred<unknown>();
  s.setHandler(async (path) => {
    if (path === '/me') return me;
    if (path === '/auth/native/refresh') return refreshGate.promise;
    if (path === `/games/${gameId}`) {
      gets.push(path);
      return {
        id: gameId, version: 1, title: 'Fixture', status: 'published', visibility: 'public',
        organizer: { id: me.id, displayName: 'Host', publicContact: 'tg' },
        venue: { id: venueId, name: 'Hall', address: 'Addr', cityId: 'c', timezone: 'Europe/Moscow' },
        startsAt: '2026-12-01T10:00:00.000Z', endsAt: '2026-12-01T12:00:00.000Z',
        applicationDeadlineAt: '2026-11-30T10:00:00.000Z', timezone: 'Europe/Moscow',
        capacity: 4, confirmedCount: 0, externalReservedCount: 0, availablePlaces: 4,
        formatKey: 'doubles', levelRule: { scaleId: 'ntrp', scaleVersion: 1, allowedLevelIds: ['3.0'] },
        settlement: { mode: 'external', purpose: 'no_trainer_fee', priceMinor: null, currency: null, terms: 'x' },
        activityKind: 'regular', trainingDescription: null, trainer: null,
      };
    }
    return { ok: true };
  });
  // Force token rotation path so permit rechecks after await.
  const refreshWork = s.auth.refresh();
  await new Promise(resolve => setImmediate(resolve));
  owner.focus(gameId, venueId);
  const loadWork = owner.load();
  await new Promise(resolve => setImmediate(resolve));
  owner.setForeground(false);
  refreshGate.resolve(credentials);
  await Promise.all([loadWork, refreshWork]);
  assert.equal(gets.length, 0);
  assert.equal(owner.getSnapshot().projection, null);
});

test('#522 APK49: AuthCoordinator injected opener — current callback opens exact URL; actor/logout stale open zero', async () => {
  const opens: string[] = [];
  const s = setup(sessionEnvelope(), {
    openExternalUrl: async url => { opens.push(url); },
  });
  await s.auth.hydrate();
  const owner = s.auth.privateGameVenueContacts;
  const gameId = '10000000-0000-4000-8000-000000000010';
  const venueId = '20000000-0000-4000-8000-000000000020';
  const detail = {
    id: gameId, version: 1, title: 'Fixture', status: 'published', visibility: 'public',
    organizer: { id: me.id, displayName: 'Host', publicContact: 'tg' },
    venue: {
      id: venueId, name: 'Hall', address: 'Addr', cityId: 'c', timezone: 'Europe/Moscow',
      contactPhone: '+7 (999) 123-45-67', contactWebsite: 'https://example.org/booking', bookingNote: 'Note',
    },
    startsAt: '2026-12-01T10:00:00.000Z', endsAt: '2026-12-01T12:00:00.000Z',
    applicationDeadlineAt: '2026-11-30T10:00:00.000Z', timezone: 'Europe/Moscow',
    capacity: 4, confirmedCount: 1, externalReservedCount: 0, availablePlaces: 3,
    formatKey: 'doubles', levelRule: { scaleId: 'ntrp', scaleVersion: 1, allowedLevelIds: ['3.0'] },
    settlement: { mode: 'external', purpose: 'no_trainer_fee', priceMinor: null, currency: null, terms: 'x' },
    activityKind: 'regular', trainingDescription: null, trainer: null,
  };
  s.setHandler(async (path) => {
    if (path === '/me') return me;
    if (path === '/auth/native/refresh') return credentials;
    if (path === `/games/${gameId}`) return detail;
    return { ok: true };
  });
  owner.focus(gameId, venueId);
  await owner.load();
  const phone = owner.getSnapshot().projection?.phone;
  const website = owner.getSnapshot().projection?.website;
  assert.ok(phone);
  assert.ok(website);
  const phoneHandler = owner.createContactOpenHandler(phone);
  const siteHandler = owner.createContactOpenHandler(website);
  assert.ok(phoneHandler);
  assert.ok(siteHandler);
  // Admitted current AuthCoordinator callbacks invoke exact URLs via injected openExternalUrl.
  phoneHandler();
  siteHandler();
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(opens, ['tel:+79991234567', 'https://example.org/booking']);

  // AuthCoordinator logout clears actor/session and forgets projection; saved callbacks open zero more.
  await s.auth.logout();
  assert.equal(owner.getSnapshot().actor, null);
  assert.equal(owner.getSnapshot().projection, null);
  phoneHandler();
  siteHandler();
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(opens, ['tel:+79991234567', 'https://example.org/booking']);
});

test('#522 APK45: invitation-authoring AuthCoordinator fences, create transport, no auto-send', async () => {
  const s = setup(sessionEnvelope());
  await s.auth.hydrate();
  const owner = s.auth.invitationAuthoring;
  const calls: { path: string; method?: string; body?: unknown; key?: string }[] = [];
  const startsAt = '2027-06-01T15:00:00.000Z';
  const game = {
    id: 'game-open', version: 3, title: 'Evening', status: 'published', visibility: 'public',
    organizer: { id: 'org', displayName: 'Host', publicContact: 'telegram:@h' },
    venue: { id: 'v', name: 'Court', address: 'Addr', cityId: 'city', timezone: 'Europe/Moscow' },
    startsAt, endsAt: '2027-06-01T17:00:00.000Z', applicationDeadlineAt: '2027-05-31T15:00:00.000Z',
    timezone: 'Europe/Moscow', capacity: 4, confirmedCount: 1, externalReservedCount: 0, availablePlaces: 3,
    formatKey: 'doubles', levelRule: { scaleId: 'ntrp', scaleVersion: 1, allowedLevelIds: ['3.0'] },
    settlement: { mode: 'external', purpose: 'no_trainer_fee', priceMinor: null, currency: null, terms: 'Outside' },
    activityKind: 'regular', trainingDescription: null, trainer: null,
    management: { role: 'owner', createdByMe: true },
  };
  s.setHandler(async (path, init) => {
    if (path === '/me') return me;
    if (path === '/auth/native/refresh') return credentials;
    if (path.startsWith('/me/games')) {
      calls.push({ path, method: init.method ?? 'GET' });
      return { items: [game], nextCursor: null };
    }
    if (path === '/games/game-open') {
      calls.push({ path, method: init.method ?? 'GET' });
      return game;
    }
    if (path === '/games/game-open/invitations') {
      calls.push({
        path,
        method: init.method,
        body: init.body ? JSON.parse(String(init.body)) : undefined,
        key: (init.headers as Record<string, string> | undefined)?.['Idempotency-Key'],
      });
      return {
        id: 'inv-created', gameId: 'game-open', status: 'pending', version: 1,
        inviterPublicPlayerId: 'public-a', inviteePublicPlayerId: 'peer-1',
        expiresAt: null, decidedAt: null, participationId: null, createdAt: '2026-11-24T10:00:00.000Z',
      };
    }
    return { ok: true };
  });
  assert.equal(calls.some(c => c.path.includes('/invitations')), false);
  owner.open('dm-1', 'peer-1');
  await owner.load();
  assert.equal(owner.getSnapshot().games[0]?.id, 'game-open');
  assert.equal(calls.some(c => c.method === 'POST'), false);
  await owner.invite('game-open');
  const create = calls.find(c => c.method === 'POST' && c.path === '/games/game-open/invitations');
  assert.ok(create);
  assert.deepEqual(create!.body, { inviteePublicPlayerId: 'peer-1', expectedGameVersion: 3 });
  assert.ok(create!.key && create!.key.length >= 16);
  assert.equal(owner.getSnapshot().receipt?.id, 'inv-created');

  await s.auth.refresh();
  assert.strictEqual(s.auth.invitationAuthoring, owner);

  const postCount = calls.filter(c => c.method === 'POST').length;
  await s.auth.logout();
  assert.equal(owner.getSnapshot().actor, null);
  assert.equal(owner.getSnapshot().command, undefined);
  assert.equal(owner.getSnapshot().receipt, null);
  owner.open('dm-1', 'peer-1');
  await owner.invite('game-open');
  assert.equal(calls.filter(c => c.method === 'POST').length, postCount);
});

test('#522 APK45: deferred token fence — surface close before createInvitation yields zero POSTs', async () => {
  const s = setup(sessionEnvelope());
  await s.auth.hydrate();
  const owner = s.auth.invitationAuthoring;
  const posts: string[] = [];
  const startsAt = '2027-06-01T15:00:00.000Z';
  const game = {
    id: 'game-open', version: 3, title: 'Evening', status: 'published', visibility: 'public',
    organizer: { id: 'org', displayName: 'Host', publicContact: 'telegram:@h' },
    venue: { id: 'v', name: 'Court', address: 'Addr', cityId: 'city', timezone: 'Europe/Moscow' },
    startsAt, endsAt: '2027-06-01T17:00:00.000Z', applicationDeadlineAt: '2027-05-31T15:00:00.000Z',
    timezone: 'Europe/Moscow', capacity: 4, confirmedCount: 1, externalReservedCount: 0, availablePlaces: 3,
    formatKey: 'doubles', levelRule: { scaleId: 'ntrp', scaleVersion: 1, allowedLevelIds: ['3.0'] },
    settlement: { mode: 'external', purpose: 'no_trainer_fee', priceMinor: null, currency: null, terms: 'Outside' },
    activityKind: 'regular', trainingDescription: null, trainer: null,
    management: { role: 'owner', createdByMe: true },
  };
  const tokenGate = deferred<typeof credentials>();
  s.setHandler(async path => {
    if (path === '/me') return me;
    if (path === '/auth/native/refresh') return tokenGate.promise;
    if (path.startsWith('/me/games')) return { items: [game], nextCursor: null };
    if (path === '/games/game-open') {
      // Expire after fresh GET acquired its token so create awaits refresh, then rechecks permit.
      const access = (s.auth as unknown as { access: { expiresAt: number } | null }).access;
      if (access) access.expiresAt = 0;
      return game;
    }
    if (path === '/games/game-open/invitations') {
      posts.push(path);
      return {
        id: 'inv-late', gameId: 'game-open', status: 'pending', version: 1,
        inviterPublicPlayerId: 'public-a', inviteePublicPlayerId: 'peer-1',
        expiresAt: null, decidedAt: null, participationId: null, createdAt: '2026-11-24T10:00:00.000Z',
      };
    }
    return { ok: true };
  });
  owner.open('dm-1', 'peer-1');
  await owner.load();
  const invite = owner.invite('game-open');
  await new Promise(r => setImmediate(r));
  assert.equal(posts.length, 0);
  assert.equal(owner.getSnapshot().command?.status, 'sending');
  owner.close();
  tokenGate.resolve(credentials);
  await invite;
  assert.equal(posts.length, 0);
  assert.equal(owner.getSnapshot().command, undefined);
  assert.equal(owner.getSnapshot().checking, false);
});

test('#522 APK46: revoke deferred token fence — blur/focus/account → zero POST, no hidden lock; UNKNOWN exact retry retained', async () => {
  const s = setup(sessionEnvelope());
  await s.auth.hydrate();
  const messages = s.auth.messages;
  const invite = { kind: 'invitation' as const, id: 'invite-apk46' };
  const invitation = {
    id: 'invite-apk46', gameId: 'game-managed', status: 'pending', version: 4,
    inviterPublicPlayerId: 'public-b', inviteePublicPlayerId: 'public-peer',
    expiresAt: null, participationId: null, acceptanceContext: null,
  };
  const game = {
    id: 'game-managed', version: 3, title: 'Evening', status: 'published', visibility: 'public',
    organizer: { id: 'org', displayName: 'Host', publicContact: 'telegram:@h' },
    venue: { id: 'v', name: 'Court', address: 'Addr', cityId: 'city', timezone: 'Europe/Moscow' },
    startsAt: '2027-06-01T15:00:00.000Z', endsAt: '2027-06-01T17:00:00.000Z',
    applicationDeadlineAt: '2027-05-31T15:00:00.000Z', timezone: 'Europe/Moscow',
    capacity: 4, confirmedCount: 1, externalReservedCount: 0, availablePlaces: 3,
    formatKey: 'doubles', levelRule: { scaleId: 'ntrp', scaleVersion: 1, allowedLevelIds: ['3.0'] },
    settlement: { mode: 'external', purpose: 'no_trainer_fee', priceMinor: null, currency: null, terms: 'Outside' },
    activityKind: 'regular', trainingDescription: null, trainer: null,
    management: { role: 'owner', createdByMe: true },
  };
  const counts = { pendingRequestCount: 0, pendingInvitationCount: 0, dmUnread: 0, gameChatUnread: 0 };
  const expireAfterEligibility = () => {
    const access = (s.auth as unknown as { access: { expiresAt: number } | null }).access;
    if (access) access.expiresAt = 0;
  };
  const revokePosts: string[] = [];
  let managedReads = 0;
  let refreshResult: Promise<typeof credentials> | typeof credentials = credentials;

  const install = () => {
    s.setHandler(async path => {
      if (path === '/me') return me;
      if (path === '/me/social-profile') return { publicPlayerId: 'public-manager' };
      if (path === '/invitations/invite-apk46') return invitation;
      if (path.startsWith('/me/games')) {
        managedReads++;
        // After act() eligibility GET, expire access so mutation send awaits refresh.
        if (managedReads >= 2) expireAfterEligibility();
        return { items: [game], nextCursor: null };
      }
      if (path === '/auth/native/refresh') return refreshResult;
      if (path === '/invitations/invite-apk46/revoke') {
        revokePosts.push(path);
        return new Response('{}', { status: 503 });
      }
      if (path === '/me/inbox/counts') return counts;
      return { ok: true };
    });
  };

  install();
  messages.focus(invite);
  await new Promise(r => setImmediate(r));
  assert.equal(messages.getSnapshot().detail?.managerEligible, true);

  // (1) Blur while mutation token refresh pending → zero POST, clear sending (not UNKNOWN).
  const tokenGate = deferred<typeof credentials>();
  refreshResult = tokenGate.promise;
  const blurred = messages.act(invite, 'revoke');
  await new Promise(r => setImmediate(r));
  assert.equal(revokePosts.length, 0);
  assert.equal(messages.getSnapshot().pending['invitation:invite-apk46']?.state, 'sending');
  messages.setForeground(false);
  tokenGate.resolve(credentials);
  await blurred;
  assert.equal(revokePosts.length, 0);
  assert.equal(messages.getSnapshot().pending['invitation:invite-apk46'], undefined);
  assert.equal(messages.getSnapshot().notice, null);

  // (1b) ABA: background→foreground while token still pending must not revive the old initial revoke.
  managedReads = 0;
  await s.auth.refresh();
  messages.setForeground(true);
  messages.focus(invite);
  await new Promise(r => setImmediate(r));
  const abaGate = deferred<typeof credentials>();
  refreshResult = abaGate.promise;
  const aba = messages.act(invite, 'revoke');
  await new Promise(r => setImmediate(r));
  assert.equal(revokePosts.length, 0);
  assert.equal(messages.getSnapshot().pending['invitation:invite-apk46']?.state, 'sending');
  messages.setForeground(false);
  messages.setForeground(true);
  abaGate.resolve(credentials);
  await aba;
  assert.equal(revokePosts.length, 0);
  assert.equal(messages.getSnapshot().pending['invitation:invite-apk46'], undefined);
  assert.equal(messages.getSnapshot().notice, null);

  // Seed UNKNOWN via real AuthCoordinator revoke POST (503 → network).
  managedReads = 0;
  refreshResult = credentials;
  await s.auth.refresh();
  messages.focus(invite);
  await new Promise(r => setImmediate(r));
  await messages.act(invite, 'revoke');
  assert.equal(revokePosts.length, 1);
  const unknownPacket = messages.getSnapshot().pending['invitation:invite-apk46']?.packet;
  assert.ok(unknownPacket);
  assert.equal(messages.getSnapshot().pending['invitation:invite-apk46']?.state, 'unknown');

  // (2) Reconcile retry: focus leave during token wait → zero additional POST; exact UNKNOWN retained.
  expireAfterEligibility();
  const retryGate = deferred<typeof credentials>();
  refreshResult = retryGate.promise;
  const postsBeforeRetry = revokePosts.length;
  const retrying = messages.retry(invite);
  await new Promise(r => setImmediate(r));
  messages.focus(null);
  retryGate.resolve(credentials);
  await retrying;
  assert.equal(revokePosts.length, postsBeforeRetry);
  assert.equal(messages.getSnapshot().pending['invitation:invite-apk46']?.state, 'unknown');
  assert.strictEqual(messages.getSnapshot().pending['invitation:invite-apk46']?.packet, unknownPacket);

  // (3) Account change clears ownership; never POSTs the old revoke packet.
  await s.auth.logout();
  assert.deepEqual(messages.getSnapshot().pending, {});
  await messages.retry(invite);
  assert.equal(revokePosts.length, postsBeforeRetry);
});
