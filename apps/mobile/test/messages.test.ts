import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MessagesCoordinator } from '../src/messages-coordinator.ts';
import type { MessagePacket, MessagesPort } from '../src/messages-coordinator.ts';
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
function setup(overrides: Partial<MessagesPort> = {}) {
  let serial=0; const sent: MessagePacket[]=[];
  const port: MessagesPort = { inbox: async () => page, counts: async () => counts, identity: async () => 'public-a', direct: async () => header,
    game: async () => { throw Error('unexpected'); }, members: async () => [], invitation: async () => { throw Error('unexpected'); },
    history: async () => ({ items: [message('9007199254740993'),message('9007199254740994',true),message('9007199254740995')], nextCursor: '9007199254740993' }),
    send: async p => { sent.push(p); return {}; }, ...overrides };
  const owner = new MessagesCoordinator(port,() => 'random-'+(++serial)); owner.setActor(actor);
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
  gate.resolve(header); await tick(); assert.equal(owner.getSnapshot().detail?.header,null);
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
