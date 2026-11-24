import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MessagesCoordinator } from '../src/messages-coordinator.ts';
import type { MessagePacket, MessagesPort, MessagesClock } from '../src/messages-coordinator.ts';
import { inboxDestination, mergeMessages, MessagesError, mutationPath, parseInbox, parseMessage, parseMessageMutation, parseOwnMessageIdentity, seq } from '../src/messages.ts';
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
    managed: async () => ({ items: [], nextCursor: null }),
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
  const time=fakeClock();
  const { owner,port }=setup({ send: async () => { throw new MessagesError('business',429,'RATE_LIMITED'); } },time.clock);
  await owner.loadInbox(); await owner.loadCounts();
  assert.deepEqual(owner.getSnapshot().inbox,page); assert.deepEqual(owner.getSnapshot().counts,counts);
  const root=owner.mount(), focus=owner.leaseFocus(resource); await tick(); owner.draft(resource,'retain'); await owner.act(resource,'send'); assert.equal(owner.getSnapshot().drafts['direct:thread-a'],'retain'); assert.deepEqual(owner.getSnapshot().pending,{});
  port.direct=async () => { throw new MessagesError('private',404); }; await owner.loadDetail(resource);
  assert.equal(owner.getSnapshot().detail?.status,'error'); assert.equal(owner.getSnapshot().detail?.header,null);
  assert.deepEqual(owner.getSnapshot().detail?.messages,[]); assert.equal(owner.getSnapshot().detail?.cursor,null);
  assert.equal(owner.getSnapshot().detail?.ownId,null); assert.deepEqual(owner.getSnapshot().detail?.members,[]);
  assert.deepEqual(owner.getSnapshot().drafts,{}); assert.deepEqual(owner.getSnapshot().pending,{});
  assert.equal(owner.getSnapshot().inbox,null); assert.equal(owner.getSnapshot().counts,null);
  assert.match(owner.getSnapshot().detail?.error ?? '',/Доступ/);
  assert.match(owner.getSnapshot().notice ?? '',/Доступ/);
  // Same mounted route's existing refresh callback must make a new authorized read.
  let recovered=0;
  port.direct=async () => { recovered++; return {...header,version:8}; };
  await owner.loadDetail(resource);
  assert.equal(recovered,1); assert.equal(owner.getSnapshot().detail?.status,'ready');
  assert.equal(owner.getSnapshot().notice,null);
  assert.equal(owner.getSnapshot().detail?.header?.version,8); assert.deepEqual(owner.getSnapshot().drafts,{});
  focus(); assert.equal(time.size(),0);
  const nextFocus=owner.leaseFocus(resource); await tick();
  // A denied request followed by an in-flight recovery cannot cross an actor/session change.
  port.direct=async () => { throw new MessagesError('private',403); }; await owner.loadDetail(resource);
  const stale=deferred<Conversation>(); port.direct=async () => stale.promise;
  const recovering=owner.loadDetail(resource); await tick();
  owner.setActor({...actor,actorId:'internal-b',sessionId:'new-session',generation:2});
  // A fresh actor's denial must survive the previous actor's late success.
  port.inbox=async () => { throw new MessagesError('private',404); };
  await owner.loadInbox();
  const newActorNotice=owner.getSnapshot().notice; assert.match(newActorNotice ?? '',/Доступ/);
  stale.resolve(header); await recovering;
  assert.equal(owner.getSnapshot().notice,newActorNotice);
  assert.equal(owner.getSnapshot().detail,null); assert.equal(owner.getSnapshot().inbox,null);
  assert.deepEqual(owner.getSnapshot().drafts,{}); assert.deepEqual(owner.getSnapshot().pending,{});
  nextFocus(); root(); assert.equal(time.size(),0);
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

test('quiet first-page polling reconciles identities without dropping older pages or their boundary', async () => {
  const time=fakeClock(), gate=deferred<InboxPage>(); const queries:(string|undefined)[]=[];
  const request={...page.items[0]!,kind:'dm_request' as const,id:'same-thread',conversationId:'same-thread'};
  const older={...page.items[3]!,id:'older-chat'}, oldest={...page.items[2]!,id:'oldest-invite'};
  const updated={...request,kind:'dm' as const,title:'Accepted',attention:false,unreadCount:0};
  const fresh={...page.items[2]!,id:'fresh-invite'};
  let polls=0;
  const {owner,sent}=setup({inbox:async(_filter,cursor)=>{
    queries.push(cursor);
    if (cursor==='page-2') return {...page,items:[older],nextCursor:'page-3'};
    if (cursor==='page-3') return {...page,items:[oldest],nextCursor:null};
    polls++; return polls===1 ? {...page,items:[request],nextCursor:'page-2'} : polls===2 ? gate.promise : {...page,items:[],nextCursor:null};
  }},time.clock);
  const root=owner.mount(), focus=owner.leaseFocus('inbox'); await tick();
  await owner.loadInbox('all','page-2'); owner.draft(resource,'unsent');
  await time.advance(15000);
  assert.equal(owner.getSnapshot().inboxStatus,'ready'); assert.deepEqual(owner.getSnapshot().inbox?.items,[request,older]);
  assert.equal(owner.getSnapshot().inbox?.nextCursor,'page-3');
  gate.resolve({...page,counts:{...counts,dmUnread:0},items:[fresh,updated],nextCursor:'new-first-boundary'}); await tick();
  assert.deepEqual(owner.getSnapshot().inbox?.items,[fresh,updated,older]);
  assert.equal(owner.getSnapshot().inbox?.nextCursor,'page-3'); assert.equal(owner.getSnapshot().inbox?.counts.dmUnread,0);
  assert.equal(owner.getSnapshot().drafts['direct:thread-a'],'unsent');
  // No absence-deletion inference, even from an empty first-page response.
  await time.advance(15000); assert.deepEqual(owner.getSnapshot().inbox?.items,[fresh,updated,older]);
  await owner.loadInbox('all',owner.getSnapshot().inbox?.nextCursor ?? undefined);
  assert.deepEqual(queries,[undefined,'page-2',undefined,undefined,'page-3']);
  assert.deepEqual(owner.getSnapshot().inbox?.items,[fresh,updated,older,oldest]);
  assert.equal(owner.getSnapshot().inbox?.nextCursor,null); assert.deepEqual(sent,[]);
  focus(); root(); assert.equal(time.size(),0);
});
for (const filter of ['unread','attention'] as const) test(`quiet ${filter} reconciles actual server omission across all pages and retains the loaded cursor`, async () => {
  const time=fakeClock();
  const changed={...page.items[1]!,id:'changed',conversationId:'changed'};
  const older=[1,2,3,4].map(n=>({...changed,id:'older-'+n,conversationId:'older-'+n}));
  const fresh={...changed,id:'fresh',conversationId:'fresh'};
  const updated={...changed,kind:'dm' as const,attention:false,unreadCount:0};
  let rows=[changed,...older];
  const queries: [string,string|undefined][]=[];
  const {owner,sent}=setup({inbox:async(selected,cursor)=>{
    queries.push([selected,cursor]);
    // Like the SQL endpoint: filter BEFORE pagination, never send a
    // nonmatching row in an unread/attention response. Cursors mark coverage.
    const matching=rows.filter(row=>selected==='all' || (selected==='unread' ? row.unreadCount>0 : row.attention));
    const start=cursor ? matching.findIndex(row=>`${selected}:${row.id}`===cursor)+1 : 0;
    assert.ok(!cursor || start>0,'cursor still denotes the loaded boundary');
    const items=matching.slice(start,start+2);
    return {...page,items,nextCursor:start+2<matching.length ? `${selected}:${items.at(-1)!.id}` : null};
  }},time.clock);
  const root=owner.mount();
  await owner.loadInbox(filter);
  const focus=owner.leaseFocus('inbox'); await tick();
  await owner.loadInbox(filter,`${filter}:older-1`);
  assert.deepEqual(owner.getSnapshot().inbox?.items,[changed,...older.slice(0,3)]);
  const boundary=`${filter}:older-3`;
  assert.equal(owner.getSnapshot().inbox?.nextCursor,boundary);
  owner.draft(resource,'unsent');
  // The changed row is omitted from the filtered response and lies beyond
  // four all-filter pages; still-current older rows are outside page one too.
  const fillers=Array.from({length:9},(_,n)=>({...updated,id:'filler-'+n,conversationId:'filler-'+n}));
  rows=[fresh,...fillers,updated,...older];
  queries.length=0;
  await time.advance(15000);
  assert.deepEqual(owner.getSnapshot().inbox?.items,[fresh,...older.slice(0,3)]);
  assert.equal(owner.getSnapshot().inbox?.nextCursor,boundary);
  assert.ok(queries.filter(([f])=>f==='all').length>4);
  assert.deepEqual(queries[0],[filter,undefined]);
  assert.equal(owner.getSnapshot().drafts['direct:thread-a'],'unsent');
  await owner.loadInbox(filter,boundary);
  assert.deepEqual(owner.getSnapshot().inbox?.items,[fresh,...older]);
  assert.equal(new Set(owner.getSnapshot().inbox?.items.map(row=>row.id)).size,5);
  assert.equal(owner.getSnapshot().inbox?.nextCursor,null);
  // A genuinely revoked row can be removed only after all-filter exhaustion.
  rows=rows.filter(row=>row.id!=='older-2');
  await time.advance(15000);
  assert.deepEqual(owner.getSnapshot().inbox?.items,[fresh,older[0],older[2],older[3]]);
  await owner.loadInbox('all');
  assert.deepEqual(owner.getSnapshot().inbox?.items,rows.slice(0,2));
  assert.deepEqual(sent,[]); focus(); root(); assert.equal(time.size(),0);
});

test('authorized detail recovery preserves unrelated and UNKNOWN notices', async () => {
  const {owner,port}=setup({send:async()=>{throw new MessagesError('business',429);}});
  owner.focus(resource); await tick();
  port.direct=async()=>{throw new MessagesError('private',404);};
  await owner.loadDetail(resource);
  const denial=owner.getSnapshot().notice; assert.match(denial ?? '',/Доступ/);
  port.direct=async()=>header;
  const other={kind:'direct',id:'other-thread'} as const;
  owner.focus(other); await tick();
  assert.equal(owner.getSnapshot().notice,denial,'another route cannot resolve this access loss');
  owner.draft(other,'keep'); await owner.act(other,'send');
  const unrelated=owner.getSnapshot().notice; assert.match(unrelated ?? '',/Слишком часто/);
  owner.focus(resource); await tick();
  assert.equal(owner.getSnapshot().detail?.status,'ready'); assert.equal(owner.getSnapshot().notice,unrelated);
  port.send=async()=>{throw new MessagesError('network');};
  owner.draft(resource,'keep'); await owner.act(resource,'send');
  const unknown=owner.getSnapshot().notice; assert.match(unknown ?? '',/неизвестен/);
  await owner.loadDetail(resource);
  assert.equal(owner.getSnapshot().notice,unknown); assert.equal(owner.getSnapshot().pending['direct:thread-a']?.state,'unknown');
});

test('all-filter reconciliation coalesces reads, fences background results and fails private without publishing DTOs', async () => {
  const gate=deferred<InboxPage>(); let allCalls=0, changed=false;
  const row=page.items[0]!;
  const {owner,port}=setup({inbox:async(filter)=>{
    if (filter==='all') { allCalls++; return gate.promise; }
    return {...page,items:changed ? [] : [row]};
  }});
  await owner.loadInbox('unread'); changed=true;
  const refresh=owner.loadInbox('unread',undefined,true); await tick();
  await owner.loadInbox('unread',undefined,true); assert.equal(allCalls,1);
  owner.setForeground(false);
  gate.resolve({...page,items:[],nextCursor:'unscanned'}); await refresh;
  assert.equal(allCalls,1); assert.deepEqual(owner.getSnapshot().inbox?.items,[row]);
  owner.setForeground(true);
  // An invalid cursor cycle is incomplete coverage, never proof of deletion.
  let cyclePages=0;
  port.inbox=async(filter)=>{
    if (filter==='all') { cyclePages++; return {...page,items:[],nextCursor:'repeated'}; }
    return {...page,items:[]};
  };
  await owner.loadInbox('unread',undefined,true);
  assert.equal(cyclePages,2); assert.equal(owner.getSnapshot().inboxError,true);
  assert.deepEqual(owner.getSnapshot().inbox?.items,[row]);
  port.inbox=async(filter)=>{ if(filter==='all') throw new MessagesError('private',403); return {...page,items:[]}; };
  await owner.loadInbox('unread',undefined,true);
  assert.equal(owner.getSnapshot().inbox,null); assert.equal(owner.getSnapshot().counts,null);
  assert.match(owner.getSnapshot().notice ?? '',/Доступ/);
});

test('verified safety fence holds only peer writes, retains original UNKNOWN/draft/history and rejects a late success', async () => {
  const gate = deferred<unknown>(), sent: MessagePacket[] = [];
  const { owner,port } = setup({ send: async p => { sent.push(p); return gate.promise; } });
  owner.focus(resource); await tick(); const rendered = owner.getSnapshot(); owner.draft(resource,'retained');
  const work = owner.act(resource,'send'); const packet = owner.getSnapshot().pending['direct:thread-a']!.packet;
  owner.setPeerSafety('public-b',true); gate.resolve({}); await work;
  assert.strictEqual(owner.getSnapshot().pending['direct:thread-a']?.packet,packet); assert.equal(owner.getSnapshot().pending['direct:thread-a']?.state,'unknown');
  assert.equal(owner.getSnapshot().drafts['direct:thread-a'],'retained'); assert.equal(owner.getSnapshot().detail?.messages.length,3);
  await owner.retry(resource); await owner.act(resource,'send',undefined,rendered.viewGeneration,rendered.actor); assert.equal(sent.length,1);
  assert.equal(owner.mayDispatchSafety({...packet,resource:{kind:'game',id:'game'}}),true);
  assert.equal(owner.mayDispatchSafety({...packet,action:'read'}),true);
  owner.setPeerSafety('public-b',false); assert.strictEqual(owner.getSnapshot().pending['direct:thread-a']?.packet,packet);
  // A different direct peer still sends under current server headers.
  port.direct = async () => ({...header,id:'other-thread',peer:{publicPlayerId:'other-peer',displayName:'Other'}});
  owner.focus({kind:'direct',id:'other-thread'}); // existing UNKNOWN retains the accepted global read HOLD
  assert.equal(owner.getSnapshot().pending['direct:thread-a']?.state,'unknown');
});

test('unblock rereads direct authority without fabricating deletion/history or accepting same-peer stale rendered send', async () => {
  const { owner,sent } = setup(); owner.focus(resource); await tick(); const rendered = owner.getSnapshot();
  owner.setPeerSafety('public-b',true); await tick(); assert.equal(owner.getSnapshot().detail?.messages.length,3);
  await owner.act(resource,'send'); assert.equal(sent.length,0);
  owner.setPeerSafety('public-b',false); await tick(); owner.draft(resource,'current');
  await owner.act(resource,'send',undefined,rendered.viewGeneration,rendered.actor); assert.equal(sent.length,0);
  await owner.act(resource,'send'); assert.equal(sent.length,1);
});

test('block then later unblock cannot revive a pre-block send callback or its pre-wire dispatch permit', async () => {
  const gate=deferred<unknown>(); const {owner}=setup({send:async () => gate.promise});
  owner.focus(resource); await tick(); owner.draft(resource,'Original'); const work=owner.act(resource,'send');
  const packet=owner.getSnapshot().pending['direct:thread-a']!.packet, permit=owner.safetyPermit(packet);
  owner.setPeerSafety('public-b',true); owner.setPeerSafety('public-b',false);
  assert.equal(owner.mayDispatchSafety(packet,permit),false);
  gate.resolve({}); await work;
  assert.strictEqual(owner.getSnapshot().pending['direct:thread-a']?.packet,packet);
  assert.equal(owner.getSnapshot().pending['direct:thread-a']?.state,'unknown'); assert.equal(owner.getSnapshot().drafts['direct:thread-a'],'Original');
});

test('verified safety receives changed GET views during UNKNOWN, preserves packet/draft/history, and keeps ordinary HOLD', async () => {
  const sent: MessagePacket[] = [], reads = { inbox: 0, counts: 0, detail: 0 };
  const time = fakeClock(); let changed = false;
  const updatedCounts = { ...counts, dmUnread: 8 }, updatedPage = { ...page, counts: updatedCounts, items: [{ ...page.items[0]!, title: 'Server changed' }] };
  const { owner } = setup({
    inbox: async () => { reads.inbox++; return changed ? updatedPage : page; },
    counts: async () => { reads.counts++; return changed ? updatedCounts : counts; },
    direct: async () => { reads.detail++; return changed ? { ...header, version: 9, requestState: 'closed' } : header; },
    // The first event targets a different peer from the UNKNOWN; only authorized headers bind direct peers.
    send: async p => { sent.push(p); throw new MessagesError('network'); },
  }, time.clock);
  const root = owner.mount(); owner.focus(resource); await tick();
  owner.draft(resource, 'Original bytes'); await owner.act(resource, 'send');
  const packet = owner.getSnapshot().pending['direct:thread-a']!.packet, bytes = JSON.stringify(packet);
  owner.setPeerSafety('other-peer', true, 'unrelated-thread'); await tick();
  assert.strictEqual(owner.getSnapshot().pending['direct:thread-a']?.packet, packet);
  changed = true; owner.setPeerSafety('public-b', true); await tick();
  assert.equal(owner.getSnapshot().detail?.header?.version, 9);
  assert.equal((owner.getSnapshot().detail?.header as Conversation).requestState, 'closed');
  assert.deepEqual(owner.getSnapshot().counts, updatedCounts); assert.deepEqual(owner.getSnapshot().inbox, updatedPage);
  assert.equal(owner.getSnapshot().detail?.messages.length, 3);
  assert.equal(owner.getSnapshot().drafts['direct:thread-a'], 'Original bytes');
  assert.strictEqual(owner.getSnapshot().pending['direct:thread-a']?.packet, packet); assert.equal(JSON.stringify(packet), bytes);
  assert.equal(owner.getSnapshot().pending['direct:thread-a']?.state, 'unknown');
  const acceptedReads = { ...reads };
  await owner.loadInbox(); await owner.loadCounts(); await owner.loadDetail(resource); await owner.catchUp(resource);
  owner.visible(resource, ['m-9007199254740995'], true); await owner.retry(resource); await time.advance(60000);
  assert.deepEqual(reads, acceptedReads); assert.equal(sent.length, 1); assert.equal(time.size(), 0);
  root();
});

test('safety coalesces occupied lanes then receives one genuinely fresh followup after stale in-flight results', async () => {
  const oldInbox = deferred<InboxPage>(), oldCounts = deferred<typeof counts>(), oldHeader = deferred<Conversation>();
  const reads = { inbox: 0, counts: 0, detail: 0 }; let changed = false, writes = 0;
  const { owner } = setup({
    inbox: async () => { reads.inbox++; return changed ? { ...page, items: [], counts: { ...counts, dmUnread: 0 } } : oldInbox.promise; },
    counts: async () => { reads.counts++; return changed ? { ...counts, dmUnread: 0 } : oldCounts.promise; },
    direct: async () => { reads.detail++; return reads.detail === 1 ? header : changed ? { ...header, version: 10, unreadCount: 0 } : oldHeader.promise; },
    send: async () => { writes++; throw new MessagesError('network'); },
  });
  owner.focus(resource); await tick();
  const inbox = owner.loadInbox(), count = owner.loadCounts(), detail = owner.catchUp(resource); await tick();
  owner.draft(resource, 'Preserve'); await owner.act(resource, 'send');
  const packet = owner.getSnapshot().pending['direct:thread-a']!.packet;
  changed = true; owner.setPeerSafety('public-b', true); owner.setPeerSafety('public-b', true);
  assert.deepEqual(reads, { inbox: 1, counts: 1, detail: 2 });
  oldInbox.resolve(page); oldCounts.resolve(counts); oldHeader.resolve({ ...header, version: 99 });
  await Promise.all([inbox, count, detail]); await tick();
  assert.deepEqual(reads, { inbox: 2, counts: 2, detail: 3 });
  assert.equal(owner.getSnapshot().detail?.header?.version, 10); assert.equal(owner.getSnapshot().counts?.dmUnread, 0);
  assert.deepEqual(owner.getSnapshot().inbox?.items, []);
  assert.strictEqual(owner.getSnapshot().pending['direct:thread-a']?.packet, packet); assert.equal(writes, 1);
});

test('safety-only reads and queued followups cannot cross actor/session, logout or A→B→A view changes', async () => {
  // Every lane must fence both response publication and a queued followup at these boundaries.
  for (const boundary of ['actor', 'session', 'logout', 'view', 'background'] as const) {
    for (const occupied of [false, true]) {
      const gate = deferred<InboxPage>(), countGate = deferred<typeof counts>(), headerGate = deferred<Conversation>();
      const reads = { inbox: 0, counts: 0, detail: 0 }; let delayed = false;
      const { owner } = setup({
        inbox: async () => { reads.inbox++; return gate.promise; },
        counts: async () => { reads.counts++; return countGate.promise; },
        direct: async () => { reads.detail++; return delayed ? headerGate.promise : header; },
        send: async () => { throw new MessagesError('network'); },
      });
      owner.focus(resource); await tick(); delayed = true;
      const old = occupied ? Promise.all([owner.loadInbox(), owner.loadCounts(), owner.catchUp(resource)]) : Promise.resolve();
      await tick(); owner.draft(resource, 'Keep'); await owner.act(resource, 'send');
      owner.setPeerSafety('public-b', true); await tick();
      assert.deepEqual(reads, { inbox: 1, counts: 1, detail: 2 });
      if (boundary === 'actor') owner.setActor({ ...actor, actorId: 'B', generation: 2 });
      if (boundary === 'session') owner.setActor({ ...actor, sessionId: 'new', generation: 2 });
      if (boundary === 'logout') owner.setActor(null);
      if (boundary === 'view') { owner.focus({ kind: 'direct', id: 'B' }); owner.focus(resource); }
      if (boundary === 'background') { owner.setForeground(false); owner.setForeground(true); }
      gate.resolve({ ...page, items: [{ ...page.items[0]!, title: 'Stale secret' }] });
      countGate.resolve({ ...counts, dmUnread: 99 }); headerGate.resolve({ ...header, version: 99 });
      await old; await tick();
      assert.equal(owner.getSnapshot().inbox, null, `${boundary}/${occupied}`);
      assert.notEqual(owner.getSnapshot().counts?.dmUnread, 99, `${boundary}/${occupied}`);
      assert.notEqual(owner.getSnapshot().detail?.header?.version, 99, `${boundary}/${occupied}`);
      assert.deepEqual(reads, { inbox: 1, counts: 1, detail: 2 }, `${boundary}/${occupied}: no queued replay`);
    }
  }
});

test('safety private404 hides denied DTOs, keeps exact UNKNOWN/draft and recovers only authorized same-owner views', async () => {
  const { owner, port } = setup({ send: async () => { throw new MessagesError('network'); } });
  owner.focus(resource); await tick(); await owner.loadInbox();
  owner.draft(resource, 'Keep'); await owner.act(resource, 'send');
  const packet = owner.getSnapshot().pending['direct:thread-a']!.packet;
  const bytes = JSON.stringify(packet), rendered = owner.getSnapshot();
  port.direct = async () => { throw new MessagesError('private', 404); };
  port.inbox = async () => { throw new MessagesError('network'); };
  owner.setPeerSafety('public-b', true); await tick();
  assert.strictEqual(owner.getSnapshot().pending['direct:thread-a']?.packet, packet);
  const denied = owner.getSnapshot();
  assert.equal(denied.detail?.status, 'error'); assert.equal(denied.detail?.header, null);
  assert.deepEqual(denied.detail?.messages, []); assert.deepEqual(denied.detail?.members, []);
  assert.equal(denied.detail?.ownId, null); assert.equal(denied.detail?.cursor, null);
  assert.equal(denied.inbox, null); assert.equal(denied.counts, null);
  assert.equal(denied.pending['direct:thread-a']?.state, 'unknown'); assert.equal(JSON.stringify(packet), bytes);
  assert.equal(owner.getSnapshot().drafts['direct:thread-a'], 'Keep');
  port.direct = async () => ({ ...header, version: 99, peer: { publicPlayerId: 'different-peer', displayName: 'Wrong target' } });
  owner.setPeerSafety('public-b', true); await tick();
  assert.equal(owner.getSnapshot().detail?.header, null);
  assert.strictEqual(owner.getSnapshot().pending['direct:thread-a']?.packet, packet);
  port.direct = async () => ({ ...header, requestState: 'closed' });
  owner.setPeerSafety('public-b', false); await tick();
  assert.equal((owner.getSnapshot().detail?.header as Conversation).requestState, 'closed');
  assert.strictEqual(owner.getSnapshot().pending['direct:thread-a']?.packet, packet);
  assert.equal(owner.getSnapshot().drafts['direct:thread-a'], 'Keep');
  await owner.retry(resource, rendered.viewGeneration, rendered.actor);
  assert.strictEqual(owner.getSnapshot().pending['direct:thread-a']?.packet, packet);
  let retried: MessagePacket | undefined;
  port.send = async p => { retried = p; return {}; };
  await owner.retry(resource);
  assert.strictEqual(retried, packet); assert.equal(JSON.stringify(retried), bytes);
  assert.equal(owner.getSnapshot().pending['direct:thread-a'], undefined);
});

test('safety network failure retains still-authorized history and UNKNOWN without treating it as denial', async () => {
  const { owner, port } = setup({ send: async () => { throw new MessagesError('network'); } });
  owner.focus(resource); await tick(); await owner.loadInbox();
  owner.draft(resource, 'Keep'); await owner.act(resource, 'send');
  const packet = owner.getSnapshot().pending['direct:thread-a']!.packet;
  port.direct = async () => { throw new MessagesError('network'); };
  port.inbox = async () => { throw new MessagesError('network'); };
  owner.setPeerSafety('public-b', true); await tick();
  assert.equal(owner.getSnapshot().detail?.status, 'ready');
  assert.deepEqual(owner.getSnapshot().detail?.messages.map(m => m.text), [message('9007199254740993').text, message('9007199254740994').text, message('9007199254740995').text]);
  assert.deepEqual(owner.getSnapshot().inbox, page);
  assert.strictEqual(owner.getSnapshot().pending['direct:thread-a']?.packet, packet);
});

test('late safety denial cannot hide a replacement actor or focus and cannot restore private ownership after logout', async () => {
  for (const boundary of ['actor', 'focus', 'logout'] as const) {
    const gate = deferred<void>();
    const { owner, port } = setup({ send: async () => { throw new MessagesError('network'); } });
    owner.focus(resource); await tick(); owner.draft(resource, 'Original'); await owner.act(resource, 'send');
    port.direct = async () => { await gate.promise; throw new MessagesError('private', 404); };
    owner.setPeerSafety('public-b', true); await tick();
    if (boundary === 'actor') owner.setActor({ ...actor, actorId: 'replacement', sessionId: 'new', generation: 2 });
    if (boundary === 'focus') { owner.focus({ kind: 'direct', id: 'other-thread' }); owner.focus(resource); }
    if (boundary === 'logout') owner.setActor(null);
    const current = owner.getSnapshot(); gate.resolve(); await tick();
    assert.strictEqual(owner.getSnapshot(), current, boundary);
    assert.equal(owner.getSnapshot().detail, null);
    if (boundary !== 'focus') { assert.deepEqual(owner.getSnapshot().pending, {}); assert.deepEqual(owner.getSnapshot().drafts, {}); }
  }
});

test('deferred invitation A GET then focus B fetches B; lease release cannot clear a newer owner', async () => {
  const inviteA = { kind: 'invitation', id: 'invite-a' } as const;
  const inviteB = { kind: 'invitation', id: 'invite-b' } as const;
  const base = {
    status: 'pending' as const, version: 1, inviterPublicPlayerId: 'public-b', inviteePublicPlayerId: 'public-a',
    expiresAt: null, participationId: null, acceptanceContext: null,
  };
  const gateA = deferred<typeof base & { id: string; gameId: string }>();
  const fetched: string[] = [];
  const { owner } = setup({
    invitation: async (id) => {
      fetched.push(id);
      if (id === 'invite-a') return gateA.promise;
      return { ...base, id, gameId: 'game-' + id };
    },
  });
  const root = owner.mount();
  const focusA = owner.leaseFocus(inviteA); await tick();
  assert.deepEqual(fetched, ['invite-a']);
  // Fast A→B while A's detail lane is still occupied — B must not stick on loading.
  const focusB = owner.leaseFocus(inviteB); await tick();
  assert.deepEqual(fetched, ['invite-a']);
  assert.equal(owner.getSnapshot().detail, null);
  // Stale A release must not clear B's newer focus lease.
  focusA();
  assert.equal(owner.getSnapshot().detail, null);
  assert.equal(fetched.length, 1);
  gateA.resolve({ ...base, id: 'invite-a', gameId: 'game-a' }); await tick();
  assert.deepEqual(fetched, ['invite-a', 'invite-b']);
  assert.equal(owner.getSnapshot().detail?.resource.id, 'invite-b');
  assert.equal(owner.getSnapshot().detail?.status, 'ready');
  // Owner return/release: Messages takes shared focus, then re-lease restores the panel GET.
  focusB();
  const inbox = owner.leaseFocus('inbox'); await tick();
  inbox();
  const back = owner.leaseFocus(inviteB); await tick();
  assert.equal(owner.getSnapshot().detail?.resource.id, 'invite-b');
  assert.equal(owner.getSnapshot().detail?.status, 'ready');
  assert.ok(fetched.filter(id => id === 'invite-b').length >= 2);
  back(); root();
});

test('deferred invitation A→B: background A completion then foreground drains queued B once', async () => {
  const inviteA = { kind: 'invitation', id: 'invite-a' } as const;
  const inviteB = { kind: 'invitation', id: 'invite-b' } as const;
  const base = {
    status: 'pending' as const, version: 1, inviterPublicPlayerId: 'public-b', inviteePublicPlayerId: 'public-a',
    expiresAt: null, participationId: null, acceptanceContext: null,
  };
  const gateA = deferred<typeof base & { id: string; gameId: string }>();
  const fetched: string[] = [];
  const { owner } = setup({
    invitation: async (id) => {
      fetched.push(id);
      if (id === 'invite-a') return gateA.promise;
      return { ...base, id, gameId: 'game-' + id };
    },
  });
  const root = owner.mount();
  owner.leaseFocus(inviteA); await tick();
  assert.deepEqual(fetched, ['invite-a']);
  owner.leaseFocus(inviteB); await tick();
  assert.deepEqual(fetched, ['invite-a']);
  assert.equal(owner.getSnapshot().detail, null);
  owner.setForeground(false);
  gateA.resolve({ ...base, id: 'invite-a', gameId: 'game-a' }); await tick();
  assert.deepEqual(fetched, ['invite-a']);
  assert.equal(owner.getSnapshot().detail, null);
  owner.setForeground(true); await tick();
  assert.deepEqual(fetched, ['invite-a', 'invite-b']);
  assert.equal(owner.getSnapshot().detail?.resource.id, 'invite-b');
  assert.equal(owner.getSnapshot().detail?.status, 'ready');
  assert.equal(fetched.filter(id => id === 'invite-a').length, 1);
  assert.equal(fetched.filter(id => id === 'invite-b').length, 1);
  assert.equal(owner.getSnapshot().actor?.actorId, 'internal-a');
  root();
});

test('invitation decision body: zero seats disable accept, clock expiry honest, decline a11y-disabled while pending', async () => {
  const { readFileSync } = await import('node:fs');
  const { URL } = await import('node:url');
  const { isInviteClockExpired } = await import('../src/my-games.ts');
  const body = readFileSync(new URL('../src/components/messages.tsx', import.meta.url), 'utf8');
  assert.match(body, /DeclineTextButton/);
  assert.match(body, /disabled=\{acceptDisabled\}/);
  assert.match(body, /disabled=\{declineDisabled\}/);
  assert.match(body, /Свободных мест сейчас нет/);
  assert.match(body, /noSeats|availablePlaces < 1/);
  assert.match(body, /isInviteClockExpired\(invitation, Date\.now\(\)\)/);
  assert.match(body, /DeclineTextButton title="Отклонить"/);
  const expired = {
    id: 'e', gameId: 'g', status: 'pending' as const, version: 1,
    inviterPublicPlayerId: 'a', inviteePublicPlayerId: 'b',
    expiresAt: '2020-01-01T00:00:00Z', participationId: null,
  };
  assert.equal(isInviteClockExpired(expired, Date.parse('2026-11-14T12:00:00Z')), true);
  assert.equal(isInviteClockExpired({ ...expired, expiresAt: null }, Date.parse('2026-11-14T12:00:00Z')), false);
});

test('#522 APK46 manager revoke: managed projection eligibility, selected revoke only, UNKNOWN exact retry', async () => {
  const invite = { kind: 'invitation', id: 'invite-mgr' } as const;
  const base = {
    id: 'invite-mgr', gameId: 'game-managed', status: 'pending' as const, version: 4,
    inviterPublicPlayerId: 'public-b', inviteePublicPlayerId: 'public-peer',
    expiresAt: null, participationId: null, acceptanceContext: null,
  };
  let managedCalls = 0;
  let includeManaged = true;
  let pagePhase: 'first' | 'more' | 'done' = 'first';
  const { owner, sent, port } = setup({
    identity: async () => 'public-manager',
    invitation: async () => ({ ...base }),
    managed: async (cursor?: string) => {
      managedCalls++;
      if (!includeManaged) return { items: [{ id: 'other-game' }], nextCursor: null };
      // Bounded pagination: first page misses, second page hits game-managed.
      if (!cursor && pagePhase === 'first') { pagePhase = 'more'; return { items: [{ id: 'other-game' }], nextCursor: 'c1' }; }
      pagePhase = 'done';
      return { items: [{ id: 'game-managed' }], nextCursor: null };
    },
    send: async p => { sent.push(p); return { ...base, status: 'revoked', version: 5 }; },
  });
  owner.focus(invite); await tick();
  assert.equal(owner.getSnapshot().detail?.managerEligible, true);
  assert.ok(managedCalls >= 2);
  // Recipient accept/decline path must stay closed for manager.
  await owner.act(invite, 'accept'); assert.equal(sent.length, 0);
  await owner.act(invite, 'decline'); assert.equal(sent.length, 0);
  pagePhase = 'first';
  await owner.act(invite, 'revoke');
  assert.equal(sent.length, 1);
  assert.equal(sent[0]!.action, 'revoke');
  assert.equal(sent[0]!.path, '/invitations/invite-mgr/revoke');
  assert.deepEqual(sent[0]!.body, { expectedVersion: 4 });
  assert.ok(Object.isFrozen(sent[0]!.body));
  assert.equal(owner.getSnapshot().detail?.header && 'status' in owner.getSnapshot().detail!.header!
    ? owner.getSnapshot().detail!.header.status : null, 'revoked');

  // Rights loss fail-closed: no POST when managed projection no longer includes the game.
  port.invitation = async () => ({ ...base, id: 'invite-mgr', version: 6 });
  includeManaged = false;
  await owner.loadDetail(invite); await tick();
  assert.equal(owner.getSnapshot().detail?.managerEligible, false);
  const before = sent.length;
  await owner.act(invite, 'revoke');
  assert.equal(sent.length, before);

  // UNKNOWN exact packet retry — no auto after refresh; explicit retry only.
  let fail = true;
  const unknownSent: MessagePacket[] = [];
  const unknown = setup({
    identity: async () => 'public-manager',
    invitation: async () => ({ ...base, id: 'invite-u', version: 2 }),
    managed: async () => ({ items: [{ id: 'game-managed' }], nextCursor: null }),
    send: async p => { unknownSent.push(p); if (fail) throw new MessagesError('network'); return { ...base, id: 'invite-u', status: 'revoked', version: 3 }; },
  });
  const u = { kind: 'invitation' as const, id: 'invite-u' };
  unknown.owner.focus(u); await tick();
  await unknown.owner.act(u, 'revoke');
  assert.equal(unknownSent.length, 1);
  const packet = unknownSent[0]!;
  assert.equal(unknown.owner.getSnapshot().pending['invitation:invite-u']?.state, 'unknown');
  unknown.owner.setActor({ ...actor }); // same actor refresh must not auto-retry
  await unknown.owner.act(u, 'revoke');
  assert.equal(unknownSent.length, 1);
  fail = false;
  await unknown.owner.retry(u);
  assert.strictEqual(unknownSent[1], packet);
});

test('#522 APK46 revoke-only path: reject unsupported direct revoke; blur after managed GET → zero dispatch', async () => {
  assert.throws(() => mutationPath({ kind: 'direct', id: 'thread-a' }, 'revoke'), MessagesError);
  assert.throws(() => mutationPath({ kind: 'game', id: 'game-a' }, 'revoke'), MessagesError);
  assert.equal(mutationPath({ kind: 'invitation', id: 'inv-1' }, 'revoke'), '/invitations/inv-1/revoke');
  // Old direct accept/send semantics stay intact.
  assert.equal(mutationPath({ kind: 'direct', id: 'thread-a' }, 'accept'), '/conversations/thread-a/accept');
  assert.equal(mutationPath({ kind: 'direct', id: 'thread-a' }, 'send'), '/conversations/thread-a/messages');

  const invite = { kind: 'invitation', id: 'invite-blur' } as const;
  const base = {
    id: 'invite-blur', gameId: 'game-managed', status: 'pending' as const, version: 1,
    inviterPublicPlayerId: 'public-b', inviteePublicPlayerId: 'public-peer',
    expiresAt: null, participationId: null, acceptanceContext: null,
  };
  const actGate = deferred<{ items: { id: string }[]; nextCursor: null }>();
  let managedPhase = 0;
  const blurSent: MessagePacket[] = [];
  const { owner } = setup({
    identity: async () => 'public-manager',
    invitation: async () => ({ ...base }),
    managed: async () => {
      managedPhase++;
      // First call seeds focus detail; act() re-checks eligibility behind the gate.
      if (managedPhase <= 1) return { items: [{ id: 'game-managed' }], nextCursor: null };
      return actGate.promise;
    },
    send: async p => { blurSent.push(p); return { ...base, status: 'revoked', version: 2 }; },
  });
  owner.focus(invite); await tick();
  assert.equal(owner.getSnapshot().detail?.managerEligible, true);
  const work = owner.act(invite, 'revoke');
  await tick();
  owner.setForeground(false);
  actGate.resolve({ items: [{ id: 'game-managed' }], nextCursor: null });
  await work;
  assert.equal(blurSent.length, 0);
  assert.equal(owner.getSnapshot().pending['invitation:invite-blur'], undefined);
  assert.equal(owner.getSnapshot().notice, null);
});

test('#522 APK46 revoke fence: captured foreground lifecycle invalidates after background→return; live boolean alone is not enough', () => {
  const invite = { kind: 'invitation', id: 'invite-aba' } as const;
  const { owner } = setup({
    identity: async () => 'public-manager',
    invitation: async () => ({
      id: 'invite-aba', gameId: 'game-managed', status: 'pending', version: 1,
      inviterPublicPlayerId: 'public-b', inviteePublicPlayerId: 'public-peer',
      expiresAt: null, participationId: null, acceptanceContext: null,
    }),
    managed: async () => ({ items: [{ id: 'game-managed' }], nextCursor: null }),
  });
  owner.focus(invite);
  const packet = Object.freeze({
    actor: Object.freeze({ ...actor }), resource: Object.freeze({ ...invite }), action: 'revoke' as const,
    method: 'POST' as const, path: '/invitations/invite-aba/revoke',
    body: Object.freeze({ expectedVersion: 1 }), key: 'k-aba',
  });
  const view = owner.getSnapshot().viewGeneration;
  const life = owner.foregroundLifecycle();
  assert.equal(owner.mayDispatchRevoke(packet, 0, view, life), true);
  owner.setForeground(false);
  owner.setForeground(true);
  assert.equal(owner.getSnapshot().viewGeneration, view);
  assert.notEqual(owner.foregroundLifecycle(), life);
  assert.equal(owner.mayDispatchRevoke(packet, 0, view, life), false);
  assert.equal(owner.mayDispatchRevoke(packet, 0, view, owner.foregroundLifecycle()), true);
});

test('#522 APK46 revoke fence: proven-zero stale clears initial sending; UNKNOWN network retained; reconcile stale keeps packet', async () => {
  const invite = { kind: 'invitation', id: 'invite-fence' } as const;
  const base = {
    id: 'invite-fence', gameId: 'game-managed', status: 'pending' as const, version: 2,
    inviterPublicPlayerId: 'public-b', inviteePublicPlayerId: 'public-peer',
    expiresAt: null, participationId: null, acceptanceContext: null,
  };
  let mode: 'stale' | 'network' | 'ok' = 'stale';
  const sent: MessagePacket[] = [];
  const { owner } = setup({
    identity: async () => 'public-manager',
    invitation: async () => ({ ...base }),
    managed: async () => ({ items: [{ id: 'game-managed' }], nextCursor: null }),
    send: async p => {
      sent.push(p);
      if (mode === 'stale') throw new MessagesError('stale');
      if (mode === 'network') throw new MessagesError('network');
      return { ...base, status: 'revoked', version: 3 };
    },
  });
  owner.focus(invite); await tick();
  await owner.act(invite, 'revoke');
  assert.equal(sent.length, 1);
  assert.equal(owner.getSnapshot().pending['invitation:invite-fence'], undefined);
  assert.equal(owner.getSnapshot().notice, null);

  mode = 'network';
  await owner.act(invite, 'revoke');
  assert.equal(sent.length, 2);
  const packet = sent[1]!;
  assert.equal(owner.getSnapshot().pending['invitation:invite-fence']?.state, 'unknown');
  assert.strictEqual(owner.getSnapshot().pending['invitation:invite-fence']?.packet, packet);

  mode = 'stale';
  await owner.retry(invite);
  assert.equal(sent.length, 3);
  assert.equal(owner.getSnapshot().pending['invitation:invite-fence']?.state, 'unknown');
  assert.strictEqual(owner.getSnapshot().pending['invitation:invite-fence']?.packet, packet);

  mode = 'ok';
  await owner.retry(invite);
  assert.equal(sent.length, 4);
  assert.strictEqual(sent[3], packet);
  assert.equal(owner.getSnapshot().pending['invitation:invite-fence'], undefined);
});
