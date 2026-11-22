import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNativeApi } from '../src/native-api.ts';
import { PostgameCoordinator } from '../src/postgame-coordinator.ts';
import { PostgameError, parseResults, parseAttendance, parseOwnResults, parseReminders, mayAcknowledge, needsAttention, cursor, wire, validateReceipt, normalizeFormReason } from '../src/postgame.ts';
import type { Attendance, Results, OwnResult, Reminder, Intent, Packet } from '../src/postgame.ts';
import { hubRows, hubBucket, matchesFilter, hubView, sortHubRows } from '../src/my-games.ts';
import type { Actor } from '../src/participation.ts';
import { game as publicGame } from './fixtures.ts';
import type { Game } from '@gobadminton/contracts/game-types';
const game = {...publicGame,version:1} satisfies Game;
const actor: Actor={actorId:'actor-a',sessionId:'session-a',generation:1};
const date='2026-11-14T10:00:00Z';
const row: Attendance={contextId:'context-a',value:'unknown',version:0,late:false,assertion:{actorDisplay:null,source:null,at:null},acknowledgedVersion:null,dispute:null,displayName:'Игрок',allowedActions:{canSetAttendance:true,canAcknowledge:false,canDispute:true,canWithdrawDispute:false,canRespondDispute:false,canRequestHelp:false}};
const result: Results={gameId:game.id,outcome:{value:'unknown',version:0,reason:null,provenance:null},revisions:[],revisionsNextCursor:null,allowedActions:{canRecordOutcome:true},attendance:{installed:true,writesEnabled:true,myAttendance:null,roster:[row],rosterNextCursor:null,summary:{rosterCount:1,marked:0,unknown:1,underClarification:0,agreed:0},allowedActions:{canRecordAttendance:true,canBulkPresent:true}}};
const own: OwnResult={gameId:game.id,contextId:row.contextId,gameTitle:'Игра',endsAt:date,attendance:row,notice:null};
const reminder: Reminder={id:'reminder-a',gameId:game.id,gameTitle:'Игра',endsAt:date,ordinal:1,version:1,state:'visible',dueAt:date,visibleAt:date,resultsPath:`/my-games/${game.id}/results`,allowedActions:{canOpenResults:true,canLater:true}};
const intent: Intent={kind:'attendance',gameId:game.id,contextId:row.contextId,body:{expectedVersion:0,value:'present'}};
function packet(intent: Intent): Packet {const w=wire(intent);return {...intent,actor,key:'original-key',method:w.method,path:w.path};}
const marked: Attendance={...row,value:'present',version:1,assertion:{actorDisplay:'Организатор',source:'manager_explicit',at:date},allowedActions:{...row.allowedActions,canAcknowledge:true}};
function setup() {
  const sent:Packet[]=[], cursors:(string|undefined)[]=[];
  const port={own:async (_actor:Actor,cursor?:string)=>{cursors.push(cursor);return {items:[own],nextCursor:cursor ? null : 'page-2'};},reminders:async()=>({items:[reminder],installed:true,writesEnabled:true}),invitations:async()=>({items:[],nextCursor:null}),results:async (_actor:Actor,id:string)=>({...structuredClone(result),gameId:id}),send:async(p:Packet):Promise<unknown>=>{sent.push(p);return marked;}};
  const coordinator=new PostgameCoordinator(port,()=>`key-${sent.length}`);coordinator.setActor(actor);return {coordinator,port,sent,cursors};
}
const deferred=<T,>()=>{let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return {resolve,promise};};
test('complete current DTOs: creator without seat, participant, self provenance and disputed rights',()=>{
  assert.equal(parseResults(result).attendance?.myAttendance,null);
  const self={...marked,assertion:{...marked.assertion,source:'self_attested' as const},allowedActions:{...marked.allowedActions,canAcknowledge:false}};
  const participant=parseResults({...result,allowedActions:{canRecordOutcome:false},revisions:undefined,attendance:{...result.attendance,myAttendance:self,roster:null}});
  assert.equal(participant.attendance?.myAttendance?.assertion.source,'self_attested'); assert.equal(mayAcknowledge(self),false);assert.equal(self.acknowledgedVersion,null);
  assert.equal(mayAcknowledge({...self,allowedActions:{...self.allowedActions,canAcknowledge:true}}),true); // server authority distinguishes exact authorship
  assert.equal(mayAcknowledge(marked),true);assert.equal(mayAcknowledge(row),false);
  assert.equal(mayAcknowledge({...marked,dispute:{id:'dispute-a',status:'open',version:1,challengedVersion:1}}),false);
  assert.deepEqual(parseOwnResults({items:[own],nextCursor:null}).items[0],own);
  assert.deepEqual(parseReminders({items:[reminder],writesEnabled:true,installed:true}).items,[reminder]);
  const notice={id:'notice-a',attendanceVersion:1,value:'present' as const,late:false,source:'manager_explicit' as const,actorDisplay:'Организатор',createdAt:date,acknowledgedAt:null};
  assert.equal(needsAttention({...own,attendance:marked,notice}),true);
  assert.equal(needsAttention({...own,attendance:marked,notice:{...notice,source:'self_attested'}}),false);
  assert.equal(needsAttention({...own,attendance:{...marked,version:2},notice}),false);
  for(const bad of [{...marked,late:'yes'},{...marked,version:-1},{...marked,allowedActions:{}},{...marked,assertion:{}},{...row,value:'present'},{...marked,acknowledgedVersion:2}]) assert.throws(()=>parseAttendance(bad),PostgameError);
  assert.throws(()=>parseResults({...result,outcome:{value:'held',version:1}}));
  assert.throws(()=>parseReminders({items:[{...reminder,resultsPath:'/games/create'}],installed:true,writesEnabled:true}));
});
test('independent relation facts, dedup, WEB buckets and own-result-only dates',()=>{
  const managed={...game,management:{role:'manager' as const,createdByMe:false}};
  const p={id:'p',gameId:game.id,userId:actor.actorId,status:'confirmed' as const,version:1,attemptNumber:1,requestedAt:date};
  const rows=hubRows([managed],[p],[own],[reminder]);assert.equal(rows.length,1);const r=rows[0]!;
  assert.equal(r.parts.length,1);assert.equal(r.own.length,1);assert.equal(r.reminders.length,1);assert.ok(matchesFilter(r,'manage'));assert.ok(matchesFilter(r,'participate'));
  assert.equal(hubBucket(r,{...game,status:'draft'},Date.parse(date)),'draft');
  assert.equal(hubBucket(r,undefined,Date.parse(date)+1),'past');
  assert.equal(hubBucket({...r,own:[],reminders:[]},undefined),'unknown');
  assert.equal(hubBucket(r,{...game,status:'cancelled',endsAt:'2099-01-01T00:00:00Z'}),'terminal');
  assert.equal(hubBucket(r,{...game,endsAt:'2099-01-01T00:00:00Z'}),'upcoming');
});
test('bounded own cursors retain loaded pages/filter across result navigation and partial-source failures',async()=>{
  const s=setup();s.coordinator.filter('participate');await s.coordinator.loadOwn();await s.coordinator.loadOwn(true);assert.deepEqual(s.cursors,[undefined,'page-2']);
  await s.coordinator.loadResults(game.id);await s.coordinator.loadResults('other-game');assert.equal(s.coordinator.getSnapshot().filter,'participate');assert.equal(s.coordinator.getSnapshot().own.data?.items.length,1);
  s.port.reminders=async()=>{throw new PostgameError('network');};await s.coordinator.loadReminders();assert.equal(s.coordinator.getSnapshot().reminders.status,'error');assert.equal(s.coordinator.getSnapshot().own.status,'ready');assert.equal(s.sent.length,0);
  await s.coordinator.loadResults(game.id,{rosterCursor:'arbitrary'});assert.equal(s.sent.length,0);
});
test('explicit review and double tap produce one immutable exact command, with current server rights',async()=>{
  const s=setup(), wait=deferred<Attendance>();s.port.send=async p=>{s.sent.push(p);return wait.promise;};await s.coordinator.loadResults(game.id);
  s.coordinator.review(intent);assert.equal(s.sent.length,0);const first=s.coordinator.confirm();await s.coordinator.confirm();assert.equal(s.sent.length,1);
  const p=s.sent[0]!;assert.ok(Object.isFrozen(p));assert.ok(Object.isFrozen(p.body));assert.ok(Object.isFrozen(p.actor));assert.equal(p.path,`/games/${game.id}/attendance/${row.contextId}`);assert.equal(p.method,'PUT');
  wait.resolve(marked);await first;assert.equal(s.coordinator.getSnapshot().command,null);
  const denied=setup();denied.port.results=async()=>({...result,allowedActions:{canRecordOutcome:false}});await denied.coordinator.loadResults(game.id);denied.coordinator.review({kind:'outcome',gameId:game.id,body:{expectedVersion:0,outcome:'held'}});await denied.coordinator.confirm();assert.equal(denied.sent.length,0);
});
test('real fetch ANY5xx business code, network, in-progress and malformed receipt retain exact original packet; GET never settles',async()=>{
  for(const reply of [()=>new Response(JSON.stringify({code:'VERSION_CONFLICT'}),{status:503}),()=>new Response(JSON.stringify({code:'COMMAND_IN_PROGRESS'}),{status:409}),()=>new Response('{}'),()=>{throw new TypeError('network');}]) {
    const api=createNativeApi(async()=>reply()), s=setup();s.port.send=async p=>{s.sent.push(p);return api.postgameMutation('private-token',p);};await s.coordinator.loadResults(game.id);s.coordinator.review(intent);await s.coordinator.confirm();
    const original=s.coordinator.getSnapshot().command!.packet;assert.equal(s.coordinator.getSnapshot().command?.status,'unknown');
    await s.coordinator.loadResults('other-game');await s.coordinator.loadResults(game.id);await s.coordinator.loadOwn();assert.equal(s.sent.length,1);assert.equal(s.coordinator.getSnapshot().command?.packet,original);
    s.port.send=async p=>{s.sent.push(p);return marked;};await s.coordinator.reconcile('other-game');assert.equal(s.sent.length,1);await s.coordinator.reconcile(game.id);assert.equal(s.sent[1],original);assert.equal(s.coordinator.getSnapshot().command,null);
  }
});
test('receipt identity/version cannot fake success; sameactor reauth restores only original UNKNOWN; B/logout wipe',async()=>{
  const s=setup();s.port.send=async p=>{s.sent.push(p);return {...marked,contextId:'foreign'};};await s.coordinator.loadResults(game.id);s.coordinator.review(intent);await s.coordinator.confirm();const original=s.sent[0]!;
  s.coordinator.setActor(null);assert.equal(s.coordinator.getSnapshot().command,null);assert.deepEqual(s.coordinator.getSnapshot().games,{});
  s.coordinator.setActor({...actor,sessionId:'verified-new-session',generation:3});assert.equal(s.coordinator.getSnapshot().command?.packet,original);assert.equal(s.sent.length,1);
  s.port.send=async p=>{s.sent.push(p);return marked;};await s.coordinator.reconcile(game.id);assert.equal(s.sent[1],original);
  s.coordinator.setActor({...actor,actorId:'actor-b',generation:4});assert.equal(s.coordinator.getSnapshot().command,null);s.coordinator.forget();s.coordinator.setActor(actor);assert.equal(s.coordinator.getSnapshot().command,null);
  assert.throws(()=>validateReceipt({...marked,version:9},packet(intent)));assert.throws(()=>validateReceipt({...marked,acknowledgedVersion:null},packet({kind:'ack',gameId:game.id,contextId:row.contextId,body:{attendanceVersion:1}})));
});
test('late mutation and read callbacks cannot populate another actor or supersede a newer game read',async()=>{
  const s=setup(), wait=deferred<Attendance>();s.port.send=async p=>{s.sent.push(p);return wait.promise;};await s.coordinator.loadResults(game.id);s.coordinator.review(intent);const work=s.coordinator.confirm();
  s.coordinator.setActor({...actor,actorId:'actor-b',generation:2});wait.resolve(marked);await work;assert.equal(s.coordinator.getSnapshot().notice,null);assert.deepEqual(s.coordinator.getSnapshot().games,{});
  const read=deferred<Results>();s.port.results=async()=>read.promise;const stale=s.coordinator.loadResults(game.id);s.port.results=async()=>({...result,outcome:{...result.outcome,reason:'newer'}});await s.coordinator.loadResults(game.id);read.resolve(result);await stale;assert.equal(s.coordinator.getSnapshot().games[game.id]?.data?.outcome.reason,'newer');
});
test('wire bodies, complete matching receipts and closed HTTP methods never expose arbitrary transport',async()=>{
  const inputs:Intent[]=[{kind:'outcome',gameId:game.id,body:{expectedVersion:0,outcome:'held'}},intent,{kind:'bulk',gameId:game.id,body:{items:[{contextId:row.contextId,expectedVersion:0}],confirmedExactSelection:true}},{kind:'ack',gameId:game.id,contextId:row.contextId,body:{attendanceVersion:1}},{kind:'later',gameId:game.id,reminderId:reminder.id,body:{command:'later',expectedVersion:1}}];
  const calls:{url:string;init:RequestInit}[]=[];const api=createNativeApi(async(url,init)=>{calls.push({url:String(url),init:init!});return new Response('{}');});
  for(const i of inputs) {const p=packet(i);await api.postgameMutation('secret',p);const call=calls.at(-1)!;assert.equal(call.url,`https://dev.gobadminton.ru/v1${p.path}`);assert.equal(call.init.method,p.method);assert.equal(call.init.credentials,'omit');assert.equal(call.init.redirect,'error');assert.deepEqual(JSON.parse(String(call.init.body)),i.body);const headers=call.init.headers as Record<string,string>;assert.equal(headers.Cookie,undefined);assert.equal(headers.Origin,undefined);assert.equal(headers['Idempotency-Key'],p.key);}
  assert.throws(()=>wire({...intent,body:{expectedVersion:1,value:'present'}}));
  assert.throws(()=>wire({kind:'bulk',gameId:game.id,body:{items:[{contextId:row.contextId,expectedVersion:0},{contextId:row.contextId,expectedVersion:0}],confirmedExactSelection:true}}));
  validateReceipt({items:[marked]},packet(inputs[2]!));assert.throws(()=>validateReceipt({items:[]},packet(inputs[2]!)));
  validateReceipt({items:[],installed:true,writesEnabled:true},packet(inputs[4]!));
});
test('manager cursors retain independent pages; denied private source clears data and no stale ACK/selection is sent',async()=>{
  const s=setup(), second={...row,contextId:'context-b',displayName:'Другой игрок'};
  s.port.results=async()=>({...structuredClone(result),revisions:[],revisionsNextCursor:'rev-2',attendance:{...result.attendance!,roster:[row],rosterNextCursor:'roster-2'}});
  await s.coordinator.loadResults(game.id);
  // Override the port with the same owning query shape to verify exact server cursors.
  const queries:unknown[]=[];
  const owner=new PostgameCoordinator({own:s.port.own,reminders:s.port.reminders,invitations:s.port.invitations,send:s.port.send,results:async(_actor,id,query)=>{
    queries.push(query);
    return {...structuredClone(result),gameId:id,revisions:[],revisionsNextCursor:'rev-2',attendance:{...result.attendance!,roster:query?.rosterCursor ? [second] : [row],rosterNextCursor:query?.rosterCursor ? null : 'roster-2'}};
  }},()=> 'key');
  owner.setActor(actor);await owner.loadResults(game.id);await owner.loadResults(game.id,{rosterCursor:'roster-2'},'roster');
  assert.deepEqual(owner.getSnapshot().games[game.id]?.data?.attendance?.roster?.map(r=>r.contextId),['context-a','context-b']);assert.equal(owner.getSnapshot().games[game.id]?.data?.revisionsNextCursor,'rev-2');
  await owner.loadResults(game.id,{rosterCursor:'invented'},'roster');assert.equal(queries.length,2);
  const acked=setup();acked.port.results=async()=>({...result,attendance:{...result.attendance!,myAttendance:{...marked,dispute:{id:'open',version:1,challengedVersion:1,status:'open'}},roster:null}});
  await acked.coordinator.loadResults(game.id);acked.coordinator.review({kind:'ack',gameId:game.id,contextId:row.contextId,body:{attendanceVersion:1}});await acked.coordinator.confirm();assert.equal(acked.sent.length,0);
  s.port.results=async()=>{throw new PostgameError('private',404);};await s.coordinator.loadResults(game.id);assert.equal(s.coordinator.getSnapshot().games[game.id]?.status,'unavailable');assert.equal(s.coordinator.getSnapshot().games[game.id]?.data,undefined);
});
test('real transport abort timeout is UNKNOWN and retains method/path/body/key until explicit reconcile',async(t)=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const api=createNativeApi(async(_url,init)=>new Promise<Response>((_resolve,reject)=>{init?.signal?.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')),{once:true});}));
  const s=setup();s.port.send=async p=>{s.sent.push(p);return api.postgameMutation('secret',p);};await s.coordinator.loadResults(game.id);s.coordinator.review(intent);
  const work=s.coordinator.confirm();const original=s.sent[0]!;t.mock.timers.tick(15_000);await work;
  assert.equal(s.coordinator.getSnapshot().command?.status,'unknown');assert.equal(s.coordinator.getSnapshot().command?.packet,original);assert.equal(s.sent.length,1);
  s.port.send=async p=>{s.sent.push(p);return marked;};await s.coordinator.reconcile(game.id);assert.equal(s.sent[1],original);t.mock.timers.reset();
});
test('refresh never overwrites a reviewed draft; stale version/rights require new review and zero writes',async()=>{
  const s=setup();await s.coordinator.loadResults(game.id);s.coordinator.review(intent);
  const draft=s.coordinator.getSnapshot().review;
  s.port.results=async()=>({...result,attendance:{...result.attendance!,roster:[marked]}});
  await s.coordinator.loadResults(game.id);assert.equal(s.coordinator.getSnapshot().review,draft);
  await s.coordinator.confirm();assert.equal(s.sent.length,0);assert.equal(s.coordinator.getSnapshot().review,null);assert.ok(s.coordinator.getSnapshot().notice?.includes('Данные изменились'));
});

test('append roster: same actor loses manager role but retains seat; fresh HTTP200 projection drops private pages', {timeout:1000}, async()=>{
  const s=setup(), page=deferred<Results>();
  const revision={version:1,before:null,after:{value:'held' as const,reason:null},reason:null,source:'manager_explicit' as const,recordedAt:date};
  s.port.results=async()=>parseResults({...result,revisions:[revision],revisionsNextCursor:'private-revisions',attendance:{...result.attendance!,myAttendance:marked,rosterNextCursor:'private-roster'}});
  await s.coordinator.loadResults(game.id);
  s.port.results=async()=>page.promise;
  const append=s.coordinator.loadResults(game.id,{rosterCursor:'private-roster'},'roster');
  const participant=parseResults({gameId:game.id,outcome:result.outcome,allowedActions:{canRecordOutcome:false},attendance:{...result.attendance!,myAttendance:marked,roster:null,rosterNextCursor:null,summary:null,allowedActions:{canRecordAttendance:false,canBulkPresent:false}}});
  page.resolve(participant);await append;
  const fresh=s.coordinator.getSnapshot().games[game.id]?.data;
  assert.deepEqual(s.coordinator.getSnapshot().actor,actor);assert.equal(fresh?.attendance?.myAttendance?.contextId,row.contextId);
  assert.equal(fresh?.attendance?.roster,null);assert.equal(fresh?.attendance?.rosterNextCursor,null);
  assert.equal(fresh?.revisions,undefined);assert.equal(fresh?.revisionsNextCursor,undefined);assert.equal(fresh?.allowedActions.canRecordOutcome,false);
  assert.equal(s.sent.length,0);
});
test('append revisions: fresh omitted history never reconstructs old revisions/cursor or former-manager roster', {timeout:1000}, async()=>{
  const s=setup(), page=deferred<Results>();
  s.port.results=async()=>parseResults({...result,revisions:[{version:1,before:null,after:{value:'held',reason:null},reason:null,source:'manager_explicit',recordedAt:date}],revisionsNextCursor:'private-revisions',attendance:{...result.attendance!,myAttendance:marked,rosterNextCursor:'private-roster'}});
  await s.coordinator.loadResults(game.id);s.port.results=async()=>page.promise;
  const append=s.coordinator.loadResults(game.id,{revisionsCursor:'private-revisions'},'revisions');
  page.resolve(parseResults({gameId:game.id,outcome:result.outcome,allowedActions:{canRecordOutcome:false},attendance:{...result.attendance!,myAttendance:marked,roster:null,rosterNextCursor:null,summary:null,allowedActions:{canRecordAttendance:false,canBulkPresent:false}}}));
  await append;
  const fresh=s.coordinator.getSnapshot().games[game.id]?.data;
  assert.deepEqual(s.coordinator.getSnapshot().actor,actor);assert.equal(fresh?.attendance?.myAttendance?.version,marked.version);
  assert.equal(fresh?.revisions,undefined);assert.equal(fresh?.revisionsNextCursor,undefined);assert.equal(fresh?.attendance?.roster,null);assert.equal(fresh?.attendance?.rosterNextCursor,null);
  s.coordinator.review({kind:'outcome',gameId:game.id,body:{expectedVersion:0,outcome:'held'}});await s.coordinator.confirm();assert.equal(s.sent.length,0);
});
const pendingOwn:OwnResult={...own,attendance:marked,notice:{id:'notice-current',attendanceVersion:1,value:'present',late:false,source:'manager_explicit',actorDisplay:'Организатор',createdAt:date,acknowledgedAt:null}};
const ackIntent:Intent={kind:'ack',gameId:game.id,contextId:row.contextId,body:{attendanceVersion:1}};
const ackReceipt:Attendance={...marked,acknowledgedVersion:1,allowedActions:{...marked.allowedActions,canAcknowledge:false}};
async function readyAck() {
  const s=setup();
  s.port.results=async(_actor,id)=>({...structuredClone(result),gameId:id,attendance:{...result.attendance!,myAttendance:marked,roster:null}});
  await s.coordinator.loadResults(game.id);
  return s;
}
test('exact ACK closes only matching loaded hub attention, retaining every page, cursor, filter and other game',async()=>{
  const s=await readyAck(), reply=deferred<Attendance>();
  const otherGame={...pendingOwn,gameId:'other-game'}, otherContext={...pendingOwn,contextId:'other-context',attendance:{...marked,contextId:'other-context'}};
  s.port.own=async(_actor,cursor)=>{s.cursors.push(cursor);return {items:cursor ? [pendingOwn] : [otherGame,otherContext],nextCursor:cursor ? 'page-3' : 'page-2'};};
  await s.coordinator.loadOwn();await s.coordinator.loadOwn(true);s.coordinator.filter('participate');
  await s.coordinator.loadResults('other-game');const otherProjection=s.coordinator.getSnapshot().games['other-game'];
  s.port.send=async p=>{s.sent.push(p);return reply.promise;};
  s.coordinator.review(ackIntent);const work=s.coordinator.confirm();
  assert.ok(needsAttention(s.coordinator.getSnapshot().own.data!.items[2]!));
  reply.resolve(ackReceipt);await work;
  const snapshot=s.coordinator.getSnapshot(), items=snapshot.own.data!.items;
  assert.equal(snapshot.own.status,'ready');assert.equal(snapshot.own.data?.nextCursor,'page-3');assert.equal(snapshot.filter,'participate');
  assert.equal(items.length,3);assert.equal(items[0],otherGame);assert.equal(items[1],otherContext);assert.equal(snapshot.games['other-game'],otherProjection);
  assert.equal(items[2]?.notice,null);assert.equal(items[2]?.attendance.acknowledgedVersion,1);
  assert.equal(items[2]?.attendance.allowedActions,pendingOwn.attendance.allowedActions);
  assert.deepEqual(hubView(hubRows([],[],items,[]),'all').attention.map(r=>r.gameId),['other-game',game.id]);
  assert.deepEqual(s.cursors,[undefined,'page-2']);assert.equal(s.sent.length,1);
  // The retained cursor remains usable, including historical duplicates of the ACKed row.
  s.port.own=async(_actor,cursor)=>{s.cursors.push(cursor);return {items:[{...pendingOwn,notice:null,attendance:ackReceipt}],nextCursor:null};};
  await s.coordinator.loadOwn(true);assert.equal(s.cursors.at(-1),'page-3');
  assert.equal(s.coordinator.getSnapshot().own.data?.items.length,3);assert.equal(s.coordinator.getSnapshot().filter,'participate');
});
test('pre-ACK pending own append cannot resurrect attention and retains fresh page rights, rows and next cursor',async()=>{
  const s=await readyAck(), page=deferred<{items:OwnResult[];nextCursor:string|null}>(), reply=deferred<Attendance>();
  s.port.own=async()=>({items:[pendingOwn],nextCursor:'page-2'});await s.coordinator.loadOwn();
  s.port.own=async()=>page.promise;const read=s.coordinator.loadOwn(true);
  s.port.send=async p=>{s.sent.push(p);return reply.promise;};s.coordinator.review(ackIntent);const work=s.coordinator.confirm();
  reply.resolve(ackReceipt);await work;
  assert.equal(s.coordinator.getSnapshot().own.status,'loading');assert.equal(s.coordinator.getSnapshot().own.data?.items[0]?.notice,null);
  const other={...pendingOwn,gameId:'new-page-game'};
  const freshRights={...marked.allowedActions,canSetAttendance:false,canAcknowledge:false};
  page.resolve({items:[{...pendingOwn,attendance:{...marked,displayName:'Актуальное имя',allowedActions:freshRights}},other],nextCursor:'page-3'});await read;
  const snapshot=s.coordinator.getSnapshot(), target=snapshot.own.data!.items[0]!;
  assert.equal(target.notice,null);assert.equal(target.attendance.acknowledgedVersion,1);assert.equal(needsAttention(target),false);
  assert.equal(target.attendance.displayName,'Актуальное имя');assert.equal(target.attendance.allowedActions,freshRights);
  assert.equal(snapshot.own.data?.items[1],other);assert.equal(snapshot.own.data?.nextCursor,'page-3');assert.equal(s.sent.length,1);
  // A later authoritative refresh is unrestricted: a new version needs a new ACK.
  const replacement={...pendingOwn,attendance:{...marked,version:2},notice:{...pendingOwn.notice!,id:'notice-v2',attendanceVersion:2}};
  s.port.own=async()=>({items:[replacement],nextCursor:null});await s.coordinator.loadOwn();
  assert.equal(s.coordinator.getSnapshot().own.data?.items[0],replacement);assert.ok(needsAttention(replacement));
});
test('overlapping own refresh failure retains the real ACK; a private failure still strips the projection',async()=>{
  for (const error of [new PostgameError('network'),new PostgameError('private',404)]) {
    const s=await readyAck(), gate=deferred<void>();
    s.port.own=async()=>({items:[pendingOwn],nextCursor:'page-2'});await s.coordinator.loadOwn();
    s.port.own=async()=>{await gate.promise;throw error;};const read=s.coordinator.loadOwn();
    s.port.send=async p=>{s.sent.push(p);return ackReceipt;};s.coordinator.review(ackIntent);await s.coordinator.confirm();
    gate.resolve();await read;
    const source=s.coordinator.getSnapshot().own;
    if(error.kind === 'private') {assert.equal(source.status,'unavailable');assert.equal(source.data,undefined);}
    else {assert.equal(source.status,'error');assert.equal(source.data?.items[0]?.notice,null);assert.equal(source.data?.items[0]?.attendance.acknowledgedVersion,1);assert.equal(source.data?.nextCursor,'page-2');}
  }
});
test('late historical ACK receipt never replaces a newer current own version or its attention',async()=>{
  const s=await readyAck(), reply=deferred<Attendance>();
  s.port.own=async()=>({items:[pendingOwn],nextCursor:'page-2'});await s.coordinator.loadOwn();
  s.port.send=async p=>{s.sent.push(p);return reply.promise;};s.coordinator.review(ackIntent);const work=s.coordinator.confirm();
  const current={...pendingOwn,attendance:{...marked,version:2},notice:{...pendingOwn.notice!,id:'notice-v2',attendanceVersion:2}};
  s.port.own=async()=>({items:[current],nextCursor:'current-cursor'});await s.coordinator.loadOwn();
  reply.resolve(ackReceipt);await work;
  assert.equal(s.coordinator.getSnapshot().own.data?.items[0],current);assert.ok(needsAttention(current));assert.equal(s.coordinator.getSnapshot().own.data?.nextCursor,'current-cursor');assert.equal(s.sent.length,1);
});
test('actor/session switch fences pending own GET and ACK, even after returning to identical actor credentials',async()=>{
  for (const next of [{...actor,actorId:'actor-b',generation:2},{...actor,sessionId:'session-new',generation:2},actor]) {
    const s=await readyAck(), page=deferred<{items:OwnResult[];nextCursor:string|null}>(), reply=deferred<Attendance>();
    s.port.own=async()=>({items:[pendingOwn],nextCursor:'page-2'});await s.coordinator.loadOwn();
    s.port.own=async()=>page.promise;const read=s.coordinator.loadOwn(true);
    s.port.send=async p=>{s.sent.push(p);return reply.promise;};s.coordinator.review(ackIntent);const work=s.coordinator.confirm();
    s.coordinator.setActor(null);s.coordinator.setActor(next);
    const current={...pendingOwn,gameTitle:'Только новая сессия'};
    s.port.own=async()=>({items:[current],nextCursor:'new-session-cursor'});await s.coordinator.loadOwn();
    const before=s.coordinator.getSnapshot();reply.resolve(ackReceipt);page.resolve({items:[pendingOwn],nextCursor:null});await work;await read;
    assert.equal(s.coordinator.getSnapshot(),before);assert.equal(before.own.data?.items[0],current);assert.ok(needsAttention(current));assert.deepEqual(before.games,{});assert.equal(s.sent.length,1);
  }
});
test('rejected ACK retains hub attention and never starts a follow-up write',async()=>{
  const s=await readyAck(), response=deferred<Response>();
  s.port.own=async()=>({items:[pendingOwn],nextCursor:'page-2'});await s.coordinator.loadOwn();
  const api=createNativeApi(async()=>response.promise);
  s.port.send=async p=>{s.sent.push(p);return api.postgameMutation('secret',p);};
  s.coordinator.review(ackIntent);const work=s.coordinator.confirm();
  response.resolve(new Response(JSON.stringify({code:'VERSION_CONFLICT'}),{status:409}));await work;
  assert.equal(s.coordinator.getSnapshot().own.data?.items[0],pendingOwn);assert.ok(needsAttention(pendingOwn));assert.equal(s.coordinator.getSnapshot().command,null);
  await s.coordinator.reconcile(game.id);assert.equal(s.sent.length,1);assert.equal(s.coordinator.getSnapshot().own.data?.nextCursor,'page-2');
});
test('actual ACK transport timeout retains attention and frozen original packet; only explicit reconcile settles it',async(t)=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const s=await readyAck();s.port.own=async()=>({items:[pendingOwn],nextCursor:'page-2'});await s.coordinator.loadOwn();
  const api=createNativeApi(async(_url,init)=>new Promise<Response>((_resolve,reject)=>{init?.signal?.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')),{once:true});}));
  s.port.send=async p=>{s.sent.push(p);return api.postgameMutation('secret',p);};
  s.coordinator.review(ackIntent);const work=s.coordinator.confirm(), original=s.sent[0]!;
  t.mock.timers.tick(15_000);await work;t.mock.timers.reset();
  assert.equal(s.coordinator.getSnapshot().command?.status,'unknown');assert.equal(s.coordinator.getSnapshot().command?.packet,original);
  assert.ok(Object.isFrozen(original));assert.ok(Object.isFrozen(original.body));assert.deepEqual(original.body,{attendanceVersion:1});assert.equal(original.method,'POST');assert.equal(original.path,`/games/${game.id}/attendance/${row.contextId}/acknowledgements`);
  assert.equal(s.coordinator.getSnapshot().own.data?.items[0],pendingOwn);
  await s.coordinator.loadOwn();await s.coordinator.loadResults(game.id);s.coordinator.review(ackIntent);await s.coordinator.confirm();
  assert.equal(s.sent.length,1);assert.ok(needsAttention(s.coordinator.getSnapshot().own.data!.items[0]!));assert.equal(s.coordinator.getSnapshot().command?.packet,original);
  const reply=deferred<Attendance>();s.port.send=async p=>{s.sent.push(p);return reply.promise;};const reconcile=s.coordinator.reconcile(game.id);
  assert.equal(s.sent[1],original);assert.equal(s.sent[1]?.key,original.key);assert.equal(s.coordinator.getSnapshot().own.data?.items[0],pendingOwn);
  reply.resolve(ackReceipt);await reconcile;
  assert.equal(s.coordinator.getSnapshot().command,null);assert.equal(s.coordinator.getSnapshot().own.data?.items[0]?.notice,null);assert.equal(s.sent.length,2);
});
test('own same-page newest external + older self-suppressed null preserves attention and fresh attendance truth', {timeout:1000}, async()=>{
  const s=setup();
  s.port.own=async()=>({items:[pendingOwn,{...pendingOwn,notice:null,attendance:{...marked,displayName:'Текущее имя',allowedActions:{...marked.allowedActions,canAcknowledge:false,canSetAttendance:false}}}],nextCursor:null});
  await s.coordinator.loadOwn();const loaded=s.coordinator.getSnapshot().own.data?.items;
  assert.equal(loaded?.length,1);assert.equal(loaded?.[0]?.notice?.id,'notice-current');assert.equal(loaded?.[0]?.attendance.displayName,'Текущее имя');assert.equal(loaded?.[0]?.attendance.allowedActions.canAcknowledge,false);assert.equal(loaded?.[0]?.attendance.allowedActions.canSetAttendance,false);assert.ok(loaded?.[0] && needsAttention(loaded[0]));assert.equal(s.sent.length,0);
});
test('own next-page null cannot hide current notice; fresh ACK or new version clears/replaces obsolete notice', {timeout:1000}, async()=>{
  const s=setup();
  s.port.own=async(_actor,cursor)=>({items:[cursor ? {...pendingOwn,notice:null} : pendingOwn],nextCursor:cursor ? null : 'older'});
  await s.coordinator.loadOwn();await s.coordinator.loadOwn(true);
  assert.ok(needsAttention(s.coordinator.getSnapshot().own.data!.items[0]!));
  // Current ACK in a historical row wins even while appending.
  s.port.own=async()=>({items:[pendingOwn],nextCursor:'acked-page'});await s.coordinator.loadOwn();
  s.port.own=async()=>({items:[{...pendingOwn,notice:null,attendance:{...marked,acknowledgedVersion:1,allowedActions:{...marked.allowedActions,canAcknowledge:false}}}],nextCursor:null});
  await s.coordinator.loadOwn(true);const acked=s.coordinator.getSnapshot().own.data!.items[0]!;
  assert.equal(acked.notice,null);assert.equal(acked.attendance.acknowledgedVersion,1);assert.equal(needsAttention(acked),false);
  s.port.own=async()=>({items:[pendingOwn],nextCursor:'version-page'});await s.coordinator.loadOwn();
  s.port.own=async()=>({items:[{...pendingOwn,notice:null,attendance:{...marked,version:2}}],nextCursor:null});
  await s.coordinator.loadOwn(true);assert.equal(s.coordinator.getSnapshot().own.data?.items[0]?.notice,null);
  const replacement:OwnResult={...pendingOwn,attendance:{...marked,version:2},notice:{...pendingOwn.notice!,id:'notice-v2',attendanceVersion:2}};
  s.port.own=async()=>({items:[replacement,{...replacement,notice:null}],nextCursor:null});await s.coordinator.loadOwn();
  assert.equal(s.coordinator.getSnapshot().own.data?.items[0]?.notice?.id,'notice-v2');assert.equal(s.sent.length,0);
});
test('hub filter-empty and attention use full loaded union, include reminder-only games once, and keep real targets',()=>{
  const union=hubRows([],[],[pendingOwn],[{...reminder,gameId:'reminder-only'},{...reminder,id:'second-reminder',gameId:'reminder-only'}]);
  const view=hubView(union,'manage');assert.equal(view.rows.length,1);assert.deepEqual(view.attention.map(r=>r.gameId),[game.id,'reminder-only']);
  const filtered=hubView(hubRows([],[],[own],[]),'manage');assert.equal(filtered.empty,'filter');assert.equal(filtered.rows.length,0);
  assert.equal(hubView(hubRows([],[],[own],[]),'all').empty,null);assert.equal(hubView([],'all').empty,'loaded');
  assert.equal(hubView(hubRows([],[],[{...pendingOwn,attendance:{...marked,version:2}}],[]),'all').attention.length,0);
});
test('hub orders upcoming starts ASC and past ends DESC with own/reminder fallback and stable unknown bucket',()=>{
  const later={...game,id:'later',startsAt:'2099-02-01T10:00:00Z',endsAt:'2099-02-01T12:00:00Z',management:{role:'manager' as const,createdByMe:false}};
  const sooner={...later,id:'sooner',startsAt:'2099-01-01T10:00:00Z',endsAt:'2099-01-01T12:00:00Z'};
  const upcoming=hubRows([later,sooner],[],[],[]);
  assert.deepEqual(sortHubRows(upcoming,'upcoming',r=>r.managed).map(r=>r.gameId),['sooner','later']);assert.equal(upcoming[0]?.gameId,'later');
  const history=hubRows([],[],[{...own,gameId:'older',endsAt:'2026-01-01T00:00:00Z'},{...own,gameId:'unknown',endsAt:null}],[{...reminder,gameId:'newer',endsAt:'2026-02-01T00:00:00Z'}]);
  const past=history.filter(r=>hubBucket(r,undefined,Date.parse('2027-01-01')) === 'past');
  assert.deepEqual(sortHubRows(past,'past',()=>undefined).map(r=>r.gameId),['newer','older']);
  const unknown=history.filter(r=>hubBucket(r,undefined) === 'unknown');assert.deepEqual(sortHubRows(unknown,'unknown',()=>undefined).map(r=>r.gameId),['unknown']);
});
test('typed wire validation still rejects every C0/DEL control and cursor whitespace',()=>{
  for(const code of [...Array.from({length:32},(_,i)=>i),127]) {
    assert.throws(()=>cursor(`page${String.fromCharCode(code)}two`),PostgameError);
    assert.throws(()=>wire({kind:'outcome',gameId:game.id,body:{expectedVersion:1,outcome:'held',reason:`a${String.fromCharCode(code)}b`}}),PostgameError);
  }
  assert.throws(()=>cursor('page two'),PostgameError);assert.equal(cursor('opaque-page_2'),'opaque-page_2');
});

test('busy/UNKNOWN dismiss and rejected new intent never alter or resend the original coordinator command', {timeout:1000}, async()=>{
  const s=setup(), reply=deferred<Attendance>();
  s.port.send=async p=>{s.sent.push(p);return reply.promise;};await s.coordinator.loadResults(game.id);
  s.coordinator.review(intent);const sending=s.coordinator.confirm(), original=s.sent[0]!;
  s.coordinator.cancelReview();s.coordinator.review({kind:'outcome',gameId:game.id,body:{expectedVersion:0,outcome:'held'}});
  assert.equal(s.coordinator.getSnapshot().review,null);assert.equal(s.coordinator.getSnapshot().command?.packet,original);assert.equal(s.sent.length,1);
  reply.resolve({...marked,contextId:'bad-receipt'});await sending;
  s.coordinator.cancelReview();s.coordinator.review(intent);await s.coordinator.confirm();
  assert.equal(s.coordinator.getSnapshot().command?.status,'unknown');assert.equal(s.coordinator.getSnapshot().command?.packet,original);assert.equal(s.sent.length,1);
});
test('form CRLF/CR/LF normalization reaches immutable review and strict wire with the exact reason',async()=>{
  const s=setup();await s.coordinator.loadResults(game.id);
  for(const newline of ['\r\n','\r','\n']) {
    const raw=`  Изменилось время${newline}Согласовано  с участниками  `;
    const reason=normalizeFormReason(raw);
    assert.equal(reason,'Изменилось время Согласовано  с участниками');
    const outcome:Intent={kind:'outcome',gameId:game.id,body:{expectedVersion:0,outcome:'not_held',reason}};
    s.coordinator.review(outcome);
    const review=s.coordinator.getSnapshot().review;
    assert.deepEqual(review,outcome);assert.ok(Object.isFrozen(review));assert.ok(Object.isFrozen(review?.body));
    assert.deepEqual(wire(review!).body,outcome.body);assert.equal(s.sent.length,0);
    const attendance:Intent={kind:'attendance',gameId:game.id,contextId:row.contextId,body:{expectedVersion:1,value:'present',correctionReason:reason}};
    assert.deepEqual(wire(attendance).body,attendance.body);
    assert.throws(()=>wire({...outcome,body:{...outcome.body,reason:raw.trim()}}),PostgameError);
    assert.throws(()=>wire({...attendance,body:{...attendance.body,correctionReason:raw.trim()}}),PostgameError);
    s.coordinator.cancelReview();
  }
  assert.equal(normalizeFormReason('  Первая\r\n\r\nВторая\rТретья\nЧетвёртая  '),'Первая  Вторая Третья Четвёртая');
});
test('form normalization preserves other C0/DEL for rejection and retains wire reason length/required rules',()=>{
  const outcome=(reason:string):Intent=>({kind:'outcome',gameId:game.id,body:{expectedVersion:1,outcome:'held',reason}});
  const attendance=(correctionReason:string):Intent=>({kind:'attendance',gameId:game.id,contextId:row.contextId,body:{expectedVersion:1,value:'present',correctionReason}});
  for(const code of [...Array.from({length:32},(_,i)=>i).filter(i=>i !== 10 && i !== 13),127]) {
    const control=String.fromCharCode(code);
    for(const raw of [`${control}Причина`,`При${control}чина`,`Причина${control}`]) {
      const reason=normalizeFormReason(raw);assert.equal(reason,raw);
      assert.throws(()=>wire(outcome(reason)),PostgameError);assert.throws(()=>wire(attendance(reason)),PostgameError);
    }
  }
  const limit=normalizeFormReason(`  ${'я'.repeat(498)}\r\nя  `);
  assert.equal(limit.length,500);assert.deepEqual(wire(outcome(limit)).body,outcome(limit).body);
  assert.deepEqual(wire(attendance(limit)).body,attendance(limit).body);
  for(const raw of [' \r\n  ',`${'я'.repeat(499)}\nя`]) {
    const reason=normalizeFormReason(raw);
    assert.throws(()=>wire(outcome(reason)),PostgameError);assert.throws(()=>wire(attendance(reason)),PostgameError);
  }
});
