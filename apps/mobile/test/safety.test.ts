import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { SafetyCoordinator, safetyPeerId } from '../src/safety-coordinator.ts';
import { createNativeApi } from '../src/native-api.ts';
import { parseSafetyReceipt, REPORT_REASONS, reportDetail, reportable, SafetyError } from '../src/safety.ts';
import type { SafetyPacket } from '../src/safety.ts';
import type { DirectMessage } from '../src/messages.ts';
const actor = { actorId: 'A', sessionId: 'session-A', generation: 1 };
const context = { peerId: 'peer', name: 'Игрок', conversationId: 'conversation' };
const message: DirectMessage = { id: 'incoming', conversationId: 'conversation', authorPublicPlayerId: 'peer', kind: 'text', seq: '1', contentState: 'live', text: 'Private loaded message', createdAt: '2026-11-14T00:00:00Z' };
const report = { reportId: 'ec05b131-750e-4b91-a1a1-425373c3fba0', status: 'submitted', createdAt: '2026-11-14T00:00:00.000Z' };
const deferred = <T>() => { let resolve!: (v: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { resolve, promise }; };
function setup() {
  const calls: { path: string; init: RequestInit }[] = [], effects: unknown[] = [], rereads: unknown[] = [];
  let serial = 0, handler = async (packet: { path: string; init: RequestInit }): Promise<unknown> => packet.path === '/reports' ? report : { publicPlayerId: 'peer', blocked: packet.init.method === 'PUT' };
  const api = createNativeApi(async (url, init) => {
    const call = { path: String(url).replace('https://dev.gobadminton.ru/v1', ''), init: init! }; calls.push(call);
    const result = await handler(call); return result instanceof Response ? result : new Response(JSON.stringify(result));
  });
  const owner = new SafetyCoordinator({ send: (p, a) => api.safetyMutation(a.actorId, p), verified: (...args) => { effects.push(args); }, reread: (...args) => { rereads.push(args); } }, () => `key-${++serial}`);
  owner.setActor(actor); owner.open(context);
  const view = () => owner.getSnapshot().viewGeneration;
  return { owner, api, calls, effects, rereads, view, handler: (fn: typeof handler) => { handler = fn; } };
}
test('exact reasons, blank detail, closed wire projection and strict receipts with no invented target echo', async () => {
  assert.deepEqual(REPORT_REASONS.map(r => [r.code, r.label]), [['harassment','Оскорбления / давление'],['spam','Спам'],['fake_profile','Поддельный профиль'],['inappropriate','Неприемлемый контент'],['other','Другое']]);
  assert.equal(reportDetail('  '), null); assert.equal(reportDetail(' text '), 'text'); assert.throws(() => reportDetail('a'.repeat(1001)));
  const s = setup(); s.owner.choose('block', s.view(), actor); await s.owner.submit([], s.view(), actor);
  s.owner.choose('unblock', s.view(), actor); await s.owner.submit([], s.view(), actor);
  s.owner.choose('player', s.view(), actor); s.owner.edit('spam', '  ', s.view(), actor); await s.owner.submit([], s.view(), actor);
  assert.deepEqual(s.calls.map(c => [c.path, c.init.method, JSON.parse(c.init.body as string)]), [
    ['/me/blocks/peer','PUT',{}], ['/me/blocks/peer','DELETE',{}], ['/reports','POST',{ targetKind: 'player', targetPublicPlayerId: 'peer', reasonCode: 'spam', detail: null }],
  ]);
  for (const c of s.calls) {
    assert.equal(c.init.credentials, 'omit'); assert.equal(c.init.redirect, 'error');
    assert.deepEqual(Object.keys(c.init.headers!).sort(), ['Accept','Authorization','Content-Type','Idempotency-Key'].sort());
  }
  const p = { actor, context, key: 'key', action: 'report', method: 'POST', path: '/reports', body: { targetKind: 'player', targetPublicPlayerId: 'peer', reasonCode: 'other', detail: null } } as const;
  assert.deepEqual(parseSafetyReceipt(p, report), report);
  for (const bad of [{...report,reportId:''}, {...report,status:'done'}, {...report,createdAt:'2026-02-30T00:00:00Z'}, {...report,createdAt:'yesterday'}]) assert.throws(() => parseSafetyReceipt(p,bad));
  // Even a caller object carrying forbidden extras cannot widen native request bodies or routes.
  await s.api.safetyMutation('access', {...p,path:'https://evil.test',body:{...p.body,evidenceRefs:['no'],text:'no',authorPublicPlayerId:'no'}} as unknown as SafetyPacket);
  assert.deepEqual(JSON.parse(s.calls.at(-1)!.init.body as string),p.body);
});
test('only explicitly selected loaded live incoming peer message plus initially-off sharing consent can submit', async () => {
  const s = setup(), v = s.view(); s.owner.choose('message', v, actor);
  const bad = [{...message,authorPublicPlayerId:'own'}, {...message,contentState:'purged' as const}, {...message,text:' '}, {...message,conversationId:'other'}];
  for (const m of bad) { assert.equal(reportable(m,context), false); s.owner.select(m.id,[m],v,actor); assert.equal(s.owner.getSnapshot().selected,null); }
  s.owner.select(message.id,[message],v,actor); await s.owner.submit([message],v,actor); assert.equal(s.calls.length,0);
  s.owner.consent(true,v,actor); s.owner.select(message.id,[message],v,actor); assert.equal(s.owner.getSnapshot().consent,false);
  s.owner.consent(true,v,actor); await s.owner.submit([],v,actor); assert.equal(s.calls.length,0);
  s.owner.edit('inappropriate',' Detail ',v,actor); await s.owner.submit([message],v,actor);
  assert.deepEqual(JSON.parse(s.calls[0]!.init.body as string), { targetKind:'message',messageId:message.id,conversationId:'conversation',reasonCode:'inappropriate',detail:'Detail',shareMessageWithSupport:true });
  assert.doesNotMatch(s.calls[0]!.init.body as string,/Private loaded message|author|evidenceRefs/);
  s.owner.choose('message',v,actor); s.owner.select(message.id,[message],v,actor); s.owner.consent(true,v,actor);
  s.owner.open({...context,conversationId:'other'}); assert.equal(s.owner.getSnapshot().consent,false); assert.equal(s.owner.getSnapshot().selected,null);
});
test('open/select/cancel never write; rendered generation rejects same-actor same-peer stale edit/submit/reconcile', async () => {
  const s = setup(), old = s.view(); s.owner.choose('player',old,actor); s.owner.edit('spam','draft',old,actor); s.owner.cancel(old,actor);
  s.owner.blur(old); s.owner.open(context); const v = s.view(); s.owner.choose('player',v,actor);
  s.owner.edit('spam','stale',old,actor); s.owner.select(message.id,[message],old,actor); await s.owner.submit([message],old,actor); await s.owner.reconcile(old,actor);
  assert.equal(s.calls.length,0); assert.equal(s.owner.getSnapshot().detail,'');
});
test('same-context focus preserves unsent message form, resets sharing, fences old views and permits rapid current edits', async () => {
  const s = setup(), old = s.view(); s.owner.choose('message',old,actor);
  s.owner.edit('spam','Unsent message report',old,actor);
  s.owner.select(message.id,[message],old,actor); s.owner.consent(true,old,actor);
  assert.equal(s.owner.getSnapshot().selected,message.id); assert.equal(s.owner.getSnapshot().consent,true);
  s.owner.setActor(null);
  const returned = {...actor,sessionId:'returned',generation:2}; s.owner.setActor(returned);
  const restored = s.view();
  s.owner.blur(old); // Cleanup of the pre-reauth focus effect must not erase the restored view.
  s.owner.open({...context,name:'Обновлённое имя'}); const v = s.view();
  assert.notEqual(v,old); assert.notEqual(v,restored);
  assert.equal(s.owner.getSnapshot().dialog,'message'); assert.equal(s.owner.getSnapshot().reason,'spam');
  assert.equal(s.owner.getSnapshot().detail,'Unsent message report');
  assert.equal(s.owner.getSnapshot().context?.name,'Обновлённое имя');
  assert.equal(s.owner.getSnapshot().selected,null); assert.equal(s.owner.getSnapshot().consent,false);
  for (const stale of [old,restored]) {
    s.owner.choose('block',stale,returned); s.owner.edit('other','stale',stale,returned);
    s.owner.select(message.id,[message],stale,returned); s.owner.consent(true,stale,returned);
    s.owner.cancel(stale,returned); s.owner.blur(stale);
    await s.owner.submit([message],stale,returned); await s.owner.reconcile(stale,returned);
  }
  s.owner.edit('other','wrong actor',v,actor); await s.owner.submit([message],v,actor);
  assert.equal(s.owner.getSnapshot().detail,'Unsent message report'); assert.equal(s.owner.getSnapshot().dialog,'message');
  // Consecutive native text events share the current render's view/actor until rerender.
  for (const text of ['Н','Но','Нов','Новый текст']) s.owner.edit('spam',text,v,returned);
  assert.equal(s.owner.getSnapshot().detail,'Новый текст');
  s.owner.select(message.id,[message],v,returned); s.owner.consent(true,v,returned);
  s.owner.open(context); // Repeated focus under unchanged verified authority also resets sharing.
  assert.equal(s.owner.getSnapshot().detail,'Новый текст'); assert.equal(s.owner.getSnapshot().reason,'spam');
  assert.equal(s.owner.getSnapshot().selected,null); assert.equal(s.owner.getSnapshot().consent,false);
  await s.owner.submit([message],s.view(),returned); assert.equal(s.calls.length,0);
  for (const next of [{...context,conversationId:'other'}, {...context,peerId:'other-peer'}, context]) {
    s.owner.open(next);
    assert.equal(s.owner.getSnapshot().detail,''); assert.equal(s.owner.getSnapshot().reason,'harassment');
    assert.equal(s.owner.getSnapshot().dialog,null); assert.equal(s.owner.getSnapshot().selected,null); assert.equal(s.owner.getSnapshot().consent,false);
  }
  assert.equal(s.calls.length,0); assert.equal(s.effects.length,0); assert.equal(s.owner.getSnapshot().command,undefined);
});
test('double dispatch, network/5xx/in-progress/invalid receipts retain one frozen packet; explicit reconciliation uses identical key/body', async () => {
  const s = setup(), gate = deferred<unknown>(), v = s.view(); s.handler(async () => gate.promise);
  s.owner.choose('block',v,actor); const work = s.owner.submit([],v,actor); await s.owner.submit([],v,actor); assert.equal(s.calls.length,1);
  const packet = s.owner.getSnapshot().command!.packet;
  assert.ok(Object.isFrozen(packet)); assert.ok(Object.isFrozen(packet.actor)); assert.ok(Object.isFrozen(packet.context)); assert.ok(Object.isFrozen(packet.body));
  gate.resolve({publicPlayerId:'someone-else',blocked:true}); await work;
  for (const value of [new Response('{}',{status:503}), new Response(JSON.stringify({code:'COMMAND_IN_PROGRESS'}),{status:409}), new Response(JSON.stringify({code:'RESOURCE_UNAVAILABLE'}),{status:404}), {publicPlayerId:'peer',blocked:false}]) {
    assert.equal(s.owner.getSnapshot().command?.status,'unknown'); assert.equal(s.effects.length,0);
    s.handler(async () => value); await s.owner.reconcile(v,actor);
    assert.strictEqual(s.owner.getSnapshot().command?.packet,packet);
  }
  s.handler(async () => { throw new Error('timeout'); }); await s.owner.reconcile(v,actor);
  s.handler(async () => ({publicPlayerId:'peer',blocked:true})); await s.owner.reconcile(v,actor);
  assert.equal(s.owner.getSnapshot().command,undefined); assert.equal(s.effects.length,0); assert.deepEqual(s.rereads,[[context,actor]]);
  for (const c of s.calls) { assert.equal(c.init.body,s.calls[0]!.init.body); assert.equal((c.init.headers as Record<string,string>)['Idempotency-Key'],packet.key); }
  s.owner.choose('unblock',v,actor); await s.owner.submit([],v,actor); // wrong boolean is UNKNOWN, never stale block success
  assert.equal(s.owner.getSnapshot().command?.status,'unknown'); assert.doesNotMatch(s.owner.getSnapshot().notice!,/^Игрок заблокирован/);
});
test('navigation quarantines late receipt as UNKNOWN; same-owner authority restores original actor packet, account B/logout erase', async () => {
  const s = setup(), gate = deferred<unknown>(); s.handler(async () => gate.promise); s.owner.choose('player',s.view(),actor);
  const work = s.owner.submit([],s.view(),actor), packet = s.owner.getSnapshot().command!.packet;
  s.owner.blur(s.view()); s.owner.open(context); gate.resolve(report); await work;
  assert.strictEqual(s.owner.getSnapshot().command?.packet,packet); assert.equal(s.owner.getSnapshot().command?.status,'unknown'); assert.equal(s.effects.length,0);
  s.owner.setActor(null); s.owner.setActor(null); assert.equal(s.owner.getSnapshot().command,undefined); assert.equal(s.owner.getSnapshot().detail,'');
  const returned = {...actor,sessionId:'new-session',generation:2}; s.owner.setActor(returned);
  assert.strictEqual(s.owner.getSnapshot().command?.packet,packet); assert.equal(packet.actor.sessionId,actor.sessionId); assert.equal(s.calls.length,1);
  s.handler(async () => report); s.owner.open(context); await s.owner.reconcile(s.view(),returned);
  assert.equal(s.owner.getSnapshot().command,undefined); assert.equal(s.calls.length,2);
  s.owner.choose('player',s.view(),returned); s.handler(async () => { throw new SafetyError('network'); }); await s.owner.submit([],s.view(),returned);
  s.owner.setActor({...returned,actorId:'B',generation:3}); assert.equal(s.owner.getSnapshot().command,undefined); assert.equal(s.owner.getSnapshot().context,null);
  s.owner.setActor(actor); assert.equal(s.owner.getSnapshot().command,undefined);
  const late = deferred<unknown>(); s.handler(async () => late.promise); s.owner.open(context); s.owner.choose('block',s.view(),actor);
  const old = s.owner.submit([],s.view(),actor); s.owner.forget(); late.resolve({publicPlayerId:'peer',blocked:true}); await old;
  s.owner.setActor(actor); assert.equal(s.owner.getSnapshot().command,undefined); assert.deepEqual(s.owner.getSnapshot().lastBlocks,{}); assert.equal(s.effects.length,0);
});

test('profile safety has receipt-independent explicit unblock and invalid route focus is inert', async () => {
  // Source wiring complements the transport regression: Node does not render React Native.
  const route = readFileSync(new URL('../app/players/[publicPlayerId].tsx', import.meta.url), 'utf8');
  const controls = readFileSync(new URL('../src/components/safety.tsx', import.meta.url), 'utf8');
  const thread = readFileSync(new URL('../src/components/messages.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(thread, /lastBlocks/);
  assert.match(thread, /owner.isPeerSafetyHeld\(direct.peer.publicPlayerId\)/);
  assert.match(route, /safetyPeerId\(params.publicPlayerId\)/);
  assert.match(route, /id && auth.status === 'authenticated' &&\s*<NativeSafety/);
  assert.doesNotMatch(route, /lastBlocks|lastNames|Игрок \$\{id\}/);
  assert.match(controls, /title="Снять мою блокировку" onPress=\{\(\) => owner.choose\('unblock'/);
  const s = setup(), before = s.owner.getSnapshot();
  for (const id of ['', '../peer', 'peer/other', 'x'.repeat(129), ['peer'], undefined]) {
    assert.equal(safetyPeerId(id), null);
    assert.doesNotThrow(() => s.owner.open({ peerId: id as string, name: 'Игрок' }));
    assert.strictEqual(s.owner.getSnapshot(), before);
  }
  assert.doesNotThrow(() => s.owner.open({ ...context, conversationId: '../thread' }));
  assert.strictEqual(s.owner.getSnapshot(), before);
  assert.equal(safetyPeerId('ec05b131-750e-4b91-a1a1-425373c3fba0'), 'ec05b131-750e-4b91-a1a1-425373c3fba0');
  assert.equal(s.calls.length, 0);
});

test('historical block receipt survives same-owner reauth as history without replaying a peer fence', async () => {
  const s = setup(); s.owner.choose('block', s.view(), actor); await s.owner.submit([], s.view(), actor);
  assert.equal(s.effects.length, 1); assert.equal(s.owner.getSnapshot().lastBlocks.peer, true);
  s.owner.setActor(null);
  const returned = { ...actor, sessionId: 'returned', generation: 2 };
  s.owner.setActor(returned); s.owner.open(context);
  assert.equal(s.owner.getSnapshot().lastBlocks.peer, true);
  assert.equal(s.effects.length, 1); assert.equal(s.calls.length, 1);
  s.owner.choose('unblock', s.view(), returned); await s.owner.submit([], s.view(), returned);
  assert.equal(s.effects.length, 2); assert.deepEqual(s.effects[1], ['peer', false, context]);
});

test('late historical block reconciliation cannot reread or fence a replaced focus/session or logout', async () => {
  for (const boundary of ['focus', 'session', 'logout'] as const) {
    const s = setup(); s.handler(async () => { throw new SafetyError('network'); });
    s.owner.choose('block', s.view(), actor); await s.owner.submit([], s.view(), actor);
    const packet = s.owner.getSnapshot().command!.packet, gate = deferred<unknown>();
    s.handler(async () => gate.promise); const replay = s.owner.reconcile(s.view(), actor);
    if (boundary === 'focus') { s.owner.blur(s.view()); s.owner.open(context); }
    if (boundary === 'session') s.owner.setActor({ ...actor, sessionId: 'replaced', generation: 2 });
    if (boundary === 'logout') s.owner.forget();
    gate.resolve({ publicPlayerId: 'peer', blocked: true }); await replay;
    assert.deepEqual(s.effects, []); assert.deepEqual(s.rereads, []); assert.deepEqual(s.owner.getSnapshot().lastBlocks, {});
    if (boundary !== 'logout') assert.strictEqual(s.owner.getSnapshot().command?.packet, packet);
    else assert.equal(s.owner.getSnapshot().command, undefined);
    assert.equal(s.calls.length, 2);
  }
});

test('#522 APK54 root: game message report wires gameId-only after consent; DM conversationId regression', async () => {
  const s = setup();
  const gameContext = { peerId: 'peer', name: 'Игрок', conversationId: 'chat-conv', gameId: 'game-1' };
  const gameMessage: DirectMessage = { ...message, conversationId: 'chat-conv' };
  s.owner.open(gameContext);
  const v = s.view();
  s.owner.choose('message', v, actor);
  s.owner.select(gameMessage.id, [gameMessage], v, actor);
  s.owner.consent(true, v, actor);
  s.owner.edit('spam', 'Detail', v, actor);
  await s.owner.submit([gameMessage], v, actor);
  assert.deepEqual(JSON.parse(s.calls[0]!.init.body as string), {
    targetKind: 'message', messageId: gameMessage.id, gameId: 'game-1',
    reasonCode: 'spam', detail: 'Detail', shareMessageWithSupport: true,
  });
  assert.doesNotMatch(s.calls[0]!.init.body as string, /conversationId|Private loaded message|excerpt|authorPublicPlayerId|evidenceRefs/);
  // Incomplete game shape fails closed.
  const before = s.owner.getSnapshot();
  s.owner.open({ peerId: 'peer', name: 'Игрок', gameId: 'game-1' });
  assert.strictEqual(s.owner.getSnapshot(), before);
  // DM regression: conversationId on wire, no gameId.
  s.owner.open(context);
  const dm = s.view();
  s.owner.choose('message', dm, actor);
  s.owner.select(message.id, [message], dm, actor);
  s.owner.consent(true, dm, actor);
  s.owner.edit('inappropriate', 'DM', dm, actor);
  await s.owner.submit([message], dm, actor);
  assert.deepEqual(JSON.parse(s.calls[1]!.init.body as string), {
    targetKind: 'message', messageId: message.id, conversationId: 'conversation',
    reasonCode: 'inappropriate', detail: 'DM', shareMessageWithSupport: true,
  });
  assert.doesNotMatch(s.calls[1]!.init.body as string, /"gameId"/);
});

test('#522 APK54 root: UNKNOWN original packet retained across member/game change; recovery target safe without command', async () => {
  const s = setup();
  const gameA = { peerId: 'peer', name: 'A', conversationId: 'chat-a', gameId: 'game-a' };
  s.owner.open(gameA);
  s.handler(async () => { throw new SafetyError('network'); });
  s.owner.choose('block', s.view(), actor);
  await s.owner.submit([], s.view(), actor);
  const packet = s.owner.getSnapshot().command!.packet;
  assert.equal(s.owner.getSnapshot().command?.status, 'unknown');
  assert.equal(packet.context.gameId, 'game-a');
  s.owner.open({ ...gameA, peerId: 'other-member', name: 'B' });
  assert.strictEqual(s.owner.getSnapshot().command?.packet, packet);
  assert.equal(s.owner.getSnapshot().command?.status, 'unknown');
  s.owner.open({ peerId: 'peer', name: 'A', conversationId: 'chat-b', gameId: 'game-b' });
  assert.strictEqual(s.owner.getSnapshot().command?.packet, packet);
  assert.equal(packet.context.gameId, 'game-a');
  const controls = readFileSync(new URL('../src/components/safety.tsx', import.meta.url), 'utf8');
  assert.match(controls, /const originalTarget = !command \? null/);
  assert.doesNotMatch(controls, /command!\.packet/);
  assert.match(controls, /\/messages\/game\/\$\{command\.packet\.context\.gameId\}/);
  assert.match(controls, /\/messages\/direct\/\$\{command\.packet\.context\.conversationId\}/);
  assert.match(controls, /\/players\/\$\{command\.packet\.context\.peerId\}/);
});
