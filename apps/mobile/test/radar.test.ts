import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { RadarCoordinator } from '../src/radar-coordinator.ts';
import { RADAR_WIRE, RADAR_POLICY, DISCLOSURE_HASH, DISCLOSURE_ID, freshRadarFix, parseRadarConfig, parseRadarSnapshot, mergeRadarPlayers, RadarError } from '../src/radar.ts';
import type { RadarRead, RadarCommand, ForegroundPermission } from '../src/radar.ts';
import { createNativeApi } from '../src/native-api.ts';
import { mapPackForCity, nativeRadarMapAllowed, nativeRadarPeople, playersMapContext } from '../src/maps.ts';
const city = 'a0000000-0000-4000-8000-000000000001';
const actor = { actorId:'actor',sessionId:'native-session',generation:1 };
const disclosure = 'Включая Radar, вы временно показываете авторизованным пользователям GoBadminton своё примерное местоположение и расстояние до вас. При точной геолокации используется ячейка около 100 м, при неточной — около 1 км; точность зависит от устройства. Расстояние приблизительное, по прямой. Вы можете выключить Radar в любой момент. В фоне передача прекращается, сеанс ограничен по времени.';
const config = { exposureMode:'live', publishingV2:{enabled:true}, unifiedDirectory:{enabled:true,contractVersion:RADAR_WIRE,policyVersion:RADAR_POLICY,
  disclosure:{id:DISCLOSURE_ID,sha256:DISCLOSURE_HASH,text:disclosure}}, cities:[{cityId:city,regionId:'moscow',map:{availability:'dev_preview',mapId:'moscow',version:'moscow-20261007-p4-098a869f-v001'}}] };
const instant = (n: number) => new Date(n).toISOString();
const deferred = <T>() => { let resolve!: (value:T)=>void; const promise = new Promise<T>(r=>{resolve=r;}); return {promise,resolve}; };
const flush = () => new Promise(resolve=>setImmediate(resolve));
function fixture() {
  let now=Date.now(), serial=0;
  const activation=()=>({state:'active',ownerHere:true,contractVersion:RADAR_WIRE,policyVersion:RADAR_POLICY,activationId:'activation',version:1,regionId:'moscow',model:'regional_grid_1000m_v1',gridSizeMeters:1000,degradedReason:'source_accuracy',radiusBucketKm:5,
    startedAt:instant(now),expiresAt:instant(now+900000),hardExpiresAt:instant(now+3600000),foregroundUntil:instant(now+90000),locationValidUntil:instant(now+300000),nextLocationUpdateAt:instant(now+300000),nextRadiusChangeAt:instant(now+60000),exposureMode:'live'});
  const row=()=>({publicPlayerId:'peer',projection:'radar_public',player:{publicPlayerId:'peer',displayName:'Игрок',cityId:city,areaKey:null,level:null,bio:null,trainer:false,lookingForGame:null,avatar:{uploadedUrl:null,providerUrl:null},canRequestContact:true},
    radar:{resultId:'result',resultRef:'u1.original',consentPolicyVersion:RADAR_POLICY,validUntil:instant(now+60000),distance:null,geo:{latitude:55.75,longitude:37.62,crs:'EPSG:4326',model:'regional_grid_1000m_v1',gridSizeMeters:1000,uncertaintyMeters:1000,quality:'degraded',sourceTimestampBucket:instant(now),sourceAgeSeconds:1}}});
  const snapshot=()=>({contractVersion:RADAR_WIRE,policyVersion:RADAR_POLICY,exposureMode:'authenticated_live',cityId:city,regionId:'moscow',generatedAt:instant(now),validUntil:instant(now+60000),refreshAfterSeconds:30,
    query:{queryRef:'query-one',asOf:instant(now),ordering:'radar_distance_then_directory',originState:'authorized',originRef:'origin-ref'},totals:{matchingTotal:1,radarTotal:1,ordinaryOnlyTotal:0,completeness:'exact_at_asOf'},map:config.cities[0]!.map,
    items:[row()],page:{returnedCount:1,rankStart:1,rankEnd:1,hasMore:false,nextCursor:null}});
  const reads:RadarRead[]=[], commands:RadarCommand[]=[], phases:string[]=[];
  let permission:()=>Promise<ForegroundPermission> = async()=>({granted:true,canAskAgain:true,android:{accuracy:'coarse'}});
  let services=async()=>true, fix=async()=>({timestamp:now,coords:{latitude:55.75,longitude:37.62,accuracy:800}}), prompts=0;
  let current:unknown={state:'off',ownerHere:true};
  let read=async(operation:RadarRead):Promise<unknown>=>operation.kind==='config'?config:operation.kind==='status'?current:operation.kind==='query'?snapshot():operation.kind==='map'?{...snapshot(),page:undefined,mapPage:{returnedCount:1,rankStart:1,rankEnd:1,hasMore:false,nextMapCursor:null}}:{};
  let send=async(packet:RadarCommand):Promise<unknown>=>{current=packet.kind==='stop'?{state:'off',ownerHere:true}:activation();return current;};
  const owner=new RadarCoordinator({read:async op=>{reads.push(op);return read(op);},command:async(p,permit)=>{if(!permit())throw new RadarError('stale');commands.push(p);return send(p);},permission:()=>permission(),requestPermission:async()=>{prompts++;return permission();},services:()=>services(),fix:()=>fix(),random:()=>`key-${++serial}`,now:()=>now});
  owner.subscribe(()=>phases.push(owner.getSnapshot().phase));
  const start=async()=>{owner.setActor(actor);await flush();await owner.consent();await owner.enable(DISCLOSURE_HASH);};
  return {owner,reads,commands,phases,start,activation,snapshot,row,now:()=>now,advance:(ms:number)=>{now+=ms;},prompts:()=>prompts,
    permission:(p:typeof permission)=>{permission=p;},services:(p:typeof services)=>{services=p;},fix:(p:typeof fix)=>{fix=p;},read:(p:typeof read)=>{read=p;},send:(p:typeof send)=>{send=p;},current:(s:unknown)=>{current=s;}};
}

test('explicit enable alone owns permission/fix/start/first query loader; restore and refresh never start that loader', async t=>{
  const f=fixture();t.after(f.owner.dispose);f.owner.setActor(actor);await flush();assert.equal(f.commands.length,0);assert.equal(f.owner.getSnapshot().enabling,false);
  await f.owner.consent(); await f.owner.enable('wrong-hash');assert.equal(f.commands.length,0);
  const gate=deferred<unknown>();f.read(async op=>op.kind==='query'?gate.promise:op.kind==='config'?config:{state:'off',ownerHere:true});
  const work=f.owner.enable(DISCLOSURE_HASH);await flush();assert.equal(f.owner.getSnapshot().phase,'querying');assert.equal(f.owner.getSnapshot().enabling,true);assert.equal(f.owner.getSnapshot().approximate,true);
  assert.deepEqual(f.phases.filter(x=>['permission','locating','activating'].includes(x)).filter((x,i,a)=>i===0||x!==a[i-1]),['permission','locating','activating']);
  assert.equal(f.commands[0]!.kind,'start');const packet=f.commands[0]!;assert.ok(Object.isFrozen(packet));assert.ok('body' in packet&&Object.isFrozen(packet.body));
  gate.resolve(f.snapshot());await work;assert.equal(f.owner.getSnapshot().phase,'ready');assert.equal(f.owner.getSnapshot().enabling,false);
  const phases=f.phases.length;await f.owner.query();assert.equal(f.phases.slice(phases).includes('querying'),false);assert.equal(f.owner.getSnapshot().enabling,false);
  f.current(f.activation());await f.owner.restore();assert.equal(f.owner.getSnapshot().enabling,false);assert.equal(f.commands.filter(c=>c.kind==='start').length,1);
});

test('denied/restricted/services-off and invalid or stale fixes stop honestly, approximate fix is accepted without precision raise', async t=>{
  for(const reason of ['denied','restricted','services_off','accuracy','stale'] as const){
    const f=fixture();t.after(f.owner.dispose);
    if(reason==='denied'||reason==='restricted')f.permission(async()=>({granted:false,canAskAgain:reason==='denied'}));
    if(reason==='services_off')f.services(async()=>false);
    if(reason==='accuracy')f.fix(async()=>({timestamp:f.now(),coords:{latitude:55.75,longitude:37.62,accuracy:null as never}}));
    if(reason==='stale')f.fix(async()=>({timestamp:f.now()-31000,coords:{latitude:55.75,longitude:37.62,accuracy:500}}));
    await f.start();assert.equal(f.owner.getSnapshot().enabling,false);assert.equal(f.commands.length,0);assert.match(f.owner.getSnapshot().notice!,/город/);
    assert.equal(f.owner.getSnapshot().phase,reason==='accuracy'||reason==='stale'?'location_error':reason);assert.equal(f.prompts(),reason==='denied'?1:0);
  }
  assert.equal(freshRadarFix({timestamp:Date.now(),coords:{latitude:55,longitude:37,accuracy:900}},Date.now()).accuracyMeters,900);
});

test('disclosure hash and strict snapshot expiry/type are checked; server order overlays without hiding ordinary catalog',()=>{
  assert.equal(createHash('sha256').update(disclosure).digest('hex'),DISCLOSURE_HASH);
  assert.throws(()=>parseRadarConfig({...config,unifiedDirectory:{...config.unifiedDirectory,disclosure:{...config.unifiedDirectory.disclosure,sha256:'wrong'}}}));
  const f=fixture();const raw=f.snapshot(),snapshot=parseRadarSnapshot(raw,city,f.now());
  assert.throws(()=>parseRadarSnapshot({...raw,validUntil:instant(f.now()-1)},city,f.now()));
  assert.throws(()=>parseRadarSnapshot({...raw,items:[{...raw.items[0],radar:{...raw.items[0]!.radar,geo:{latitude:55,longitude:37,crs:'EPSG:4326',model:'raw_gps'}}}]},city,f.now()));
  const ordinary={publicPlayerId:'ordinary',displayName:'Каталог',cityId:null,areaKey:null,bio:null,level:null,trainer:false,lookingForGame:false};
  const merged=mergeRadarPlayers([ordinary],snapshot.items);assert.deepEqual(merged.ordinary,[ordinary]);assert.equal(merged.nearby[0]!.publicPlayerId,'peer');
  const intent={view:'map',cityId:city,name:'Игрок',areaKey:'sokol',looking:'1',trainer:'0'};
  assert.deepEqual(playersMapContext(intent),{view:'map',filters:{cityId:city,name:'Игрок',areaKey:'sokol',looking:true,trainer:false}});
  assert.equal(playersMapContext({...intent,resultRef:'u1.private'}),null);assert.equal(playersMapContext({...intent,cityId:['city']}),null);
  const parsed=parseRadarConfig(config),pack=mapPackForCity(city)!;
  assert.equal(nativeRadarMapAllowed(parsed,snapshot as never,city),true);assert.equal(nativeRadarPeople(snapshot.items,pack).length,1);
  assert.equal(nativeRadarMapAllowed(parsed,{...snapshot,map:{availability:'dev_preview',mapId:'moscow',version:'unsupported'}} as never,city),false);
});

test('query/map/proof refs are fenced by filters, expiry, session and background; late fix never starts publication',async t=>{
  const f=fixture();t.after(f.owner.dispose);await f.start();await f.owner.map();assert.equal(f.owner.getSnapshot().pins.length,1);
  const context=f.owner.contactContext(f.owner.getSnapshot().rows[0]!)!;assert.equal(context.valid(),true);
  f.owner.setForeground(false);assert.equal(context.valid(),false);assert.equal(f.owner.getSnapshot().rows.length,0);assert.equal(f.owner.getSnapshot().pins.length,0);await flush();assert.equal(f.commands.at(-1)!.kind,'stop');
  const late=fixture();t.after(late.owner.dispose);const fix=deferred<Awaited<ReturnType<Parameters<typeof late.fix>[0]>>>();late.fix(()=>fix.promise);
  late.owner.setActor(actor);await flush();await late.owner.consent();const enable=late.owner.enable(DISCLOSURE_HASH);await flush();late.owner.setForeground(false);
  fix.resolve({timestamp:late.now(),coords:{latitude:55,longitude:37,accuracy:100}});await enable;assert.equal(late.commands.length,0);assert.equal(late.owner.getSnapshot().enabling,false);
  const changed=fixture();t.after(changed.owner.dispose);await changed.start();const old=changed.owner.contactContext(changed.owner.getSnapshot().rows[0]!)!;
  const pending=deferred<unknown>();changed.read(async()=>pending.promise);const query=changed.owner.query();changed.owner.setFilters({cityId:city,name:'Other',areaKey:'area',looking:true,trainer:false});
  pending.resolve(changed.snapshot());await query;await flush();assert.equal(old.valid(),false);
  changed.owner.setActor({...actor,sessionId:'other-session',generation:2});assert.equal(changed.owner.getSnapshot().rows.length,0);
});

test('UNKNOWN retains immutable command/key; status read cannot fabricate a receipt or resend; takeover is explicitly confirmed',async t=>{
  const f=fixture();t.after(f.owner.dispose);f.send(async()=>{throw Error('timeout');});await f.start();const packet=f.owner.getSnapshot().command!;
  assert.equal(f.owner.getSnapshot().phase,'unknown');f.current(f.activation());await f.owner.restore();assert.strictEqual(f.owner.getSnapshot().command,packet);assert.equal(f.commands.length,1);assert.equal(f.owner.getSnapshot().enabling,false);
  const other=fixture();t.after(other.owner.dispose);other.current({...other.activation(),state:'owned_elsewhere',ownerHere:false});other.owner.setActor(actor);await flush();await other.owner.consent();await other.owner.enable(DISCLOSURE_HASH);assert.equal(other.commands.length,0);
  await other.owner.enable(DISCLOSURE_HASH,true);assert.equal(other.commands[0]!.kind,'takeover');assert.equal(other.owner.getSnapshot().phase,'ready');
  other.advance(90001);await other.owner.tick();assert.equal(other.owner.getSnapshot().phase,'expired');assert.equal(other.owner.getSnapshot().rows.length,0);
});

test('NativeApi closes selected transports: preview key, owning DELETE header and no cookie/Origin; plugin remains foreground only',async()=>{
  const requests:{path:string;init:RequestInit}[]=[];const api=createNativeApi(async(url,init)=>{requests.push({path:String(url),init:init!});return new Response(null,{status:204});});
  await api.radarRead('token',{kind:'preview',target:'peer',resultRef:'u1.original'},'read-key');
  await api.radarCommand('token',{kind:'stop',actor,key:'stop-key',activationId:'owned-id'});
  assert.deepEqual(JSON.parse(requests[0]!.init.body as string),{resultRef:'u1.original'});
  const headers=requests[1]!.init.headers as Record<string,string>;assert.equal(headers['X-Radar-Activation-Id'],'owned-id');assert.equal(headers['Idempotency-Key'],'stop-key');assert.equal(headers.Cookie,undefined);assert.equal(headers.Origin,undefined);
  const app=JSON.parse(readFileSync(new URL('../app.json',import.meta.url),'utf8')).expo;
  const plugin=app.plugins.find((p:unknown)=>Array.isArray(p)&&p[0]==='expo-location')[1];
  for(const key of ['locationAlwaysPermission','locationAlwaysAndWhenInUsePermission','motionUsagePermission','locationFullAccuracyPermission','isIosBackgroundLocationEnabled','isAndroidBackgroundLocationEnabled','isAndroidForegroundServiceEnabled','isAndroidMotionActivityEnabled'])assert.equal(plugin[key],false);
  assert.equal(app.android.versionCode,8);
  assert.equal(JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8')).dependencies['expo-location'],'58.0.22');
});
