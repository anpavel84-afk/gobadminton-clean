import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MessagesCoordinator } from '../src/messages-coordinator.ts';
import type { MessagePacket, MessagesPort, MessagesClock } from '../src/messages-coordinator.ts';
import { inboxDestination, mergeMessages, MessagesError, parseInbox, parseMessage, parseMessageMutation, parseOwnMessageIdentity, seq } from '../src/messages.ts';
import type { Conversation, DirectMessage, InboxPage } from '../src/messages.ts';
const actor = { actorId: 'internal-a', sessionId: 'session-a', generation: 1 };
const resource = { kind: 'direct', id: 'thread-a' } as const;
const counts = { pendingRequestCount: 1, pendingInvitationCount: 1, dmUnread: 1, gameChatUnread: 1 };
const header: Conversation = { id: resource.id, kind: 'direct', requestState: 'accepted', version: 7, peer: { publicPlayerId: 'public-b', displayName: 'Peer' }, role: 'recipient', lastMessageSeq: '9007199254740995', readThroughSeq: '0', unreadCount: 3 };
const message = (seq: string, own = false): DirectMessage => ({ id: 'm-'+seq, conversationId: resource.id, seq, kind: 'text', authorPublicPlayerId: own ? 'public-a' : 'public-b', createdAt: '2026-11-14T00:00:00Z', contentState: 'live', text: 'text '+seq });
const page: InboxPage = { counts, nextCursor: null, items: ['dm','dm_request','game_invitation','game_chat'].map((kind,i) => ({ kind: kind as InboxPage['items'][number]['kind'], id: 'item-'+i, title: kind, subtitle: '', lastActivityAt: '2026-11-14T00:00:00Z', unreadCount: 1, attention: true, conversationId: 'thread-a', invitationId: 'invite-a', gameId: 'game-a', peer: null })) };
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = <T>() => { let resolve!: (v:T) => void; const promise = new Promise<T>(r => { resolve=r; }); return { resolve,promise }; };
function setup(overrides: Partial<MessagesPort> = {}, clock?: MessagesClock) {
  let serial=0; const sent: MessagePacket[]=[];
  const port: MessagesPort = { inbox: async () => page, counts: async () => counts, identity: async () => 'public-a', direct: async () => header,
    game: async () => { throw Error('unexpected'); }, members: async () => [], invitation: async () => { throw Error('unexpected'); },
    history: async () => ({ items: [message('9007199254740993'),message('9007199254740994',true),message('9007199254740995')], nextCursor: '9007199254740993' }),
    send: async p => { sent.push(p); return {}; }, ...overrides };
  const owner = new MessagesCoordinator(port,() => 'random-'+(++serial),clock); owner.setActor(actor);
  return { owner,sent,port };
}
test('all four inbox kinds keep real destinations; parsers drop private extras and reject lossy sequence numbers', () => {
  const parsed = parseInbox({ ...page, secret: 'no' });
  assert.deepEqual(parsed.items.map(inboxDestination), ['/messages/direct/thread-a','/messages/direct/thread-a','/messages/invitations/invite-a','/messages/game/game-a']);
  assert.equal(parseOwnMessageIdentity({ publicPlayerId: 'public-a', id: 'internal-a', email: 'no' }), 'public-a');
  assert.deepEqual(parseMessage({ ...message('9007199254740993'), privateContact: 'no' }),message('9007199254740993'));
  assert.throws(() => parseMessageMutation(resource,'send',{}));
  assert.throws(() => parseMessageMutation(resource,'read',{conversationId:resource.id,readThroughSeq:9007199254740992}));
  assert.throws(() => seq(9007199254740992)); assert.throws(() => seq('01'));
  assert.deepEqual(mergeMessages([message('9007199254740995'),message('9007199254740993')],[{ ...message('9007199254740993'), text: null, contentState: 'tombstoned' }]).map(m => [m.seq,m.contentState]), [['9007199254740993','tombstoned'],['9007199254740995','live']]);
});
test('send UNKNOWN survives tab unmount and profile refresh; only explicit same immutable packet retry dispatches', async () => {
  const sent: MessagePacket[]=[]; let fail=true;
  const { owner } = setup({ send: async p => { sent.push(p); if (fail) throw new MessagesError('network'); return {}; } });
  owner.focus(resource); await tick(); owner.draft(resource,'keep me'); await owner.act(resource,'send');
  const packet=sent[0]!; assert.equal(packet.method,'POST'); assert.equal(packet.path,'/conversations/thread-a/messages'); assert.ok(Object.isFrozen(packet.body)); assert.equal(packet.clientMessageId, 'clientMessageId' in packet.body ? packet.body.clientMessageId : null);
  owner.focus(null); owner.setActor({ ...actor }); owner.focus(resource); await tick();
  await owner.loadCounts(); await owner.loadDetail(resource); owner.draft(resource,'replacement'); await owner.act(resource,'send');
  assert.equal(sent.length,1); assert.equal(owner.getSnapshot().drafts['direct:thread-a'],'keep me');
  fail=false; await owner.retry(resource); assert.strictEqual(sent[1],packet); assert.equal(owner.getSnapshot().pending['direct:thread-a'],undefined); assert.equal(owner.getSnapshot().drafts['direct:thread-a'],undefined);
});
test('viewability marks only incoming actually visible rows while ready focused foreground and near bottom', async () => {
  const { owner,sent } = setup(); owner.focus(resource); await tick(); assert.equal(sent.length,0);
  owner.visible(resource,['m-9007199254740993'],false); owner.visible(resource,['m-9007199254740994'],true); assert.equal(sent.length,0);
  owner.setForeground(false); owner.visible(resource,['m-9007199254740995'],true); assert.equal(sent.length,0);
  owner.setForeground(true); await owner.loadDetail(resource); owner.visible(resource,['m-9007199254740993'],true); await tick();
  assert.deepEqual(sent[0]!.body,{ throughSeq: '9007199254740993' });
  owner.focus(null); owner.visible(resource,['m-9007199254740995'],true); assert.equal(sent.length,1);
});
test('catchup and older history preserve exact decimal order, dedup and server cursors', async () => {
  const queries: (string | undefined)[][]=[];
  const { owner } = setup({ history: async (_r,before,after) => { queries.push([before,after]);
    return before ? { items: [message('9007199254740992')],nextCursor: null }
      : after ? { items: [message('9007199254740996')],nextCursor: null }
      : { items: [message('9007199254740993'),message('9007199254740995')],nextCursor: '9007199254740993' }; } });
  owner.focus(resource); await tick(); await owner.catchUp(resource); await owner.loadDetail(resource,true);
  assert.deepEqual(queries,[[undefined,undefined],[undefined,'9007199254740995'],['9007199254740993',undefined]]);
  assert.deepEqual(owner.getSnapshot().detail?.messages.map(m => m.seq),['9007199254740992','9007199254740993','9007199254740995','9007199254740996']);
});
test('A→B→A, background, stale cursor and logout responses cannot restore private DTOs or send old actor packets', async () => {
  const gate=deferred<Conversation>(); const { owner }=setup({ direct: async () => gate.promise });
  owner.focus(resource); await tick(); owner.focus({ kind:'direct',id:'thread-b' }); owner.focus(resource); owner.setForeground(false);
  gate.resolve(header); await tick(); assert.equal(owner.getSnapshot().detail?.header ?? null,null);
  owner.setActor(null); owner.setForeground(true); owner.setActor({ ...actor,actorId:'internal-b',generation:2 }); await owner.retry(resource);
  assert.equal(owner.getSnapshot().detail,null); assert.deepEqual(owner.getSnapshot().pending,{});
});
test('private access loss clears DTOs and pending ownership, while moderation/rate failures retain drafts', async () => {
  const { owner,port }=setup({ send: async () => { throw new MessagesError('business',429,'RATE_LIMITED'); } });
  owner.focus(resource); await tick(); owner.draft(resource,'retain'); await owner.act(resource,'send'); assert.equal(owner.getSnapshot().drafts['direct:thread-a'],'retain'); assert.deepEqual(owner.getSnapshot().pending,{});
  port.direct=async () => { throw new MessagesError('private',404); }; await owner.loadDetail(resource);
  assert.equal(owner.getSnapshot().detail,null); assert.deepEqual(owner.getSnapshot().drafts,{}); assert.equal(owner.getSnapshot().inbox,null);
});
test('direct request and invitation decisions use actual server versions and own public identity, never internal id', async () => {
  const { owner,sent }=setup({ direct: async () => ({ ...header,requestState:'pending' }) }); owner.focus(resource); await tick(); await owner.act(resource,'accept'); assert.deepEqual(sent[0]?.body,{ expectedVersion:7 });
  const invite={ kind:'invitation',id:'invite-a' } as const;
  const base={ id:'invite-a',gameId:'game-a',status:'pending' as const,version:11,inviterPublicPlayerId:'public-b',inviteePublicPlayerId:'public-a',expiresAt:null,participationId:null };
  const s=setup({ invitation: async () => ({ ...base,acceptanceContext:null }) }); s.owner.focus(invite); await tick(); await s.owner.act(invite,'accept'); assert.equal(s.sent.length,0); await s.owner.act(invite,'decline'); assert.deepEqual(s.sent[0]?.body,{ expectedVersion:11 });
});

function fakeClock() {
  let now=0, serial=0;
  const timers=new Map<number,{at:number; callback:()=>void}>();
  const clock: MessagesClock = { now:()=>now, schedule:(callback,delay)=> {
    const id=++serial; timers.set(id,{at:now+delay,callback}); return ()=> { timers.delete(id); };
  } };
  return { clock, size:()=>timers.size, advance:async (ms:number)=> {
    const end=now+ms;
    for (;;) {
      const next=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];
      if (!next || next[1].at>end) break;
      now=next[1].at; timers.delete(next[0]); next[1].callback(); await tick();
    }
    now=end; await tick();
  } };
}
test('one root timer: direct 3s, counts/inbox and game 15s; GET ticks never mark read or allocate commands', async () => {
  const time=fakeClock(); let direct=0, game=0, inbox=0, badge=0;
  const {owner,sent}=setup({direct:async()=>{ direct++; return header; },
    game:async()=>{ game++; return { id:'chat-a',gameId:'game-a',kind:'game',lifecycleState:'active',version:1,lastMessageSeq:'0',readThroughSeq:'0',unreadCount:0,memberRole:'member' }; },
    history:async()=>({items:[],nextCursor:null}), inbox:async()=>{ inbox++; return page; },counts:async()=>{ badge++; return counts; }},time.clock);
  const root=owner.mount(), duplicate=owner.mount(); duplicate();
  const dm=owner.leaseFocus(resource); await tick(); assert.equal(direct,1); assert.equal(time.size(),1);
  owner.draft(resource,'draft'); owner.setActor({...actor});
  await time.advance(2999); assert.equal(direct,1); await time.advance(1); assert.equal(direct,2);
  await time.advance(12000); assert.equal(direct,6); assert.equal(badge,1); assert.equal(sent.length,0);
  const list=owner.leaseFocus('inbox'); dm(); await tick(); assert.equal(inbox,1);
  await time.advance(14999); assert.equal(inbox,1); await time.advance(1); assert.equal(inbox,2); assert.equal(badge,2);
  list(); assert.equal(time.size(),0);
  const chat=owner.leaseFocus({kind:'game',id:'game-a'}); await tick(); assert.equal(game,1);
  await time.advance(14999); assert.equal(game,1); await time.advance(1); assert.equal(game,2); assert.equal(badge,3);
  assert.equal(owner.getSnapshot().drafts['direct:thread-a'],'draft'); assert.deepEqual(sent,[]);
  root(); assert.equal(time.size(),0); await time.advance(30000); assert.equal(game,2);
  const remount=owner.mount(); assert.equal(time.size(),1); await time.advance(15000); assert.equal(game,3);
  remount(); chat(); assert.equal(time.size(),0);
});
test('slow reads coalesce missed ticks and manual catchup; old history/cursor/draft and decimal watermark survive', async () => {
  const time=fakeClock(), gate=deferred<Conversation>(); let heads=0;
  const queries:(string|undefined)[][]=[];
  const {owner,sent}=setup({direct:async()=>{ heads++; return heads===2 ? gate.promise : header; },
    history:async(_r,before,after)=>{ queries.push([before,after]); return before ? {items:[message('9007199254740992')],nextCursor:'9007199254740991'}
      : after ? {items:[message('9007199254740996')],nextCursor:null}
      : {items:[message('9007199254740993'),message('9007199254740995')],nextCursor:'9007199254740993'}; }},time.clock);
  const root=owner.mount(), focus=owner.leaseFocus(resource); await tick();
  await owner.loadDetail(resource,true); owner.draft(resource,'unsent');
  await time.advance(3000); assert.equal(heads,2); assert.equal(time.size(),0);
  await owner.catchUp(resource); await owner.loadDetail(resource,true); await time.advance(30000);
  assert.equal(heads,2); assert.equal(queries.length,2);
  gate.resolve({...header,version:8}); await tick(); assert.equal(time.size(),1);
  assert.deepEqual(owner.getSnapshot().detail?.messages.map(m=>m.seq),['9007199254740992','9007199254740993','9007199254740995','9007199254740996']);
  assert.equal(owner.getSnapshot().detail?.cursor,'9007199254740991'); assert.equal(owner.getSnapshot().detail?.header?.version,8);
  assert.deepEqual(queries.at(-1),[undefined,'9007199254740995']); assert.equal(owner.getSnapshot().drafts['direct:thread-a'],'unsent'); assert.equal(sent.length,0);
  await time.advance(2999); assert.equal(heads,2); await time.advance(1); assert.equal(heads,3);
  focus(); root();
});
test('foreground resume keeps ready history; blur, background, root disposal, logout/session change fence reads', async () => {
  const time=fakeClock(), gate=deferred<Conversation>(); let heads=0;
  const {owner}=setup({direct:async()=>{ heads++; return heads===3 ? gate.promise : header; },history:async()=>({items:[message('9007199254740995')],nextCursor:'older'})},time.clock);
  const root=owner.mount(); let focus=owner.leaseFocus(resource); await tick();
  owner.setForeground(false); await time.advance(60000); assert.equal(heads,1); assert.equal(time.size(),0);
  owner.setForeground(true); await tick(); assert.equal(heads,2); assert.equal(owner.getSnapshot().detail?.cursor,'older');
  await time.advance(3000); assert.equal(heads,3);
  focus(); await time.advance(60000); assert.equal(heads,3);
  owner.setActor({...actor,sessionId:'replacement',generation:2}); focus=owner.leaseFocus(resource);
  gate.resolve({...header,version:99}); await tick(); assert.equal(owner.getSnapshot().detail?.header ?? null,null);
  await time.advance(3000); assert.equal(heads,4); assert.equal(owner.getSnapshot().detail?.header?.version,7);
  owner.setActor(null); await time.advance(60000); assert.equal(heads,4); assert.equal(time.size(),0); assert.equal(owner.getSnapshot().detail,null);
  focus(); root();
});
test('sending and global UNKNOWN stop reads across tabs; no keys/autoreplay, exact explicit retry resumes scheduling', async () => {
  const time=fakeClock(), sendGate=deferred<unknown>(); const packets:MessagePacket[]=[]; let reads=0;
  const {owner}=setup({direct:async()=>{ reads++; return header; },counts:async()=>{ reads++; return counts; },inbox:async()=>{ reads++; return page; },
    send:async p=>{ packets.push(p); if (packets.length===1) return sendGate.promise; return {}; }},time.clock);
  const root=owner.mount(); let focus=owner.leaseFocus(resource); await tick(); owner.draft(resource,'immutable');
  const sending=owner.act(resource,'send'); await time.advance(60000); assert.equal(reads,1); assert.equal(packets.length,1); assert.equal(time.size(),0);
  sendGate.resolve(Promise.reject(new MessagesError('network'))); await sending;
  const packet=packets[0]; assert.equal(owner.getSnapshot().pending['direct:thread-a']?.state,'unknown');
  focus(); focus=owner.leaseFocus('inbox'); await time.advance(60000); owner.setForeground(false); owner.setForeground(true);
  focus(); focus=owner.leaseFocus({kind:'direct',id:'thread-b'}); await time.advance(60000);
  await owner.loadCounts(); assert.equal(reads,1); assert.equal(packets.length,1); assert.equal(time.size(),0);
  await owner.retry(resource); await tick(); assert.strictEqual(packets[1],packet); assert.equal(packets.length,2);
  assert.deepEqual(owner.getSnapshot().pending,{}); await time.advance(3000); assert.ok(reads>1); assert.equal(packets.length,2);
  focus(); root(); assert.equal(time.size(),0);
});
test('a poll interrupted by sending/UNKNOWN cannot continue history or publish an old read header', async () => {
  const time=fakeClock(), gate=deferred<Conversation>(); let heads=0, histories=0;
  const {owner}=setup({direct:async()=>{ heads++; return heads===2 ? gate.promise : header; },history:async()=>{ histories++; return {items:[message('9007199254740995')],nextCursor:'old'}; },send:async()=>{throw new MessagesError('network');}},time.clock);
  const root=owner.mount(), focus=owner.leaseFocus(resource); await tick(); await time.advance(3000);
  owner.draft(resource,'keep'); await owner.act(resource,'send'); gate.resolve({...header,version:99}); await tick();
  await time.advance(60000); assert.equal(histories,1); assert.equal(heads,2); assert.equal(owner.getSnapshot().detail?.header?.version,7);
  assert.equal(owner.getSnapshot().detail?.cursor,'old'); assert.equal(time.size(),0); focus(); root();
});

test('quiet inbox refresh keeps displayed rows while pending, then applies authoritative kind/filter changes', async () => {
  const time=fakeClock(), gate=deferred<InboxPage>(); let calls=0;
  const request={...page.items[0]!,kind:'dm_request' as const,id:'same-thread'};
  const {owner,sent}=setup({inbox:async()=>{ calls++; return calls===2 ? gate.promise : calls===1 ? {...page,items:[request]} : {...page,items:[]}; }},time.clock);
  const root=owner.mount(), focus=owner.leaseFocus('inbox'); await tick();
  await time.advance(15000); assert.equal(owner.getSnapshot().inboxStatus,'ready'); assert.deepEqual(owner.getSnapshot().inbox?.items,[request]);
  gate.resolve({...page,items:[{...request,kind:'dm'}]}); await tick();
  assert.deepEqual(owner.getSnapshot().inbox?.items.map(i=>i.kind),['dm']);
  await time.advance(15000); assert.deepEqual(owner.getSnapshot().inbox?.items,[]); assert.deepEqual(sent,[]);
  focus(); root();
});
