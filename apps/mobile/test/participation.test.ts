import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AuthCoordinator } from '../src/auth-coordinator.ts';
import { createNativeApi } from '../src/native-api.ts';
import { createPublicApi, PublicApiError } from '../src/public-api.ts';
import { ParticipationCoordinator, ParticipationError, parseCursorPage, parseParticipation, parseAuthenticatedGame, parseManagedGame, myGameRows } from '../src/participation.ts';
import type { Actor, Command, ParticipationPort } from '../src/participation.ts';
import { game as fixture } from './fixtures.ts';
import type { Game, Participation } from '@gobadminton/contracts/game-types';
const actor: Actor = { actorId: 'actor-a', sessionId: 'session-a', generation: 1 };
const game: Game = { ...fixture, version: 7, startsAt: '2099-11-20T15:00:00Z', endsAt: '2099-11-20T17:00:00Z', applicationDeadlineAt: '2099-11-20T14:00:00Z' };
const part: Participation = { id: 'part-a', gameId: game.id, userId: actor.actorId, status: 'pending', version: 1, attemptNumber: 1, requestedAt: '2026-11-14T00:00:00Z', confirmedAt: null };
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
function setup() {
  let parts: Participation[] = [], serial = 0;
  const sent: Command[] = [];
  const port: ParticipationPort = {
    own: async () => ({ items: parts, nextCursor: null }), managed: async () => ({ items: [], nextCursor: null }),
    send: async packet => { sent.push(packet); parts = [{ ...part, status: packet.kind === 'withdraw' ? 'withdrawn' : 'pending', version: packet.kind === 'withdraw' ? packet.body.expectedVersion + 1 : 1 }]; return parts[0]!; },
  };
  const coordinator = new ParticipationCoordinator(port, () => `random-key-${++serial}`, async () => game);
  coordinator.setActor(actor);
  return { coordinator, port, sent, parts: (value: Participation[]) => { parts = value; } };
}
test('auth establishment and reads never apply; explicit reviewed double tap sends one immutable versioned packet', async () => {
  const s = setup(); await s.coordinator.loadDetail(game.id); await s.coordinator.loadOwn();
  assert.equal(s.sent.length, 0); s.coordinator.review(game.id, 'request'); assert.equal(s.sent.length, 0);
  await Promise.all([s.coordinator.confirm(game.id), s.coordinator.confirm(game.id)]);
  assert.equal(s.sent.length, 1); const packet = s.sent[0]!;
  assert.deepEqual(packet.body, { expectedGameVersion: 7 }); assert.equal(packet.actor.sessionId, actor.sessionId);
  assert.ok(Object.isFrozen(packet)); assert.ok(Object.isFrozen(packet.body)); assert.ok(Object.isFrozen(packet.actor));
  assert.equal(s.coordinator.getSnapshot().details[game.id]?.parts[0]?.status, 'pending');
});
test('all cursor pages are required; failed later page is never an empty or actionable detail', async () => {
  const s = setup(), cursors: (string | undefined)[] = [];
  s.port.own = async cursor => { cursors.push(cursor); return cursor ? { items: [part], nextCursor: null } : { items: [], nextCursor: 'page-2' }; };
  await s.coordinator.loadDetail(game.id); assert.deepEqual(cursors, [undefined, 'page-2']);
  assert.deepEqual(s.coordinator.getSnapshot().details[game.id]?.parts, [part]);
  s.port.own = async cursor => { if (cursor) throw new ParticipationError('network'); return { items: [part], nextCursor: 'page-2' }; };
  await s.coordinator.loadOwn(); assert.equal(s.coordinator.getSnapshot().own.status, 'error'); assert.deepEqual(s.coordinator.getSnapshot().own.items, [part]);
  await s.coordinator.loadDetail(game.id); assert.equal(s.coordinator.getSnapshot().details[game.id]?.status, 'error');
  s.coordinator.review(game.id, 'request'); await s.coordinator.confirm(game.id); assert.equal(s.sent.length, 0);
});
test('UNKNOWN survives navigation/read/review with exact packet and no replay; only authoritative result settles it', async () => {
  const s = setup(); let calls = 0;
  s.port.send = async () => { calls++; throw new ParticipationError('network'); };
  await s.coordinator.loadDetail(game.id); s.coordinator.review(game.id, 'request'); await s.coordinator.confirm(game.id);
  const packet = s.coordinator.getSnapshot().details[game.id]!.command!.packet;
  await s.coordinator.loadDetail('another-game'); await s.coordinator.loadDetail(game.id);
  s.coordinator.review(game.id, 'request'); await s.coordinator.confirm(game.id);
  assert.equal(calls, 1); assert.equal(s.coordinator.getSnapshot().details[game.id]?.command?.packet, packet);
  assert.equal(s.coordinator.getSnapshot().details[game.id]?.command?.state, 'unknown');
  s.parts([part]); await s.coordinator.loadDetail(game.id);
  assert.equal(s.coordinator.getSnapshot().details[game.id]?.command?.state, 'settled'); assert.equal(calls, 1);
});
test('in-progress 409 remains UNKNOWN; definite conflict rereads and requires fresh explicit confirmation', async () => {
  const s = setup(); let calls = 0;
  s.port.send = async () => { calls++; throw new ParticipationError('business', 409, calls === 1 ? 'COMMAND_IN_PROGRESS' : 'VERSION_CONFLICT'); };
  await s.coordinator.loadDetail(game.id); s.coordinator.review(game.id, 'request'); await s.coordinator.confirm(game.id);
  assert.equal(s.coordinator.getSnapshot().details[game.id]?.command?.state, 'unknown');
  s.coordinator.setActor(null); s.coordinator.setActor({ ...actor, generation: 2 }); await s.coordinator.loadDetail(game.id);
  s.coordinator.review(game.id, 'request'); await s.coordinator.confirm(game.id);
  assert.equal(s.coordinator.getSnapshot().details[game.id]?.command?.state, 'rejected');
  await s.coordinator.confirm(game.id); assert.equal(calls, 2);
});
test('withdraw pending and confirmed requires review and exact participation version; unsent intent stays on its game', async () => {
  for (const status of ['pending', 'confirmed'] as const) {
    const s = setup(); s.parts([{ ...part, status, version: 4 }]); await s.coordinator.loadDetail(game.id);
    await s.coordinator.confirm(game.id); assert.equal(s.sent.length, 0);
    s.coordinator.review(game.id, 'withdraw'); await s.coordinator.loadDetail('other'); await s.coordinator.loadDetail(game.id);
    assert.equal(s.coordinator.getSnapshot().details[game.id]?.review, 'withdraw');
    await s.coordinator.confirm(game.id); assert.deepEqual(s.sent[0]?.body, { expectedVersion: 4 });
    assert.equal(s.sent[0]?.gameId, game.id); assert.equal(s.coordinator.getSnapshot().details[game.id]?.parts[0]?.status, 'withdrawn');
  }
});
test('logout and switched actor fence late pages, commands and private cached rows', async () => {
  for (const phase of ['read', 'command'] as const) {
    const s = setup(), gate = deferred<Participation>();
    if (phase === 'command') {
      await s.coordinator.loadDetail(game.id); s.coordinator.review(game.id, 'request'); s.port.send = async () => gate.promise;
    } else s.port.own = async () => ({ items: [await gate.promise], nextCursor: null });
    const work = phase === 'read' ? s.coordinator.loadOwn() : s.coordinator.confirm(game.id);
    s.coordinator.setActor(null); assert.deepEqual(s.coordinator.getSnapshot().details, {});
    s.coordinator.setActor({ actorId: 'actor-b', sessionId: 'session-b', generation: 2 });
    gate.resolve(part); await work;
    assert.deepEqual(s.coordinator.getSnapshot().own.items, []); assert.deepEqual(s.coordinator.getSnapshot().details, {});
  }
});
test('later cursor/read generation wins and cyclic cursor/foreign ownership fail closed', async () => {
  const s = setup(), old = deferred<{ items: Participation[]; nextCursor: null }>(); let first = true;
  s.port.own = async () => { if (first) { first = false; return old.promise; } return { items: [part], nextCursor: null }; };
  const before = s.coordinator.loadOwn(); await s.coordinator.loadOwn(); old.resolve({ items: [], nextCursor: null }); await before;
  assert.deepEqual(s.coordinator.getSnapshot().own.items, [part]);
  s.port.own = async () => ({ items: [], nextCursor: 'loop' }); await s.coordinator.loadOwn(); assert.equal(s.coordinator.getSnapshot().own.status, 'error');
  s.port.own = async () => ({ items: [{ ...part, userId: 'other' }], nextCursor: null }); await s.coordinator.loadDetail(game.id);
  assert.equal(s.coordinator.getSnapshot().details[game.id]?.status, 'error');
});
test('actual DTO parsing and canonical game dedupe require managed projection, never organizer identity', () => {
  const managed = parseManagedGame({ ...game, management: { role: 'manager', createdByMe: false } });
  assert.equal(myGameRows([managed], [part])[0]?.parts.length, 1); assert.equal(myGameRows([managed], [part]).length, 1);
  assert.throws(() => parseManagedGame(game)); assert.throws(() => parseParticipation({ ...part, status: 'invented' }));
  assert.throws(() => parseCursorPage({ items: [] }, parseParticipation));
});
test('transport uses closed bearer-only commands and safe business codes; no cookies, Origin or raw errors', async () => {
  const calls: { url: string; init: RequestInit }[] = []; let response = new Response(JSON.stringify(part), { status: 201 });
  const api = createNativeApi(async (url, init) => { calls.push({ url: String(url), init: init! }); return response.clone(); });
  await api.requestParticipation('private-access', 'game/a', { expectedGameVersion: 7 }, 'exact-key');
  assert.match(calls[0]!.url, /\/games\/game%2Fa\/participations$/);
  assert.equal(calls[0]!.init.credentials, 'omit');
  assert.deepEqual(calls[0]!.init.headers, { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: 'Bearer private-access', 'Idempotency-Key': 'exact-key' });
  for (const status of [403, 409, 422]) {
    response = new Response(JSON.stringify({ code: 'GAME_FULL', detail: 'private-access raw error' }), { status });
    await assert.rejects(api.requestParticipation('private-access', game.id, { expectedGameVersion: 7 }, 'exact-key'), e => e instanceof ParticipationError && e.kind === 'business' && e.code === 'GAME_FULL' && !e.message.includes('private-access'));
  }
});
test('coordinator boundary retains login on business rejection but clears all private rows on 401 and fences logout callbacks', async () => {
  const now = Date.parse('2026-11-14T00:00:00Z'); let status = 200, meNetwork = false;
  let privateGate: ReturnType<typeof deferred<{ items: Participation[]; nextCursor: null }>> | null = null;
  const me = { id: actor.actorId, displayName: 'Игрок', locale: 'ru', linkedProviders: ['vk'], session: { id: actor.sessionId, audience: 'consumer_native', transport: 'bearer' } };
  const credentials = { accessToken: 'a'.repeat(43), refreshToken: 'b'.repeat(43), sessionId: actor.sessionId, tokenType: 'Bearer', expiresIn: 600,
    refreshExpiresAt: '2026-11-21T00:00:00Z', refreshAbsoluteExpiresAt: '2026-12-14T00:00:00Z' };
  const saved = { version: 1, generation: 'g'.repeat(43), returnPath: null, session: { actorId: actor.actorId, sessionId: actor.sessionId,
    refreshToken: credentials.refreshToken, refreshExpiresAt: credentials.refreshExpiresAt, refreshAbsoluteExpiresAt: credentials.refreshAbsoluteExpiresAt } };
  const api = createNativeApi(async url => {
    const path = String(url);
    if (path.endsWith('/auth/native/refresh')) return new Response(JSON.stringify(credentials));
    if (path.endsWith('/me')) { if (meNetwork) throw new Error('connection lost'); return new Response(JSON.stringify(me)); }
    if (privateGate && path.includes('/me/participations')) return new Response(JSON.stringify(await privateGate.promise));
    return new Response(JSON.stringify(status === 200 ? { items: [part], nextCursor: null } : { code: 'GAME_FULL', detail: 'sensitive' }), { status });
  });
  const auth = new AuthCoordinator({ api, store: { getItem: async () => JSON.stringify(saved), setItem: async () => {} }, random: () => 'r'.repeat(43), challenge: async () => '', now: () => now });
  await auth.hydrate(); await auth.participation.loadOwn(); assert.equal(auth.participation.getSnapshot().own.items.length, 1);
  status = 403; await auth.participation.loadOwn(); assert.equal(auth.getSnapshot().status, 'authenticated');
  status = 200; privateGate = deferred(); const stale = auth.participation.loadOwn();
  await new Promise(resolve => setImmediate(resolve));
  meNetwork = true; await auth.validate(); assert.equal(auth.getSnapshot().status, 'unverifiable');
  meNetwork = false; await auth.validate(); assert.equal(auth.getSnapshot().status, 'authenticated');
  privateGate.resolve({ items: [part], nextCursor: null }); await stale; privateGate = null;
  assert.deepEqual(auth.participation.getSnapshot().own.items, []);
  status = 401; await auth.participation.loadOwn(); assert.equal(auth.getSnapshot().status, 'guest');
  assert.equal(auth.participation.getSnapshot().actor, null); assert.deepEqual(auth.participation.getSnapshot().own.items, []);
});

test('closed exact detail read validates real private Game without management and keeps public transport strict', async () => {
  const privateGame = { ...game, status: 'draft', visibility: 'unlisted' };
  const parsed = parseAuthenticatedGame({ ...privateGame, privateExtra: 'discard' });
  assert.equal(parsed.status, 'draft'); assert.equal(parsed.visibility, 'unlisted');
  assert.equal('management' in parsed, false); assert.equal('privateExtra' in parsed, false);
  assert.throws(() => parseManagedGame(privateGame));
  for (const invalid of [{ ...privateGame, version: 0 }, { ...privateGame, venue: {} }, { ...privateGame, availablePlaces: -1 },
    { ...privateGame, settlement: { mode: 'external', purpose: 'trainer_fee', priceStatus: 'fixed', terms: '' } }]) {
    assert.throws(() => parseAuthenticatedGame(invalid), ParticipationError);
  }
  const calls: { url: string; init: RequestInit }[] = [];
  const fetcher: typeof fetch = async (url, init) => { calls.push({ url: String(url), init: init! }); return new Response(JSON.stringify(privateGame)); };
  await createNativeApi(fetcher).gameDetail('private-access', 'game/a');
  assert.match(calls[0]!.url, /\/v1\/games\/game%2Fa$/);
  assert.equal(calls[0]!.init.method, 'GET'); assert.equal(calls[0]!.init.credentials, 'omit'); assert.equal(calls[0]!.init.redirect, 'error');
  assert.deepEqual(calls[0]!.init.headers, { Accept: 'application/json', Authorization: 'Bearer private-access' });
  await assert.rejects(createPublicApi(fetcher).game(game.id), PublicApiError);
  assert.deepEqual(calls[1]!.init.headers, { Accept: 'application/json' });
});
test('only actual public 404 falls back to authorized detail; row and detail share actor-private data without automatic commands', async () => {
  const s = setup(), privateGame: Game = { ...game, status: 'draft', visibility: 'unlisted' };
  let publicError = new PublicApiError('unavailable', 404), privateCalls = 0;
  const coordinator = new ParticipationCoordinator(s.port, () => 'unused-key', async () => { throw publicError; },
    async () => { privateCalls++; return privateGame; });
  coordinator.setActor(actor);
  await Promise.all([coordinator.loadGame(game.id), coordinator.loadDetail(game.id)]);
  assert.equal(privateCalls, 1);
  assert.equal(coordinator.getSnapshot().games[game.id]?.game?.status, 'draft');
  assert.equal(coordinator.getSnapshot().details[game.id]?.game, coordinator.getSnapshot().games[game.id]?.game);
  assert.equal(s.sent.length, 0); assert.equal('management' in coordinator.getSnapshot().games[game.id]!.game!, false);
  for (const error of [new PublicApiError('network'), new PublicApiError('server', 503), new PublicApiError('invalid')]) {
    publicError = error; await coordinator.loadGame(game.id);
    assert.equal(privateCalls, 1); assert.equal(coordinator.getSnapshot().games[game.id]?.status, 'error');
    assert.equal(coordinator.getSnapshot().games[game.id]?.game, undefined);
    assert.equal(coordinator.getSnapshot().details[game.id]?.game, undefined);
  }
});
test('private access rejection clears detail, row resource and late managed projection, preserving UNKNOWN packet', async () => {
  const s = setup(), privateGame: Game = { ...game, visibility: 'unlisted' };
  let denied = false;
  const projection = parseManagedGame({ ...privateGame, management: { role: 'manager', createdByMe: false } });
  s.port.managed = async () => ({ items: [projection], nextCursor: null });
  s.port.send = async () => { throw new ParticipationError('network'); };
  const coordinator = new ParticipationCoordinator(s.port, () => 'immutable-key', async () => { throw new PublicApiError('unavailable', 404); },
    async () => { if (denied) throw new ParticipationError('business', 404); return privateGame; });
  coordinator.setActor(actor); await coordinator.loadManaged(); await coordinator.loadDetail(game.id);
  coordinator.review(game.id, 'request'); await coordinator.confirm(game.id);
  const command = coordinator.getSnapshot().details[game.id]!.command!;
  assert.equal(command.state, 'unknown');
  const late = deferred<{ items: typeof projection[]; nextCursor: null }>();
  s.port.managed = async () => late.promise;
  const managed = coordinator.loadManaged(); denied = true; await coordinator.loadGame(game.id);
  late.resolve({ items: [projection], nextCursor: null }); await managed;
  assert.equal(coordinator.getSnapshot().games[game.id]?.game, undefined);
  assert.equal(coordinator.getSnapshot().details[game.id]?.game, undefined);
  assert.deepEqual(coordinator.getSnapshot().managed.items, []);
  assert.equal(coordinator.getSnapshot().details[game.id]?.command?.packet, command.packet);
  assert.equal(coordinator.getSnapshot().details[game.id]?.command?.state, 'unknown');
  await coordinator.confirm(game.id); assert.equal(coordinator.getSnapshot().details[game.id]?.command?.packet, command.packet);
});
test('late private response cannot reappear after logout or account/session switch; no detail resurrection after row 404', async () => {
  for (const next of [null, { actorId: 'actor-b', sessionId: 'session-b', generation: 2 }, { ...actor, sessionId: 'session-new', generation: 2 }]) {
    const s = setup(), gate = deferred<Game>();
    const coordinator = new ParticipationCoordinator(s.port, () => 'unused', async () => { throw new PublicApiError('unavailable', 404); }, async () => gate.promise);
    coordinator.setActor(actor); const work = coordinator.loadDetail(game.id);
    await new Promise(resolve => setImmediate(resolve)); coordinator.setActor(next);
    gate.resolve({ ...game, visibility: 'unlisted' }); await work;
    assert.deepEqual(coordinator.getSnapshot().games, {}); assert.deepEqual(coordinator.getSnapshot().details, {});
    assert.deepEqual(coordinator.getSnapshot().managed.items, []); assert.equal(s.sent.length, 0);
  }
  const s = setup(), parts = deferred<{ items: Participation[]; nextCursor: null }>(); let denied = false;
  s.port.own = async () => parts.promise;
  const coordinator = new ParticipationCoordinator(s.port, () => 'unused', async () => { throw new PublicApiError('unavailable', 404); },
    async () => { if (denied) throw new ParticipationError('business', 404); return { ...game, visibility: 'unlisted' }; });
  coordinator.setActor(actor); const detail = coordinator.loadDetail(game.id);
  await new Promise(resolve => setImmediate(resolve)); denied = true; await coordinator.loadGame(game.id);
  parts.resolve({ items: [part], nextCursor: null }); await detail;
  assert.equal(coordinator.getSnapshot().details[game.id]?.game, undefined);
  assert.equal(coordinator.getSnapshot().games[game.id]?.game, undefined);
});
