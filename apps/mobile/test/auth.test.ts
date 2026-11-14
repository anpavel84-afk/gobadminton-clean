import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { AuthCoordinator } from '../src/auth-coordinator.ts';
import { createNativeApi } from '../src/native-api.ts';
import { PublicApiError, publicApi } from '../src/public-api.ts';
import { game as fixture } from './fixtures.ts';
import { NATIVE_CLIENT_ID, NATIVE_REDIRECT, SECURE_AUTH_KEY, NativeAuthError, base64Url, canonicalGamePath, canonicalReturnPath,
  parseCallback, parseNativeMe, parseSecureEnvelope } from '../src/native-auth-protocol.ts';
import type { PendingLogin, SecureEnvelope } from '../src/native-auth-protocol.ts';

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
function setup(initial: unknown = null) {
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
    challenge: async verifier => createHash('sha256').update(verifier).digest('base64url'), now: () => now });
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
  await owner.loadContext('city-1'); owner.update({venueId:fixture.venue.id,date:'2026-11-20',time:'18:30',contact:'@creator'}); owner.preview(); await owner.publishPreview();
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
  owner.preview(); await owner.publishPreview();
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
  await s.auth.hydrate(); await s.auth.profile.load();
  assert.deepEqual(s.auth.profile.getSnapshot().draft,{displayName:'',cityId:''});
  assert.doesNotMatch(JSON.stringify(s.auth.profile.getSnapshot()),/private@example/);
  s.auth.profile.update({displayName:'Публичное имя',cityId:'city'}); await s.auth.profile.save(); assert.equal(lost,true);
  const packet = s.auth.profile.getSnapshot().command!.packet;
  // Loss of verified identity quarantines private state. Starting reauth is not explicit logout.
  s.setHandler(async () => { throw new NativeAuthError('network'); }); await s.auth.validate();
  assert.equal(s.auth.profile.getSnapshot().actor,null); assert.equal(s.auth.profile.getSnapshot().command,undefined);
  assert.equal(s.auth.profile.getSnapshot().draft.displayName,'');
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
  s.setHandler(async () => ({...dto,version:1,displayName:packet.body.displayName,cityId:packet.body.cityId}));
  await s.auth.profile.reconcile();
  const sent = s.calls.filter(c => c.init.method === 'PATCH');
  assert.equal(sent.length,2); assert.equal(sent[0]?.init.body,sent[1]?.init.body);
  assert.equal((sent[1]?.init.headers as Record<string,string>)['Idempotency-Key'],packet.key);
  assert.equal(s.auth.profile.getSnapshot().actor?.sessionId,'profile-returned-session');
  assert.equal(s.auth.profile.getSnapshot().profile?.version,1);
  // A subsequent independent UNKNOWN is erased by explicit logout.
  await s.auth.profile.load(); s.auth.profile.update({displayName:'Следующее имя'});
  s.setHandler(async () => { throw new Error('unknown again'); }); await s.auth.profile.save();
  assert.equal(s.auth.profile.getSnapshot().command?.status,'unknown');
  await s.auth.logout(); assert.equal(s.auth.profile.getSnapshot().command,undefined); assert.equal(s.auth.profile.getSnapshot().profile,null);
  assert.equal(s.auth.profile.getSnapshot().draft.displayName,'');
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
