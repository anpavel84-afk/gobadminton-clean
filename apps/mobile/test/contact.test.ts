import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { createNativeApi } from '../src/native-api.ts';
import { ContactCoordinator } from '../src/contact-coordinator.ts';
import { parseContactState, parseContactResult } from '../src/contact.ts';
import { MessagesError } from '../src/messages.ts';

const actor = { actorId: 'A', sessionId: 'session-A', generation: 1 };
const player = { publicPlayerId: 'peer', displayName: 'Игрок', cityId: null, areaKey: null, bio: null, level: null, trainer: false, lookingForGame: false, canRequestContact: true };
const header = { id: 'conversation', kind: 'direct', requestState: 'accepted', version: 1,
  peer: { publicPlayerId: 'peer', displayName: 'Игрок' }, role: 'initiator', lastMessageSeq: '1', readThroughSeq: '0', unreadCount: 0 };
const receipt = { messageId: 'message', conversationId: header.id, seq: '1', createdAt: '2026-11-14T12:00:00.000Z', outcome: 'created' };
const result = { conversation: header, receipt };
const none = { targetPublicPlayerId: 'peer', state: 'none', canRequestContact: true };
const existing = { targetPublicPlayerId: 'peer', state: 'accepted', conversationId: header.id, version: 1 };
const deferred = <T>() => { let resolve!: (v: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; };
function setup() {
  const calls: { path: string; init: RequestInit }[] = []; let keys = 0;
  let handler = async (path: string, _init: RequestInit): Promise<unknown> => path.startsWith('/me/contact-state?') ? none : path.startsWith('/players/') ? player : path === '/conversations/requests' ? result : header;
  const api = createNativeApi(async (url, init) => {
    const path = String(url).replace('https://dev.gobadminton.ru/v1', ''); calls.push({ path, init: init! });
    const value = await handler(path, init!); return value instanceof Response ? value : new Response(JSON.stringify(value));
  });
  const owner = new ContactCoordinator({ state: (id, a) => api.contactState(a.actorId, id), player: (id, a) => api.player(a.actorId, id),
    conversation: (id, a) => api.conversation(a.actorId, id), send: (p, a) => api.createContact(a.actorId, p) }, () => `key-${++keys}`);
  owner.setActor(actor);
  return { owner, calls, api, setHandler: (h: typeof handler) => { handler = h; }, writes: () => calls.filter(c => c.init.method === 'POST') };
}
async function compose(s: ReturnType<typeof setup>) { await s.owner.open('peer'); s.owner.draft('peer', '  Привет!  '); }

test('both guest contact CTAs pass the selected peer to signIn', () => {
  const source = readFileSync(new URL('../src/components/contact-editor.tsx', import.meta.url), 'utf8');
  const action = source.slice(source.indexOf('export function NativeContactAction'), source.indexOf('export function ContactEditor'));
  const editor = source.slice(source.indexOf('export function ContactEditor'));
  for (const entry of [action, editor]) {
    assert.match(entry, /onPress=\{\(\) => \{ void auth\.signIn\(`\/messages\/new\/\$\{target\}`\); \}\}/);
    assert.doesNotMatch(entry, /auth\.signIn\('\/messages'\)/);
  }
});

test('unsent drafts and selection stay hidden through repeated null and restore only for the original owner, without sending', async () => {
  const s = setup(); await compose(s);
  s.setHandler(async path => path.startsWith('/players/') ? { ...player, publicPlayerId: 'other' } : { ...none, targetPublicPlayerId: 'other' });
  await s.owner.open('other'); s.owner.draft('other', 'Второй черновик');
  const drafts = { peer: '  Привет!  ', other: 'Второй черновик' };
  assert.equal(s.owner.getSnapshot().command, undefined);
  const before = s.calls.length;
  s.owner.setActor(null); s.owner.setActor(null);
  assert.deepEqual(s.owner.getSnapshot().drafts, {}); assert.equal(s.owner.getSnapshot().target, null);
  assert.equal(s.owner.getSnapshot().player, null); assert.equal(s.owner.getSnapshot().contact, null);
  s.owner.draft('other', 'unverified edit'); await s.owner.send(); await s.owner.reconcile();
  assert.equal(s.calls.length, before);
  const renewed = { ...actor, sessionId: 'renewed-A', generation: 2 };
  s.owner.setActor(renewed);
  assert.deepEqual(s.owner.getSnapshot().drafts, drafts); assert.equal(s.owner.getSnapshot().target, 'other');
  assert.equal(s.owner.getSnapshot().status, 'idle'); assert.equal(s.owner.getSnapshot().command, undefined);
  await s.owner.open('other'); s.owner.draft('other', 'Можно продолжить', renewed);
  assert.equal(s.owner.getSnapshot().drafts.other, 'Можно продолжить');
  s.owner.setActor(null); s.owner.setActor(null); s.owner.setActor({ ...renewed, generation: 3 });
  assert.equal(s.owner.getSnapshot().drafts.other, 'Можно продолжить');
  assert.equal(s.owner.getSnapshot().drafts.peer, drafts.peer); assert.equal(s.writes().length, 0);
  // A verified different principal permanently erases A's private quarantine.
  s.owner.setActor(null); s.owner.setActor({ actorId: 'B', sessionId: 'B', generation: 4 });
  assert.deepEqual(s.owner.getSnapshot().drafts, {}); assert.equal(s.owner.getSnapshot().target, null);
  s.owner.setActor(actor); assert.deepEqual(s.owner.getSnapshot().drafts, {});
  s.setHandler(async path => path.startsWith('/players/') ? player : none); await compose(s);
  s.owner.setActor(null); s.owner.forget(); s.owner.setActor(actor);
  assert.deepEqual(s.owner.getSnapshot().drafts, {}); assert.equal(s.owner.getSnapshot().target, null);
  assert.equal(s.writes().length, 0);
});

test('old-session reads and rendered callbacks cannot alter restored unsent drafts or selection', async () => {
  const s = setup(); await compose(s); const oldActor = s.owner.getSnapshot().actor;
  const late = deferred<unknown>(); s.setHandler(async () => late.promise);
  const work = s.owner.open('peer');
  s.owner.setActor(null); s.owner.setActor({ ...actor, sessionId: 'new-A', generation: 2 });
  s.setHandler(async path => path.startsWith('/players/') ? player : none); await s.owner.open('peer');
  s.owner.draft('peer', 'Новый текст'); const current = s.owner.getSnapshot();
  late.resolve(existing); await work;
  s.owner.draft('peer', 'stale edit', oldActor); await s.owner.send('peer', oldActor); await s.owner.reconcile('peer', oldActor);
  assert.strictEqual(s.owner.getSnapshot(), current);
  assert.equal(current.drafts.peer, 'Новый текст'); assert.equal(current.conversation, null);
  assert.equal(current.status, 'ready'); assert.equal(s.writes().length, 0);
});

test('actual NativeApi sends exact directory body once on explicit send; opening/reopening never creates', async () => {
  const s = setup(); await compose(s); s.owner.blur(); await s.owner.open('peer');
  assert.equal(s.writes().length, 0); assert.equal(s.owner.getSnapshot().drafts.peer, '  Привет!  ');
  const pending = deferred<unknown>(); s.setHandler(async path => path === '/conversations/requests' ? pending.promise : path.startsWith('/players/') ? player : none);
  const work = s.owner.send(); await s.owner.send(); await new Promise(r => setImmediate(r));
  assert.equal(s.writes().length, 1);
  const packet = s.owner.getSnapshot().command!.packet;
  assert.ok(Object.isFrozen(packet)); assert.ok(Object.isFrozen(packet.body)); assert.ok(Object.isFrozen(packet.actor));
  assert.deepEqual(JSON.parse(s.writes()[0]!.init.body as string), { targetPublicPlayerId: 'peer', text: 'Привет!', clientMessageId: packet.body.clientMessageId });
  const headers = s.writes()[0]!.init.headers as Record<string, string>;
  assert.equal(headers['Idempotency-Key'], packet.key); assert.equal(headers.Authorization, 'Bearer A');
  assert.equal(headers.Origin, undefined); assert.equal(headers.Cookie, undefined); assert.equal(s.writes()[0]!.init.credentials, 'omit');
  pending.resolve(result); await work;
  assert.equal(s.owner.getSnapshot().command, undefined); assert.equal(s.owner.getSnapshot().conversation?.id, header.id);
  assert.equal(s.owner.getSnapshot().drafts.peer, undefined);
});

test('strict contact target/state and receipt validation rejects malformed, mismatched or private identity', () => {
  for (const value of [{ ...none, targetPublicPlayerId: 'other' }, { ...none, canRequestContact: undefined }, { ...none, state: 'invented' },
    { ...existing, version: 0 }, { ...existing, conversationId: null }, { ...none, conversationId: header.id }]) assert.throws(() => parseContactState(value, 'peer'), MessagesError);
  for (const value of [{ ...result, conversation: { ...header, peer: { ...header.peer, publicPlayerId: 'other' } } },
    { ...result, receipt: { ...receipt, conversationId: 'other' } }, { ...result, receipt: { ...receipt, messageId: '' } },
    { ...result, receipt: { ...receipt, seq: '0' } }, { ...result, receipt: { ...receipt, seq: 1 } },
    { ...result, receipt: { ...receipt, createdAt: 'bad' } }, { ...result, receipt: { ...receipt, createdAt: '2026-02-30T12:00:00.000Z' } }, { ...result, receipt: { ...receipt, outcome: 'ok' } }, { ...result, receipt: { ...receipt, outcome: ['created'] } }]) assert.throws(() => parseContactResult(value, 'peer'), MessagesError);
  assert.equal(parseContactResult(result, 'peer').receipt.outcome, 'created');
});

test('receipt sequence cannot exceed the header, while an older duplicate remains valid', () => {
  for (const outcome of ['created', 'duplicate']) {
    for (const [lastMessageSeq, sequence] of [['1', '2'], ['9007199254740992', '9007199254740993']]) {
      assert.throws(() => parseContactResult({ conversation: { ...header, lastMessageSeq }, receipt: { ...receipt, seq: sequence, outcome } }, 'peer'),
        (error: unknown) => error instanceof MessagesError && error.kind === 'invalid');
    }
  }
  const older = parseContactResult({ conversation: { ...header, lastMessageSeq: '10' }, receipt: { ...receipt, outcome: 'duplicate' } }, 'peer');
  assert.equal(older.receipt.seq, '1'); assert.equal(older.conversation.lastMessageSeq, '10');
  assert.equal(parseContactResult(result, 'peer').receipt.seq, '1');
});

test('actual NativeApi HTTP200 inconsistent receipt stays UNKNOWN until explicit valid same-packet reconciliation', async () => {
  const s = setup(); await compose(s);
  const inconsistent = { ...result, receipt: { ...receipt, seq: '2' } };
  s.setHandler(async path => path === '/conversations/requests'
    ? new Response(JSON.stringify(inconsistent), { status: 200 }) : path.startsWith('/players/') ? player : none);
  await s.owner.send();
  const packet = s.owner.getSnapshot().command!.packet;
  assert.equal(s.owner.getSnapshot().command!.status, 'unknown');
  assert.ok(Object.isFrozen(packet)); assert.ok(Object.isFrozen(packet.body)); assert.ok(Object.isFrozen(packet.actor));
  assert.equal(s.owner.getSnapshot().drafts.peer, '  Привет!  '); assert.equal(s.owner.getSnapshot().conversation, null);
  s.owner.blur(); await s.owner.open('peer');
  assert.equal(s.writes().length, 1); assert.strictEqual(s.owner.getSnapshot().command!.packet, packet);
  await s.owner.reconcile();
  assert.equal(s.owner.getSnapshot().command!.status, 'unknown'); assert.strictEqual(s.owner.getSnapshot().command!.packet, packet);
  // A real duplicate can predate subsequent messages in the authoritative header.
  const duplicate = { conversation: { ...header, lastMessageSeq: '10' }, receipt: { ...receipt, outcome: 'duplicate' } };
  s.setHandler(async path => path === '/conversations/requests'
    ? new Response(JSON.stringify(duplicate), { status: 200 }) : path.startsWith('/players/') ? player : none);
  assert.equal(s.writes().length, 2);
  await s.owner.reconcile();
  assert.equal(s.writes().length, 3);
  for (const write of s.writes()) {
    assert.equal(write.init.body, s.writes()[0]!.init.body);
    assert.deepEqual(write.init.headers, s.writes()[0]!.init.headers);
    assert.equal((write.init.headers as Record<string, string>)['Idempotency-Key'], packet.key);
    assert.deepEqual(JSON.parse(write.init.body as string), packet.body);
  }
  assert.equal(s.owner.getSnapshot().command, undefined); assert.equal(s.owner.getSnapshot().drafts.peer, undefined);
  assert.equal(s.owner.getSnapshot().conversation?.lastMessageSeq, '10');
});

test('actual HTTP 5xx with business codes, invalid receipts, COMMAND_IN_PROGRESS and network remain UNKNOWN with original form/packet', async () => {
  const failures = [new Response(JSON.stringify({ code: 'RESOURCE_UNAVAILABLE' }), { status: 503 }),
    new Response(JSON.stringify({ code: 'PRIVATE_TEXT_CONTENT_REJECTED' }), { status: 500 }),
    new Response(JSON.stringify({ code: 'COMMAND_IN_PROGRESS' }), { status: 409 }),
    new Response('not-json'), { ...result, receipt: { ...receipt, conversationId: 'wrong' } },
    { ...result, conversation: { ...header, peer: { ...header.peer, publicPlayerId: 'wrong' } } }];
  for (const failure of [...failures, null]) {
    const s = setup(); await compose(s);
    s.setHandler(async path => { if (path !== '/conversations/requests') return path.startsWith('/players/') ? player : none;
      if (failure === null) throw new Error('timeout/network'); return failure; });
    await s.owner.send(); const command = s.owner.getSnapshot().command!;
    assert.equal(command.status, 'unknown'); assert.equal(s.owner.getSnapshot().drafts.peer, '  Привет!  ');
    s.owner.blur(); await s.owner.open('peer'); assert.strictEqual(s.owner.getSnapshot().command!.packet, command.packet);
    assert.equal(s.writes().length, 1);
    s.setHandler(async path => path === '/conversations/requests' ? result : path.startsWith('/players/') ? player : none);
    await s.owner.reconcile(); assert.equal(s.writes().length, 2);
    assert.equal(s.writes()[0]!.init.body, s.writes()[1]!.init.body);
    assert.deepEqual(s.writes()[0]!.init.headers, s.writes()[1]!.init.headers);
    assert.equal(s.owner.getSnapshot().command, undefined);
  }
});

test('eligibility is rechecked before explicit sending; blank/long text and unavailable targets never write', async () => {
  const s = setup(); await s.owner.open('peer');
  for (const text of ['  ', 'x'.repeat(2001)]) { s.owner.draft('peer', text); await s.owner.send(); }
  assert.equal(s.writes().length, 0);
  s.owner.draft('peer', 'hello'); s.setHandler(async path => path.startsWith('/players/') ? { ...player, canRequestContact: false } : none);
  await s.owner.send(); assert.equal(s.writes().length, 0); assert.equal(s.owner.getSnapshot().status, 'unavailable');
  s.setHandler(async () => ({ ...none, targetPublicPlayerId: 'other' })); await s.owner.open('peer');
  assert.equal(s.owner.getSnapshot().conversation, null); assert.equal(s.owner.getSnapshot().contact, null);
  s.setHandler(async () => new Response(JSON.stringify({code:'RESOURCE_UNAVAILABLE'}),{status:404}));
  await s.owner.open('peer'); assert.equal(s.owner.getSnapshot().status,'unavailable'); assert.equal(s.writes().length,0);
});

test('accepted and both pending states require matching existing header; 409 race rereads without autosend or replacement', async () => {
  for (const state of ['accepted','pending_incoming','pending_outgoing']) {
    const s = setup(); s.setHandler(async path => path.startsWith('/me/contact-state?') ? { ...existing, state } : { ...header, requestState: state === 'accepted' ? 'accepted' : 'pending' });
    await s.owner.open('peer'); assert.equal(s.owner.getSnapshot().status, 'existing'); assert.equal(s.writes().length, 0);
    s.setHandler(async path => path.startsWith('/me/contact-state?') ? existing : { ...header, peer: { ...header.peer, publicPlayerId: 'wrong' } });
    await s.owner.open('peer'); assert.equal(s.owner.getSnapshot().conversation, null);
  }
  const s = setup(); await compose(s); let raced = false;
  s.setHandler(async path => {
    if (path === '/conversations/requests') { raced = true; return new Response(JSON.stringify({ code: 'CONVERSATION_ALREADY_OPEN' }), { status: 409 }); }
    if (path.startsWith('/me/contact-state?')) return raced ? existing : none;
    return path.startsWith('/players/') ? player : header;
  });
  await s.owner.send(); assert.equal(s.writes().length, 1); assert.equal(s.owner.getSnapshot().command, undefined);
  assert.equal(s.owner.getSnapshot().conversation?.peer.publicPlayerId, 'peer'); assert.equal(s.owner.getSnapshot().drafts.peer, '  Привет!  ');
});

test('navigation and same-owner reauth quarantine pending, fence late results, and explicitly reconcile same packet; B/logout wipe', async () => {
  const s = setup(); await compose(s); const late = deferred<unknown>();
  s.setHandler(async path => path === '/conversations/requests' ? late.promise : path.startsWith('/players/') ? player : none);
  const work = s.owner.send(); await new Promise(r => setImmediate(r)); const packet = s.owner.getSnapshot().command!.packet;
  s.owner.blur(); s.owner.setActor(null); assert.equal(s.owner.getSnapshot().command, undefined); assert.deepEqual(s.owner.getSnapshot().drafts, {});
  s.owner.setActor({ ...actor, sessionId: 'new', generation: 2 }); await s.owner.open('peer');
  assert.strictEqual(s.owner.getSnapshot().command!.packet, packet); assert.equal(s.writes().length, 1);
  late.resolve(result); await work; assert.equal(s.owner.getSnapshot().conversation, null); assert.equal(s.owner.getSnapshot().command!.status, 'unknown');
  s.setHandler(async path => path === '/conversations/requests' ? result : path.startsWith('/players/') ? player : none);
  await s.owner.reconcile(); assert.equal(s.writes()[1]!.init.body, s.writes()[0]!.init.body);
  await compose(s); s.setHandler(async path => { if (path === '/conversations/requests') throw Error('unknown'); return path.startsWith('/players/') ? player : none; });
  await s.owner.send(); s.owner.setActor(null); s.owner.setActor({ actorId: 'B', sessionId: 'B', generation: 3 });
  assert.equal(s.owner.getSnapshot().command, undefined); assert.deepEqual(s.owner.getSnapshot().drafts, {});
  s.owner.setActor(actor); assert.equal(s.owner.getSnapshot().command, undefined);
  await compose(s); await s.owner.send(); s.owner.forget(); s.owner.setActor(actor);
  assert.equal(s.owner.getSnapshot().command, undefined); assert.deepEqual(s.owner.getSnapshot().drafts, {});
});

test('late navigation A→other→A completion cannot navigate or settle; known controlled 4xx preserves draft with safe guidance', async () => {
  const s = setup(); await compose(s); const late = deferred<unknown>();
  s.setHandler(async path => path === '/conversations/requests' ? late.promise : path.startsWith('/players/') ? player : none);
  const work = s.owner.send(); await new Promise(r => setImmediate(r));
  s.owner.blur(); await s.owner.open('other'); s.owner.blur(); await s.owner.open('peer');
  late.resolve(result); await work; assert.equal(s.owner.getSnapshot().conversation, null); assert.equal(s.owner.getSnapshot().command?.status, 'unknown');
  const p = setup(); await compose(p); p.setHandler(async path => path === '/conversations/requests'
    ? new Response(JSON.stringify({ code: 'PRIVATE_TEXT_CONTENT_REJECTED', detail: 'untrusted identity' }), { status: 422 }) : path.startsWith('/players/') ? player : none);
  await p.owner.send(); assert.equal(p.owner.getSnapshot().command, undefined); assert.equal(p.owner.getSnapshot().drafts.peer, '  Привет!  ');
  assert.doesNotMatch(JSON.stringify(p.owner.getSnapshot()), /untrusted identity/);
});


test('stale rendered actor/target cannot edit, send or reconcile a newer screen/account command', async () => {
  const s = setup(); await compose(s); const oldActor = s.owner.getSnapshot().actor;
  s.owner.setActor({actorId:'B',sessionId:'B',generation:2}); await s.owner.open('peer');
  s.owner.draft('peer','B private draft'); s.owner.draft('peer','stale A edit',oldActor);
  assert.equal(s.owner.getSnapshot().drafts.peer,'B private draft');
  await s.owner.send('peer',oldActor); await s.owner.send('other',s.owner.getSnapshot().actor);
  assert.equal(s.writes().length,0);
  s.setHandler(async path => { if(path === '/conversations/requests') throw Error('unknown'); return path.startsWith('/players/') ? player : none; });
  await s.owner.send(); const packet=s.owner.getSnapshot().command!.packet;
  await s.owner.reconcile('peer',oldActor); await s.owner.reconcile('other',s.owner.getSnapshot().actor);
  assert.equal(s.writes().length,1); assert.strictEqual(s.owner.getSnapshot().command!.packet,packet);
});

test('editor callbacks bind the rendered view; same-peer same-session return rejects old edit/send/reconcile but accepts rapid current actions', async () => {
  const source = readFileSync(new URL('../src/components/contact-editor.tsx', import.meta.url), 'utf8');
  assert.match(source, /onChangeText=\{value => owner\.draft\(target, value, state\.actor, state\.viewGeneration\)\}/);
  for (const action of ['send', 'reconcile']) assert.ok(source.includes(`void owner.${action}(target, state.actor, state.viewGeneration)`));
  const s = setup(); await compose(s);
  const callbacks = () => {
    const state = s.owner.getSnapshot(), target = state.target!;
    return { state, edit: (text: string) => s.owner.draft(target, text, state.actor, state.viewGeneration),
      send: () => s.owner.send(target, state.actor, state.viewGeneration),
      reconcile: () => s.owner.reconcile(target, state.actor, state.viewGeneration) };
  };
  const old = callbacks();
  const returnToPeer = async () => {
    s.owner.blur();
    s.setHandler(async path => path.startsWith('/players/') ? { ...player, publicPlayerId: 'other' } : { ...none, targetPublicPlayerId: 'other' });
    await s.owner.open('other'); s.owner.blur();
    s.setHandler(async path => path.startsWith('/players/') ? player : none); await s.owner.open('peer');
  };
  await returnToPeer(); const current = callbacks();
  assert.strictEqual(current.state.actor, old.state.actor); // Identical actor, session and peer; only the view changed.
  assert.equal(current.state.target, old.state.target); assert.notEqual(current.state.viewGeneration, old.state.viewGeneration);
  current.edit('Н'); current.edit('Но'); current.edit('Новый текст');
  assert.equal(s.owner.getSnapshot().drafts.peer, 'Новый текст');
  assert.equal(s.owner.getSnapshot().viewGeneration, current.state.viewGeneration);
  const before = s.owner.getSnapshot(), reads = s.calls.length;
  old.edit('queued stale edit'); await old.send(); await old.reconcile();
  assert.strictEqual(s.owner.getSnapshot(), before); assert.equal(s.calls.length, reads); assert.equal(s.writes().length, 0);
  s.setHandler(async path => { if (path === '/conversations/requests') throw Error('unknown'); return path.startsWith('/players/') ? player : none; });
  await current.send();
  assert.equal(s.writes().length, 1); assert.equal(JSON.parse(s.writes()[0]!.init.body as string).text, 'Новый текст');
  assert.equal(s.owner.getSnapshot().viewGeneration, current.state.viewGeneration);
  const unknown = callbacks(), packet = unknown.state.command!.packet;
  await returnToPeer();
  const reopened = callbacks(), pending = s.owner.getSnapshot(), calls = s.calls.length;
  unknown.edit('stale'); await unknown.send(); await unknown.reconcile(); await old.reconcile();
  assert.strictEqual(s.owner.getSnapshot(), pending); assert.equal(s.calls.length, calls); assert.equal(s.writes().length, 1);
  assert.strictEqual(pending.command!.packet, packet); assert.equal(pending.command!.status, 'unknown');
  assert.equal(pending.drafts.peer, 'Новый текст');
  s.setHandler(async path => path === '/conversations/requests' ? result : path.startsWith('/players/') ? player : none);
  await reopened.reconcile();
  assert.equal(s.writes().length, 2); assert.equal(s.writes()[1]!.init.body, s.writes()[0]!.init.body);
  assert.deepEqual(s.writes()[1]!.init.headers, s.writes()[0]!.init.headers);
  assert.equal(s.owner.getSnapshot().command, undefined); assert.equal(s.owner.getSnapshot().conversation?.id, header.id);
});

test('view generations change on open, blur, authoritative actor change and forget', async () => {
  const s = setup(); await compose(s); let view = s.owner.getSnapshot().viewGeneration;
  const changed = () => { assert.notEqual(s.owner.getSnapshot().viewGeneration, view); view = s.owner.getSnapshot().viewGeneration; };
  await s.owner.open('peer'); changed();
  s.owner.blur(); changed();
  s.owner.setActor(null); changed();
  s.owner.setActor(actor); changed();
  s.owner.forget(); changed();
});
