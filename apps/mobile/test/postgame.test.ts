import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNativeApi } from '../src/native-api.ts';
import { PostgameCoordinator } from '../src/postgame-coordinator.ts';
import { PostgameError, parseResults, parseAttendance, parseOwnResults, parseReminders, mayAcknowledge, needsAttention, wire, validateReceipt } from '../src/postgame.ts';
import type { Attendance, Results, OwnResult, Reminder, Intent, Packet } from '../src/postgame.ts';
import { hubRows, hubBucket, matchesFilter } from '../src/my-games.ts';
import type { Actor } from '../src/participation.ts';
import { game } from './fixtures.ts';
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
  const port={own:async (_actor:Actor,cursor?:string)=>{cursors.push(cursor);return {items:[own],nextCursor:cursor ? null : 'page-2'};},reminders:async()=>({items:[reminder],installed:true,writesEnabled:true}),results:async (_actor:Actor,id:string)=>({...structuredClone(result),gameId:id}),send:async(p:Packet):Promise<unknown>=>{sent.push(p);return marked;}};
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
  const owner=new PostgameCoordinator({own:s.port.own,reminders:s.port.reminders,send:s.port.send,results:async(_actor,id,query)=>{
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
