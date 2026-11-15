import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PlayInterestCoordinator } from '../src/play-interest-coordinator.ts';
import { interestWire, parsePlayInterestReceipt, parsePlayInterestStates, statesPath, validVersion, PlayInterestError } from '../src/play-interests.ts';
import { createNativeApi } from '../src/native-api.ts';
import type { PlayInterestPacket } from '../src/play-interests.ts';
const actor={actorId:'actor',sessionId:'session',generation:1};
const id='10000000-0000-4000-8000-000000000001';
const none={interestId:null,version:null,relationship:'none',capabilities:{canSend:true,canWithdraw:false}};
const receipt={interestId:id,version:'9007199254740993',outcome:'mutual'};
const peer={publicPlayerId:'peer',displayName:'Реальный игрок',cityId:null,areaKey:null,level:null,bio:null,trainer:false,lookingForGame:true};
const self={publicPlayerId:'self',displayName:'Мой профиль'};
const filters={cityId:null,name:'',looking:false,trainer:false};
const deferred=()=>{let resolve!:(v:unknown)=>void;let reject!:(v:unknown)=>void;const promise=new Promise<unknown>((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function setup(send:(packet:PlayInterestPacket)=>Promise<unknown>=async()=>receipt){
  const calls:PlayInterestPacket[]=[];
  const o=new PlayInterestCoordinator({random:()=> 'immutable-key-0001',read:async ids=>({items:ids.map(()=>none)}),send:async p=>{calls.push(p);return send(p);}});
  o.setActor(actor);o.stage(filters,{items:[peer,{...peer,publicPlayerId:'other'}],nextCursor:null});o.enter();
  return {o,calls};
}
test('strict positional state binding refuses count, invalid capability/identity/version and frozen request order',()=>{
  assert.equal(statesPath(['a','b']),'/me/play-interest-states?publicPlayerId=a&publicPlayerId=b');
  assert.deepEqual([...parsePlayInterestStates({items:[none,{...none,capabilities:{canSend:false,canWithdraw:false}}]},['b','a']).keys()],['b','a']);
  for(const v of [{items:[]},{items:[{...none,capabilities:{canSend:1,canWithdraw:false}}]},{items:[{...none,version:1}]},{items:[{...none,relationship:'unavailable'}]}])assert.throws(()=>parsePlayInterestStates(v,['a']));
  assert.throws(()=>statesPath(['a','a']));assert.throws(()=>statesPath(Array.from({length:51},(_,i)=>String(i))));
  for(const v of [1,'0','01','1e3','1\n','12345678901234567890'])assert.equal(validVersion(v),false);
  assert.equal(validVersion(receipt.version),true);assert.throws(()=>parsePlayInterestReceipt({...receipt,version:1},'send'));
});
test('root command survives Close; late mutual is consumed, never reopened, fast swipes cannot duplicate',async()=>{
  const gate=deferred(),{o,calls}=setup(()=>gate.promise);await o.refresh(['peer']);
  const s=o.getSnapshot(),send=o.act('send','peer',s.episode,self);
  await o.act('send','peer',s.episode,self);assert.equal(calls.length,1);
  o.exit();assert.equal(o.getSnapshot().command?.status,'sending');gate.resolve(receipt);await send;
  assert.equal(o.getSnapshot().match,null);o.enter();await o.refresh(['peer']);assert.equal(o.getSnapshot().match,null);
  await o.act('send','peer',s.episode,self);assert.equal(calls.length,1);
});
test('UNKNOWN is not resolved by GET or next card; explicit retry uses same body/key and session',async()=>{
  let attempt=0;const {o,calls}=setup(async()=>{if(!attempt++)throw Error('offline');return receipt;});
  await o.refresh(['peer']);await o.act('send','peer',o.getSnapshot().episode,self);
  const packet=o.getSnapshot().command?.packet;assert.equal(o.getSnapshot().command?.status,'unknown');
  o.select('other');await o.refresh(['other']);assert.equal(o.getSnapshot().command?.packet,packet);
  assert.equal(calls.length,1);await o.reconcile();assert.equal(calls.length,2);assert.equal(calls[0],calls[1]);
  assert.equal(o.getSnapshot().match?.peer.publicPlayerId,'peer');
});
test('actor/session/private generation/background fences receipts, no replay on lifecycle changes',async()=>{
  for(const change of ['actor','session','generation','background','exit'] as const){
    const gate=deferred(),{o,calls}=setup(()=>gate.promise);await o.refresh(['peer']);const send=o.act('send','peer',o.getSnapshot().episode,self);
    if(change==='background')o.setForeground(false);else if(change==='exit')o.exit();else o.setActor({...actor,...(change==='actor'?{actorId:'other'}:change==='session'?{sessionId:'new'}:{generation:2})});
    gate.resolve(receipt);await send;o.setForeground(true);o.enter();await o.reconcile();
    assert.equal(calls.length,1);assert.equal(o.getSnapshot().match,null);
  }
});
test('actual send receipt emits once with frozen display; historical mutual GET never emits; refusal clears capabilities',async()=>{
  const {o}=setup();await o.refresh(['peer']);assert.equal(o.getSnapshot().match,null);
  await o.act('send','peer',o.getSnapshot().episode,self);const match=o.getSnapshot().match;assert.equal(match?.receipt.outcome,'mutual');
  o.dismiss();await o.refresh(['peer']);await o.act('send','peer',o.getSnapshot().episode,self);assert.equal(o.getSnapshot().match,null);
  const refused=setup(async()=>{throw new PlayInterestError('refused',403,'UNAVAILABLE');});await refused.o.refresh(['peer']);
  await refused.o.act('send','peer',refused.o.getSnapshot().episode,self);assert.equal(refused.o.getSnapshot().states.size,0);assert.equal(refused.o.getSnapshot().command,null);
});
test('real owner → native API sends fixed origin/closed body/key, no cookies or Radar proof; decimal withdraw unchanged',async()=>{
  const calls:{url:string;init:RequestInit}[]=[];
  const api=createNativeApi(async(url,init)=>{calls.push({url:String(url),init:init!});return new Response(JSON.stringify(init?.method==='GET'?{items:[none]}:receipt));});
  const o=new PlayInterestCoordinator({random:()=> 'wire-key-0001',read:(ids)=>api.playInterestStates('token',ids),send:p=>api.playInterestMutation('token',p)});
  o.setActor(actor);o.stage(filters,{items:[peer],nextCursor:null});o.enter();await o.refresh(['peer']);assert.equal(calls.length,1);
  await o.act('send','peer',o.getSnapshot().episode,self);assert.equal(calls.length,2);
  assert.equal(calls[1]!.url,'https://dev.gobadminton.ru/v1/play-interests');assert.deepEqual(JSON.parse(String(calls[1]!.init.body)),{targetPublicPlayerId:'peer'});
  assert.equal(calls[1]!.init.credentials,'omit');assert.equal(calls[1]!.init.cache,'no-store');assert.equal((calls[1]!.init.headers as Record<string,string>)['Idempotency-Key'],'wire-key-0001');
  assert.equal(o.getSnapshot().match?.peer.publicPlayerId,'peer');
  const packet={kind:'withdraw',actor,target:'peer',path:`/play-interests/${id}/withdraw`,body:{expectedVersion:receipt.version},key:'withdraw-key'} as const;
  assert.deepEqual(interestWire(packet).body,{expectedVersion:receipt.version});
  assert.throws(()=>interestWire({...packet,path:'https://evil.test'}));assert.throws(()=>interestWire({...packet,body:{expectedVersion:1}} as never));
});

test('historical mutual reads and safety invalidation cannot create/revive a match event',async()=>{
  const o=new PlayInterestCoordinator({random:()=> 'historical-key',read:async()=>({items:[{interestId:id,version:'1',relationship:'mutual',capabilities:{canSend:false,canWithdraw:true}}]}),send:async()=>receipt});
  o.setActor(actor);o.stage(filters,{items:[peer],nextCursor:null});o.enter();await o.refresh(['peer']);assert.equal(o.getSnapshot().match,null);
  const gate=deferred(),live=setup(()=>gate.promise);await live.o.refresh(['peer']);
  const work=live.o.act('send','peer',live.o.getSnapshot().episode,self);live.o.invalidate();gate.resolve(receipt);await work;
  assert.equal(live.o.getSnapshot().match,null);assert.equal(live.calls.length,1);
});
