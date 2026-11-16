import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {URL as NodeURL} from 'node:url';
import {CommunityError, parseOwn, parsePage, parseSummaries, freezePacket, parseReceipt, commentText} from '../src/venue-community.ts';
import type {Comment, Query, Action, Packet} from '../src/venue-community.ts';
import {VenueCommunityCoordinator} from '../src/venue-community-coordinator.ts';
import type {CommunityPorts} from '../src/venue-community-coordinator.ts';
import {createNativeApi} from '../src/native-api.ts';
import {createPublicApi} from '../src/public-api.ts';
const venue = '00000000-0000-4000-8000-000000000001', canonical = '00000000-0000-4000-8000-000000000002';
const rootId = '00000000-0000-4000-8000-000000000003', replyId = '00000000-0000-4000-8000-000000000004';
const photoId = '00000000-0000-4000-8000-000000000005', actor = {actorId:'actor',sessionId:'session',generation:1};
const scope = {venueId:venue,canonicalVenueId:canonical}, stamp = '2026-11-15T12:00:00Z';
const summary = {venueId:venue,canonicalVenueId:canonical,state:'empty',average:null,count:0};
const own = (version = 0) => ({summary,own:{venueId:venue,canonicalVenueId:canonical,value:version ? 4 : null,version,withdrawn:false,moderationState:'clear',allowedActions:{upsert:!version,update:!!version,withdraw:!!version}}});
const row = (overrides: Partial<Comment> = {}): Comment => ({id:rootId,entityKind:'venue',entityId:canonical,parentCommentId:null,body:'Question',deleted:false,version:1,createdAt:stamp,updatedAt:stamp,edited:false,mine:true,replyCount:0,author:{displayName:'Игрок',publicPlayerId:null,profilePublic:false,avatar:{uploadedUrl:null,providerUrl:null}},photos:[],...overrides});
const page = (q: Query, items = [row()], nextCursor: string | null = null) => ({entityKind:'venue',entityId:canonical,parentCommentId:q.parentCommentId,items,nextCursor,visibleCount:items.length,canCreate:true});
const deferred = <T,>() => { let resolve!: (value:T)=>void; let reject!: (error:unknown)=>void; const promise = new Promise<T>((r,j) => {resolve=r;reject=j;});return {promise,resolve,reject}; };
async function fixture() {
  let serial = 10, writes = 0;
  const packets: unknown[] = [];
  const ports: CommunityPorts = {summary:async()=>({items:[summary]}),guestComments:async(q:Query)=>({...page(q),canCreate:false,items:[row({mine:false})]}),own:async()=>own(),comments:async(q:Query)=>page(q),
    send:async(p:Parameters<typeof parseReceipt>[1]) => { writes++;packets.push(p);return {...own(1),own:{...own(1).own,value:4}}; },random:()=>`00000000-0000-4000-8000-${String(serial++).padStart(12,'0')}`};
  const owner = new VenueCommunityCoordinator(ports); owner.setActor(actor); owner.open(venue);await owner.refresh();
  return {owner,ports,packets,writes:()=>writes};
}
test('actual zero own version, bounded ratings/versions, canonical aliases and unavailable differ from empty',()=>{
  assert.equal(parseOwn(own(),venue).own!.version,0);
  assert.equal(parseSummaries({items:[summary]},venue).canonicalVenueId,canonical);
  assert.throws(()=>parseOwn({...own(),own:{...own().own,version:-1}},venue));
  assert.throws(()=>parseOwn({...own(),own:{...own().own,value:6}},venue));
  assert.throws(()=>parseSummaries({items:[{...summary,venueId:canonical}]},venue));
  assert.throws(()=>parseSummaries({items:[{...summary,state:'unavailable',count:0}]},venue));
  assert.equal(commentText(' 😀\n Text '),'😀\n Text'); assert.equal([...commentText('😀'.repeat(1000))].length,1000);
  assert.throws(()=>commentText('😀'.repeat(1001)));
});
test('family page proves origin aliases, validates parent/order/cursor and revision-bound photos; raw provider discarded',()=>{
  const q:Query = {venueId:venue,parentCommentId:null,order:'asc',cursor:null};
  const r = row({entityId:venue,photos:[{id:photoId,width:400,height:300,url:`/v1/comments/${rootId}/revisions/1/photos/${photoId}`}]});
  assert.equal(parsePage(page(q,[r]),scope,q).items[0]!.entityId,venue);
  for (const bad of [{...r,parentCommentId:replyId},{...r,photos:[{...r.photos[0],url:'https://evil.test/pixel'}]},{...r,deleted:true}]) assert.throws(()=>parsePage(page(q,[bad as Comment]),scope,q));
  assert.throws(()=>parsePage({...page(q),entityId:replyId},scope,q));
  assert.throws(()=>parsePage({...page(q),nextCursor:'\n'},scope,q));
  const raw = {...r,author:{displayName:'Public',profilePublic:true,publicPlayerId:photoId,avatar:{uploadedUrl:null,providerUrl:'https://provider.test/private'}}};
  assert.equal(parsePage(page(q,[raw as unknown as Comment]),scope,q).items[0]!.author!.avatar.providerUrl,null);
});
test('immutable exact photo retention and receipt binding, version, tombstone and masked body',()=>{
  const c = row({photos:[{id:photoId,width:400,height:300,url:`/v1/comments/${rootId}/revisions/1/photos/${photoId}`}]});
  const p = freezePacket(actor,scope,{kind:'edit',comment:c,text:'Changed'},replyId);
  c.photos.length=0;assert.deepEqual(p.body.photoIds,[photoId]);assert.equal(p.body.expectedVersion,1);assert.ok(Object.isFrozen(p.action));
  const receipt = row({version:2,body:'Ch*****',photos:[{id:photoId,width:400,height:300,url:`/v1/comments/${rootId}/revisions/2/photos/${photoId}`}]});
  assert.equal((parseReceipt(receipt,p) as Comment).body,'Ch*****');
  for (const bad of [{...receipt,version:1},{...receipt,entityId:venue},{...receipt,id:replyId},{...receipt,mine:false},{...receipt,photos:[]}]) assert.throws(()=>parseReceipt(bad,p));
  const deletion=freezePacket(actor,scope,{kind:'delete',comment:row()},replyId);
  assert.equal((parseReceipt(row({version:2,deleted:true,body:null}),deletion) as Comment).deleted,true);
  assert.throws(()=>freezePacket(actor,scope,{kind:'delete',comment:row({parentCommentId:replyId})},replyId));
});
test('selected venue/current actor fences stale GET and clears drafts/current authority; collapse retains unknown packet',async()=>{
  const {owner,ports,writes}=await fixture();owner.setDraft('root','unsent');
  const delayed=deferred<unknown>();ports.own=()=>delayed.promise;
  const reading=owner.loadOwn();owner.setActor(null);delayed.resolve(own(8));await reading;
  assert.equal(owner.getSnapshot().own,null);assert.deepEqual(owner.getSnapshot().drafts,{});assert.equal(writes(),0);
  owner.setActor(actor);ports.own=async()=>own();await owner.refresh();
  ports.send=async()=>{throw new CommunityError('network');};
  const p=owner.review({kind:'upsert',value:4,expectedVersion:0})!;assert.ok(p);await owner.commit(p.key);
  assert.equal(owner.getSnapshot().operations[0]!.status,'unknown');owner.detach();owner.open(venue);await owner.refresh();
  assert.equal(owner.getSnapshot().operations[0]!.packet,p);assert.equal(owner.getSnapshot().operations[0]!.status,'unknown');
  owner.open(replyId);await owner.refresh();assert.equal(owner.getSnapshot().own,null);assert.deepEqual(owner.getSnapshot().operations,[]);
});
test('failed ACK stays UNKNOWN; GET does not settle; explicit reconciliation uses same frozen key and cannot repaint old receipt',async()=>{
  const {owner,ports,packets}=await fixture();let calls=0;
  ports.send=async p=>{packets.push(p);calls++;return calls===1 ? {malformed:true} : {...own(1),own:{...own(1).own,value:4,moderationState:'withheld'}};};
  const p=owner.review({kind:'upsert',value:4,expectedVersion:0})!;await owner.commit(p.key);
  await owner.refresh();assert.equal(owner.getSnapshot().operations[0]!.status,'unknown');assert.equal(calls,1);
  ports.own=async()=>({...own(9),own:{...own(9).own,value:2,allowedActions:{upsert:false,update:false,withdraw:false},moderationState:'withheld'}});
  await owner.reconcile(p.key);assert.equal(calls,2);assert.equal(packets[0],packets[1]);
  assert.equal(owner.getSnapshot().operations[0]!.status,'confirmed');assert.equal(owner.getSnapshot().own!.own!.version,9);assert.equal(owner.canRate(),false);
});
test('pagination retains all pages/order/cursors, rejects cross-root replies; root edit rights and withholding authoritative',async()=>{
  const {owner,ports}=await fixture();
  ports.comments=async q=>q.parentCommentId ? page(q,[row({id:replyId,parentCommentId:q.parentCommentId})]) : q.cursor ? page(q,[row({id:replyId,createdAt:'2026-11-15T13:00:00Z'})]) : page(q,[row()],'next');
  await owner.loadThread(null);await owner.loadThread(null,true);assert.equal(owner.getSnapshot().roots.pages.length,2);
  await owner.refresh();assert.equal(owner.getSnapshot().roots.pages.length,2);
  await owner.loadThread(rootId);assert.equal(owner.getSnapshot().replies[rootId]!.pages[0]!.page.items[0]!.id,replyId);
  ports.comments=async q=>page(q,[row({id:replyId,parentCommentId:photoId})]);await owner.loadThread(rootId);
  assert.equal(owner.getSnapshot().replies[rootId]!.phase,'error');
  ports.own=async()=>({...own(3),own:{...own(3).own,moderationState:'withheld',allowedActions:{upsert:false,update:false,withdraw:false}}});await owner.loadOwn();
  assert.equal(owner.canRate(),false);assert.equal(owner.review({kind:'upsert',value:5,expectedVersion:3}),null);
});
test('true pending followed by actor rotation cannot ACK into a new actor; refusal preserves unsent draft',async()=>{
  const {owner,ports}=await fixture(), delayed=deferred<unknown>();ports.send=()=>delayed.promise;
  owner.setDraft('root','Question');const p=owner.review({kind:'create',text:'Question',parentCommentId:null,parentEntityId:canonical})!;
  const writing=owner.commit(p.key);owner.setActor({...actor,generation:2});delayed.resolve(row());await writing;
  assert.equal(owner.getSnapshot().operations.length,0);assert.deepEqual(owner.getSnapshot().drafts,{});
  await owner.refresh();owner.setDraft('root','Keep this');ports.send=async()=>{throw new CommunityError('refused',422,'PUBLIC_TEXT_CONTENT_REJECTED');};
  const rejected=owner.review({kind:'create',text:'Keep this',parentCommentId:null,parentEntityId:canonical})!;await owner.commit(rejected.key);
  assert.equal(owner.getSnapshot().drafts.root,'Keep this');assert.equal(owner.getSnapshot().operations[0]!.status,'refused');
});
test('anonymous summary has no credentials; selected native ports have no guest fallback and exact report subject/key',async()=>{
  const seen:{url:string;init:RequestInit}[]=[];
  const fetcher:typeof fetch=async(url,init)=>{seen.push({url:String(url),init:init!});return new Response(JSON.stringify({items:[summary]}));};
  const pub=createPublicApi(fetcher), api=createNativeApi(fetcher);await pub.communitySummary(venue);
  assert.equal(seen[0]!.init.credentials,'omit');assert.deepEqual(seen[0]!.init.headers,{Accept:'application/json'});
  const action:Action={kind:'report',report:{targetKind:'venue_community',subjectKind:'venue_comment',venueId:venue,commentId:replyId,expectedVersion:7,reasonCode:'spam',detail:'private'}};
  const p=freezePacket(actor,scope,action,photoId);await api.communityMutation('opaque',p);
  assert.equal(seen[1]!.url,'https://dev.gobadminton.ru/v1/reports');assert.equal((seen[1]!.init.headers as Record<string,string>)['Idempotency-Key'],photoId);
  assert.deepEqual(JSON.parse(seen[1]!.init.body as string),p.body);assert.equal(p.body.commentId,replyId);
  const invalid=createNativeApi(async()=>new Response('{}',{status:401}));await assert.rejects(invalid.communityComments('bad',{venueId:venue,parentCommentId:null,cursor:null,order:'asc'}));
});
test('compact VenuePreview/maps are exact pinned bytes; community follows schedule and keyboard is owned by actual hosts',()=>{
  const read=(p:string)=>readFileSync(new NodeURL(p,import.meta.url),'utf8');
  const maps=read('../src/maps.ts');assert.equal(createHash('sha256').update(maps).digest('hex'),'d6267be2cf1f973e56ac8396c1536ddaa4f0b9384028fb9fc042cd80984c1c85');
  const detail=read('../src/components/venue-detail.tsx'), sheet=read('../src/components/venue-sheet.tsx');
  const community=read('../src/components/venue-community.tsx');
  // Accepted-base hosts: compact preview has no UGC; expanded VenueContent places community after schedule twice.
  assert.equal((detail.match(/<NativeVenueCommunity /g)??[]).length,2);
  const preview=detail.slice(detail.indexOf('export function VenuePreview'));
  assert.equal(preview.includes('NativeVenueCommunity'),false);
  assert.match(detail,/\{\s*schedule\s*\}\s*\n\s*<NativeVenueCommunity /);
  assert.match(detail,/\{\s*schedule \?\? <Schedule venue=\{venue\} \/>\s*\}\s*\n\s*<NativeVenueCommunity /);
  // Sheet keeps sticky Create + keyboardShouldPersistTaps; dialog keyboard is Page-owned in community UI.
  assert.match(sheet,/keyboardShouldPersistTaps="handled"/);
  assert.match(sheet,/returnFocusRef/);
  assert.match(sheet,/PrimaryButton title="Создать игру на этой площадке"/);
  assert.doesNotMatch(preview,/NativeVenueCommunity/);
  assert.match(community,/<Page keyboard/);
});

test('edit owner resumes unsent text after detach/reopen and cancel/reopen without trusting a supplied cached row',async()=>{
  const {owner,ports,writes}=await fixture();
  assert.equal(owner.beginEdit(rootId),true);owner.setDraft(`edit:${rootId}`,'Unsent 😀\nsecond line');
  owner.setDraft('root','Separate root draft');owner.setDraft(replyId,'Separate reply draft');
  owner.detach();owner.open(venue);await owner.refresh();
  assert.equal(owner.beginEdit(rootId),true);assert.equal(owner.getSnapshot().drafts[`edit:${rootId}`],'Unsent 😀\nsecond line');
  // Cancelling the editor has no discard command; another beginEdit resumes even an empty draft.
  owner.setDraft(`edit:${rootId}`,'');assert.equal(owner.beginEdit(rootId),true);assert.equal(owner.getSnapshot().drafts[`edit:${rootId}`],'');
  const loading=deferred<unknown>();ports.comments=()=>loading.promise;const reading=owner.loadThread(null);
  assert.equal(owner.beginEdit(rootId),false);assert.equal(owner.getSnapshot().drafts[`edit:${rootId}`],'');
  loading.resolve(page({venueId:venue,parentCommentId:null,order:'asc',cursor:null}));await reading;
  assert.equal(owner.beginEdit(rootId),true);assert.equal(owner.getSnapshot().drafts.root,'Separate root draft');
  assert.equal(owner.getSnapshot().drafts[replyId],'Separate reply draft');assert.equal(writes(),0);
});
test('authoritative revision, deletion, private access, permissions and actor generation retire incompatible edit text',async()=>{
  const {owner,ports}=await fixture();
  const draft=()=>{assert.equal(owner.beginEdit(rootId),true);owner.setDraft(`edit:${rootId}`,'Private unsent draft');};
  draft();ports.comments=async q=>page(q,[row({version:2,body:'Published revision',updatedAt:'2026-11-15T14:00:00Z'})]);await owner.loadThread(null);
  assert.equal(owner.getSnapshot().drafts[`edit:${rootId}`],undefined);assert.ok(owner.getSnapshot().editNotice);
  assert.equal(owner.beginEdit(rootId),true);assert.equal(owner.getSnapshot().drafts[`edit:${rootId}`],'Published revision');
  owner.setDraft(`edit:${rootId}`,'Do not retain');ports.comments=async q=>page(q,[row({deleted:true,body:null,version:3})]);await owner.loadThread(null);
  assert.equal(owner.beginEdit(rootId),false);assert.equal(owner.getSnapshot().drafts[`edit:${rootId}`],undefined);
  ports.comments=async q=>page(q);await owner.loadThread(null);draft();
  ports.comments=async q=>({...page(q),canCreate:false});await owner.loadThread(null);
  assert.equal(owner.beginEdit(rootId),false);assert.deepEqual(owner.getSnapshot().drafts,{});
  ports.comments=async q=>page(q);await owner.loadThread(null);draft();
  ports.comments=async()=>{throw new CommunityError('private',404);};await owner.loadThread(null);
  assert.deepEqual(owner.getSnapshot().drafts,{});assert.equal(owner.beginEdit(rootId),false);
  ports.comments=async q=>page(q);await owner.refresh();draft();owner.setActor({...actor,generation:2});await owner.refresh();
  assert.equal(owner.getSnapshot().drafts[`edit:${rootId}`],undefined);assert.equal(owner.beginEdit(rootId),true);
  assert.equal(owner.getSnapshot().drafts[`edit:${rootId}`],'Question');
});
test('confirmed masked edit clears only its draft and retains authoritative photos and unrelated drafts',async()=>{
  const {owner,ports}=await fixture();
  const original=row({photos:[{id:photoId,width:400,height:300,url:`/v1/comments/${rootId}/revisions/1/photos/${photoId}`}]});
  const other=row({id:replyId,createdAt:'2026-11-15T13:00:00Z'});
  ports.comments=async q=>page(q,[original,other]);await owner.loadThread(null);
  assert.equal(owner.beginEdit(replyId),true);owner.setDraft(`edit:${replyId}`,'Unrelated edit');
  assert.equal(owner.beginEdit(rootId),true);owner.setDraft(`edit:${rootId}`,'Changed text');
  owner.setDraft('root','Unrelated root');owner.setDraft(replyId,'Unrelated reply');
  const receipt=row({version:2,body:'Ch*****',photos:[{...original.photos[0]!,url:`/v1/comments/${rootId}/revisions/2/photos/${photoId}`}]});
  ports.send=async()=>receipt;
  const p=owner.review({kind:'edit',comment:owner.rows()[0]!,text:owner.getSnapshot().drafts[`edit:${rootId}`]!})!;
  assert.deepEqual(p.body.photoIds,[photoId]);await owner.commit(p.key);
  assert.equal(owner.getSnapshot().operations[0]!.status,'confirmed');assert.equal(owner.getSnapshot().drafts[`edit:${rootId}`],undefined);
  assert.equal(owner.getSnapshot().drafts.root,'Unrelated root');assert.equal(owner.getSnapshot().drafts[replyId],'Unrelated reply');
  assert.equal(owner.getSnapshot().drafts[`edit:${replyId}`],'Unrelated edit');
});
test('paginated UNKNOWN edit/delete/reply stays reachable with frozen context after venue return omits target; retry is exact and explicit',async()=>{
  for (const kind of ['edit','delete','reply'] as const) {
    const {owner,ports}=await fixture();let omit=false;
    const target=row({id:replyId,createdAt:'2026-11-15T13:00:00Z'});
    ports.summary=async requested=>({items:[{...summary,venueId:requested,canonicalVenueId:requested===venue ? canonical : photoId}]});
    ports.own=async requested=>({...own(),summary:{...summary,venueId:requested,canonicalVenueId:requested===venue ? canonical : photoId},
      own:{...own().own,venueId:requested,canonicalVenueId:requested===venue ? canonical : photoId}});
    ports.comments=async q=>q.venueId!==venue ? {...page(q,[]),entityId:photoId} : q.parentCommentId ? page(q,[]) : q.cursor ? page(q,omit ? [] : [target]) : page(q,[row()],omit ? null : 'next');
    await owner.loadThread(null);await owner.loadThread(null,true);await owner.loadThread(replyId);
    // Authorized edit/delete compare serialized parsed current rows; raw fixture author-field order differs.
    const current=owner.rows().find(c=>c.id===replyId)!;
    const action:Action=kind==='edit' ? {kind:'edit',comment:current,text:'Unsent exact 😀\nedit'}
      : kind==='delete' ? {kind:'delete',comment:current} : {kind:'create',parentCommentId:replyId,parentEntityId:canonical,text:'Exact reply'};
    const sent:Packet[]=[];const lost=deferred<unknown>();
    ports.send=(p,permit)=>{assert.equal(permit(),true);sent.push(p);return lost.promise;};
    const p=owner.review(action)!;assert.ok(p);const immutable=JSON.stringify(p), context=owner.getSnapshot().operations[0]!.context;
    assert.ok(Object.isFrozen(context));assert.equal(context.target,'Комментарий · Игрок');
    if (kind==='delete') assert.match(context.consequence!,/Ответы в ветке сохранятся/);
    else assert.equal(context.text,kind==='edit' ? 'Unsent exact 😀\nedit' : 'Exact reply');
    const writing=owner.commit(p.key);assert.equal(owner.unresolved()[0]!.status,'pending');assert.equal(owner.busy(),true);
    await owner.reconcile(p.key);assert.equal(sent.length,1);
    lost.reject(new CommunityError('network'));await writing;
    omit=true;owner.detach();owner.open(canonical);await owner.refresh();assert.deepEqual(owner.unresolved(),[]);
    owner.open(venue);await owner.refresh();assert.equal(owner.rows().some(c=>c.id===replyId),false);
    assert.equal(owner.unresolved()[0]!.context,context);assert.equal(owner.unresolved()[0]!.status,'unknown');assert.equal(owner.canReconcile(p.key),true);
    assert.equal(owner.busy(),true);assert.equal(sent.length,1);await owner.refresh();assert.equal(sent.length,1);
    ports.send=async next=>{sent.push(next);return {malformed:true};};await owner.reconcile(p.key);
    assert.equal(owner.unresolved()[0]!.status,'unknown');assert.equal(sent.length,2);
    ports.send=async next=>{sent.push(next);return kind==='delete' ? {...current,version:2,deleted:true,body:null}
      : kind==='edit' ? {...current,version:2,body:'Masked edit'} : row({id:photoId,parentCommentId:replyId,body:'Masked reply'});};
    await owner.reconcile(p.key);assert.equal(owner.getSnapshot().operations[0]!.status,'confirmed');assert.deepEqual(owner.unresolved(),[]);
    for (const packet of sent) {assert.equal(packet,p);assert.equal(JSON.stringify(packet),immutable);}
    assert.deepEqual(p.actor,actor);assert.deepEqual(p.scope,scope);
  }
});
test('UNKNOWN report freezes reason/detail beyond dialog loss; revoked permission and actor rotation cannot replay or expose history',async()=>{
  const {owner,ports}=await fixture();const sent:Packet[]=[];
  ports.send=async p=>{sent.push(p);throw new CommunityError('network');};
  const action:Action={kind:'report',report:{targetKind:'venue_community',subjectKind:'venue_comment',venueId:venue,commentId:rootId,expectedVersion:1,reasonCode:'harassment',detail:'Exact report detail'}};
  const p=owner.review(action)!;await owner.commit(p.key);action.report.detail='Dialog cleared';
  owner.detach();owner.open(venue);await owner.refresh();
  assert.equal(owner.unresolved()[0]!.context.detail,'Exact report detail');assert.equal(owner.unresolved()[0]!.context.reason,'Оскорбления / давление');
  assert.equal(owner.unresolved()[0]!.context.target,'Комментарий · Игрок');assert.equal(sent.length,1);
  ports.comments=async()=>{throw new CommunityError('private',404);};await owner.loadThread(null);
  assert.equal(owner.canReconcile(p.key),false);await owner.reconcile(p.key);assert.equal(sent.length,1);
  assert.equal(owner.unresolved()[0]!.status,'unknown');
  ports.comments=async q=>page(q);await owner.refresh();assert.equal(owner.canReconcile(p.key),true);
  owner.setActor({...actor,generation:2});await owner.refresh();assert.deepEqual(owner.unresolved(),[]);
  assert.deepEqual(owner.getSnapshot().operations,[]);await owner.reconcile(p.key);assert.equal(sent.length,1);
});
test('actor/session/generation/logout during pending success or rejection retires frozen context; late response and same-id reentry do not resurrect',async()=>{
  for (const outcome of ['success','rejection'] as const) {
    for (const change of ['generation','session','logout','reentry'] as const) {
      const {owner,ports}=await fixture();
      const sent:Packet[]=[];const gate=deferred<unknown>();
      ports.send=(p,permit)=>{assert.equal(permit(),true);sent.push(p);return gate.promise;};
      const p=owner.review({kind:'create',text:'Private draft that must retire',parentCommentId:null,parentEntityId:canonical})!;
      const writing=owner.commit(p.key);assert.equal(owner.unresolved()[0]!.status,'pending');
      assert.equal(owner.unresolved()[0]!.context.text,'Private draft that must retire');
      if (change==='generation') owner.setActor({...actor,generation:2});
      else if (change==='session') owner.setActor({...actor,sessionId:photoId,generation:2});
      else if (change==='logout') owner.setActor(null);
      else { owner.setActor(null); owner.setActor({...actor,sessionId:photoId,generation:2}); }
      assert.deepEqual(owner.unresolved(),[]);assert.deepEqual(owner.getSnapshot().operations,[]);
      if (outcome==='success') gate.resolve(row({id:photoId,body:'Ch*****'}));
      else gate.reject(new CommunityError('network'));
      await writing;
      assert.deepEqual(owner.unresolved(),[]);assert.deepEqual(owner.getSnapshot().operations,[]);
      assert.equal(sent.length,1);await owner.reconcile(p.key);assert.equal(sent.length,1);
      if (change!=='logout') {
        owner.setActor({...actor,sessionId:change==='session'||change==='reentry'?photoId:actor.sessionId,generation:2});
        await owner.refresh();
        assert.deepEqual(owner.unresolved(),[]);assert.deepEqual(owner.getSnapshot().operations,[]);
        await owner.reconcile(p.key);assert.equal(sent.length,1);
      }
    }
  }
});
