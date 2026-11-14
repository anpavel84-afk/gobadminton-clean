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

test('new root management owner shares secure actor fences, leaves Messages UNKNOWN untouched, never dispatches on callback', async t => {
  const s=setup({...envelope,returnPath:'/games/create',pending:{...pending,returnPath:'/games/create'}});
  assert.equal(await s.auth.callback(callback),'/games/create');
  assert.equal(s.calls.filter(c=>c.path==='/games').length,0);
  t.mock.method(publicApi,'venues',async()=>({items:[fixture.venue],nextCursor:null}));
  const owner=s.auth.gameManagement, participation=s.auth.participation;
  s.setHandler(async path=>{
    if(path==='/me')return me;
    if(path==='/auth/native/refresh')return credentials;
    if(path==='/me/social-profile')return {publicPlayerId:'public-a',cityId:'city-1',trainer:false,displayName:'Creator'};
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
