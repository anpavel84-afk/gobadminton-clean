import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL as NodeURL } from 'node:url';
import { createHash } from 'node:crypto';
import { PlayersCoordinator, PlayersError } from '../src/players.ts';
import type { PlayersSnapshot } from '../src/players.ts';
import { RadarCoordinator } from '../src/radar-coordinator.ts';
import { ContactCoordinator } from '../src/contact-coordinator.ts';
import { RADAR_WIRE, RADAR_POLICY, DISCLOSURE_HASH, DISCLOSURE_ID, freshRadarFix, parseRadarConfig, parseRadarStatus, parseRadarSnapshot, mergeRadarPlayers, RadarError } from '../src/radar.ts';
import type { RadarSnapshot } from '../src/radar-coordinator.ts';
import type { RadarContactContext } from '../src/contact.ts';
import type { UnifiedRow, UnifiedPreview, UnifiedActivation } from '../src/radar.ts';
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
  const activation=(): UnifiedActivation=>({state:'active',ownerHere:true,contractVersion:RADAR_WIRE,policyVersion:RADAR_POLICY,activationId:'activation',version:1,regionId:'moscow',model:'regional_grid_1000m_v1',gridSizeMeters:1000,degradedReason:'source_accuracy',radiusBucketKm:5,
    startedAt:instant(now),expiresAt:instant(now+900000),hardExpiresAt:instant(now+3600000),foregroundUntil:instant(now+90000),locationValidUntil:instant(now+300000),nextLocationUpdateAt:instant(now+300000),nextRadiusChangeAt:instant(now+60000),exposureMode:'live'});
  const row=()=>({publicPlayerId:'peer',projection:'radar_public',player:{publicPlayerId:'peer',displayName:'Игрок',cityId:city,areaKey:null,level:null,bio:null,trainer:false,lookingForGame:null,avatar:{uploadedUrl:null,providerUrl:null},canRequestContact:true},
    radar:{resultId:'result',resultRef:'u1.original',consentPolicyVersion:RADAR_POLICY,validUntil:instant(now+60000),distance:null,geo:{latitude:55.75,longitude:37.62,crs:'EPSG:4326',model:'regional_grid_1000m_v1',gridSizeMeters:1000,uncertaintyMeters:1000,quality:'degraded',sourceTimestampBucket:instant(now),sourceAgeSeconds:1}}});
  const snapshot=()=>({contractVersion:RADAR_WIRE,policyVersion:RADAR_POLICY,exposureMode:'authenticated_live',cityId:city,regionId:'moscow',generatedAt:instant(now),validUntil:instant(now+60000),refreshAfterSeconds:30,
    query:{queryRef:'query-one',asOf:instant(now),ordering:'radar_distance_then_directory',originState:'authorized',originRef:'origin-ref'},totals:{matchingTotal:1,radarTotal:1,ordinaryOnlyTotal:0,completeness:'exact_at_asOf'},map:config.cities[0]!.map,
    items:[row()],page:{returnedCount:1,rankStart:1,rankEnd:1,hasMore:false,nextCursor:null}});
  const reads:RadarRead[]=[], commands:RadarCommand[]=[], phases:string[]=[], permits:(()=>boolean)[]=[], readActors:typeof actor[]=[];
  let beforeDispatch = async (_packet:RadarCommand) => {};
  let permission:()=>Promise<ForegroundPermission> = async()=>({granted:true,canAskAgain:true,android:{accuracy:'coarse'}});
  let services=async()=>true, fix=async()=>({timestamp:now,coords:{latitude:55.75,longitude:37.62,accuracy:800}}), prompts=0;
  let current:unknown={state:'off',ownerHere:true};
  let read=async(operation:RadarRead):Promise<unknown>=>operation.kind==='config'?config:operation.kind==='status'?current:operation.kind==='query'?snapshot():operation.kind==='map'?{...snapshot(),page:undefined,mapPage:{returnedCount:1,rankStart:1,rankEnd:1,hasMore:false,nextMapCursor:null}}:{};
  let send=async(packet:RadarCommand):Promise<unknown>=>{current=packet.kind==='stop'?{state:'off',ownerHere:true}:activation();return current;};
  const owner=new RadarCoordinator({read:async(op,a)=>{reads.push(op);readActors.push(a);return read(op);},command:async(p,permit)=>{permits.push(permit);await beforeDispatch(p);if(!permit())throw new RadarError('stale');commands.push(p);return send(p);},permission:()=>permission(),requestPermission:async()=>{prompts++;return permission();},services:()=>services(),fix:()=>fix(),random:()=>`key-${++serial}`,now:()=>now});
  owner.subscribe(()=>phases.push(owner.getSnapshot().phase));
  const start=async()=>{owner.setActor(actor);await flush();await owner.consent();await owner.enable(DISCLOSURE_HASH);};
  return {owner,reads,commands,phases,permits,readActors,start,activation,snapshot,row,now:()=>now,advance:(ms:number)=>{now+=ms;},prompts:()=>prompts,beforeDispatch:(p:typeof beforeDispatch)=>{beforeDispatch=p;},
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
  const invalidState:unknown={...f.activation(),state:'invalid'};
  const invalidModel:unknown={...f.activation(),model:'raw_gps'};
  assert.throws(()=>parseRadarStatus(invalidState));assert.throws(()=>parseRadarStatus(invalidModel));
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
  const app=JSON.parse(readFileSync(new NodeURL('../app.json',import.meta.url),'utf8')).expo;
  const plugin=app.plugins.find((p:unknown)=>Array.isArray(p)&&p[0]==='expo-location')[1];
  for(const key of ['locationAlwaysPermission','locationAlwaysAndWhenInUsePermission','motionUsagePermission','locationFullAccuracyPermission','isIosBackgroundLocationEnabled','isAndroidBackgroundLocationEnabled','isAndroidForegroundServiceEnabled','isAndroidMotionActivityEnabled'])assert.equal(plugin[key],false);
  assert.equal(app.android.versionCode,43);
  assert.equal(JSON.parse(readFileSync(new NodeURL('../package.json',import.meta.url),'utf8')).dependencies['expo-location'],'58.0.22');
});

// Execute the owning UI projections/callbacks. This is not native mount/fit evidence.
async function uiFunctions() {
  const {stripTypeScriptTypes} = await import('node:module');
  const {runInNewContext} = await import('node:vm');
  const controls = readFileSync(new NodeURL('../src/components/radar-controls.tsx',import.meta.url),'utf8');
  const players = readFileSync(new NodeURL('../app/players/index.tsx',import.meta.url),'utf8');
  const {activationDeadline,parseRadarPreview} = await import('../src/radar.ts');
  const source = controls.slice(controls.indexOf('export function radarControlPresentation'),controls.indexOf('export function RadarControls')).replace('export function','function');
  const helpers = players.slice(players.indexOf('export async function loadPlayerInspection'),players.indexOf('export default function Players')).replaceAll('export ','');
  return {controls,players,stripTypeScriptTypes,runInNewContext,
    presentation: runInNewContext(stripTypeScriptTypes(`${source}\nradarControlPresentation;`),{activationDeadline}) as
      (state: RadarSnapshot,now:number)=>{active:boolean;running:boolean;tone:string;progress:number;remaining:string},
    helpers: runInNewContext(stripTypeScriptTypes(`${helpers}\n({loadPlayerInspection,loadExpandedPlayerInspection,radarContactAvailable,playerDistance});`),{parseRadarPreview}) as {
      loadPlayerInspection:(context: RadarContactContext,read:(operation:RadarRead,scope:typeof actor)=>Promise<unknown>,now:()=>number)=>Promise<UnifiedPreview>;
      loadExpandedPlayerInspection:(coordinator:PlayersCoordinator,context:RadarContactContext,preview:UnifiedPreview,current:()=>boolean,now?:()=>number)=>Promise<PlayersSnapshot['detail']>;
      radarContactAvailable:(row:UnifiedRow,preview:UnifiedPreview|null,now?:number)=>boolean;
      playerDistance:(preview:UnifiedPreview)=>string;
    }};
}

test('actual control shows finite confirmed session progress/ownership and attention; UI timer cannot enable or renew',async t=>{
  const {presentation,controls,players}=await uiFunctions();const f=fixture();t.after(f.owner.dispose);await f.start();
  const state=f.owner.getSnapshot(), full=presentation(state,f.now());
  assert.equal(full.active,true);assert.equal(full.progress,1);assert.equal(full.remaining,'15:00');
  const halfway=presentation({...state,activation:{...f.activation(),foregroundUntil:instant(f.now()+600000),locationValidUntil:instant(f.now()+600000)}},f.now()+450000);
  assert.equal(halfway.progress,0.5);assert.equal(halfway.remaining,'7:30');assert.equal(halfway.tone,'attention');
  for(const activation of [{...f.activation(),ownerHere:false},{...f.activation(),expiresAt:'invalid'},{...f.activation(),startedAt:'invalid'},
    {...f.activation(),startedAt:instant(f.now()+1)},{...f.activation(),expiresAt:instant(f.now())}]){
    const result=presentation({...state,activation},f.now());assert.equal(result.active,false);assert.equal(result.progress,0);assert.ok(Number.isFinite(result.progress));
  }
  assert.equal(presentation({...state,actor:null},f.now()).active,false);
  assert.equal(presentation({...state,phase:'restoring'},f.now()).progress,0);
  assert.equal(presentation({...state,phase:'unknown'},f.now()).tone,'attention');
  assert.equal(presentation({...state,phase:'owned_elsewhere',activation:{...f.activation(),state:'owned_elsewhere',ownerHere:false}},f.now()).active,false);
  assert.match(controls,/strokeDashoffset=\{2\*Math.PI\*21\*\(1-presentation.progress\)\}/);
  assert.match(controls,/presentation.tone === 'active' \? colors.limeSoft/);assert.doesNotMatch(controls,/\bLoading\b/);
  assert.match(players,/radarState.enabling && <Label accessible accessibilityLiveRegion="polite">Сейчас ищем ближайших игроков…/);
  const timer=controls.slice(controls.indexOf('  useEffect('),controls.indexOf('  const presentation ='));
  assert.match(timer,/setInterval\(\(\) => setNow\(Date.now\(\)\),1000\)/);assert.doesNotMatch(timer,/owner\.|Location\.|enable\(|renew\(/);
});

test('inspection redeems exact proof for a contact-denied peer and validates identity/expiry/retired context',async t=>{
  const {helpers}=await uiFunctions();const f=fixture();t.after(f.owner.dispose);await f.start();
  const row=f.owner.getSnapshot().rows[0]!, context=f.owner.contactContext(row)!;
  const raw={player:{...row.player,canRequestContact:false},proximityBand:null,radar:row.radar,upcomingGames:[]};
  const calls:RadarRead[]=[];
  const preview=await helpers.loadPlayerInspection(context,async operation=>{calls.push(operation);return raw;},f.now);
  assert.equal(preview.player.canRequestContact,false);assert.equal(helpers.radarContactAvailable(row,preview,f.now()),false);
  assert.equal(calls.length,1);const call=calls[0];assert.ok(call);assert.equal(call.kind,'preview');
  if(call.kind==='preview'){assert.equal(call.resultRef,context.resultRef);assert.equal(call.target,row.publicPlayerId);}
  assert.equal(helpers.radarContactAvailable({...row,player:{...row.player,canRequestContact:false}},null,f.now()),false);
  const positive={...preview,player:{...preview.player,canRequestContact:true}};
  assert.equal(helpers.radarContactAvailable(row,positive,f.now()),true);
  assert.equal(helpers.radarContactAvailable(row,{...positive,radar:{...positive.radar,validUntil:instant(f.now())}},f.now()),false);
  assert.equal(helpers.radarContactAvailable(row,{...positive,player:{...positive.player,publicPlayerId:'other'}},f.now()),false);
  assert.match(helpers.playerDistance(preview),/примерное местоположение/);
  await assert.rejects(helpers.loadPlayerInspection(context,async()=>({...raw,player:{...raw.player,publicPlayerId:'other'}}),f.now));
  await assert.rejects(helpers.loadPlayerInspection(context,async()=>({...raw,radar:{...row.radar,validUntil:instant(f.now()-1)}}),f.now));
  const pending=deferred<unknown>(),work=helpers.loadPlayerInspection(context,()=>pending.promise,f.now);
  f.owner.setForeground(false);pending.resolve(raw);await assert.rejects(work);
});

test('actual contact handler gates row and fresh preview and opens explicit composer only for a current view',async()=>{
  const {helpers,players,stripTypeScriptTypes,runInNewContext}=await uiFunctions();const f=fixture();
  const row=parseRadarSnapshot(f.snapshot(),city,f.now()).items[0]!;
  let valid=true,allowed=true,staged=0,pushed=0,previewed=0,wait=false;
  const focusedRef={current:true},contactView={current:1},context={valid:()=>valid},gate=deferred<void>();
  const source=players.slice(players.indexOf('  const contact ='),players.indexOf('  const list ='))+'\ncontact;';
  const contact=runInNewContext(stripTypeScriptTypes(source),{focusedRef,contactView,radarContactAvailable:helpers.radarContactAvailable,inspection:null,
    radar:{contactContext:()=>context,preview:async()=>{previewed++;if(wait)await gate.promise;if(!allowed)throw Error('denied');}},
    auth:{contact:{stageRadar:()=>{staged++;return true;}}},router:{push:()=>pushed++},selectPerson:()=>{}}) as (value:typeof row)=>Promise<void>;
  await contact({...row,player:{...row.player,canRequestContact:false}});assert.equal(previewed,0);
  allowed=false;await contact(row);assert.equal(staged,0);assert.equal(pushed,0);
  allowed=true;await contact(row);assert.equal(staged,1);assert.equal(pushed,1);
  wait=true;const work=contact(row);contactView.current++;gate.resolve();await work;assert.equal(staged,1);
  valid=false;await contact(row);assert.equal(staged,1);focusedRef.current=false;await contact(row);assert.equal(staged,1);
  assert.match(players,/onPress=\{\(\) => selectPerson\(row\)\}/);
  assert.match(players,/people=\{people\} selectedPerson=\{person\?\.publicPlayerId \?\? null\} onPerson=\{selectPerson\}/);
  assert.equal((players.match(/radarContactAvailable\((row|person),/g) ?? []).length,3);
  assert.doesNotMatch(players,/publicApi\.player|coordinator\.rereadSafety/);
  assert.match(players,/coordinator\.loadDetail\(target,true\)/);
});


test('compact Radar remains a 48 by 48 glyph with accessible status; only expanded inspection composes profile and contact',async()=>{
  const {controls,players}=await uiFunctions();
  const compact=controls.slice(controls.indexOf('{compact ?'),controls.indexOf('</Pressable> : <View'));
  assert.match(compact,/width:48,height:48/);assert.match(compact,/accessibilityLabel=.*presentation.caption/);
  assert.match(compact,/\{glyph\}/);assert.doesNotMatch(compact,/<Label|maxWidth:110|fontSize:10/);
  assert.match(controls,/Включить Radar/);
  assert.match(controls,/Radar включён/);
  const content=players.slice(players.indexOf('  const personContent ='),players.indexOf('  return <ScreenFrame'));
  const expansion=content.indexOf('{expanded && <>');
  assert.ok(expansion>0);assert.match(content.slice(0,expansion),/PlayerAvatar/);
  assert.doesNotMatch(content.slice(0,expansion),/PrimaryButton|TextButton|PlayerProfile/);
  assert.match(content.slice(expansion),/<PlayerProfile/);assert.match(content.slice(expansion),/radarContactAvailable\(person,preview\)/);
  assert.doesNotMatch(content,/Закрыть игрока|Здесь показана доступная информация/);
  assert.match(players,/expanded && person && preview && safeInspection/);
  assert.match(players,/snapshot.detail === profileResult.detail/);
});

test('fresh expanded inspection uses genuine scoped detail reader; hidden 404 isolates detail and preserves exact ordinary catalog',async t=>{
  const {helpers}=await uiFunctions();const f=fixture();t.after(f.owner.dispose);await f.start();
  const row=f.owner.getSnapshot().rows[0]!,context=f.owner.contactContext(row)!;
  const preview=await helpers.loadPlayerInspection(context,async()=>({player:{...row.player,canRequestContact:false},proximityBand:null,radar:row.radar,upcomingGames:[]}),f.now);
  const players=new PlayersCoordinator(),ordinary={...row.player,publicPlayerId:'ordinary',bio:'Каталог',lookingForGame:false};
  const filters={cityId:city,name:'',looking:false,trainer:false};
  let unavailable=false;const calls:string[]=[];
  const profile={...row.player,bio:'Авторизованная биография',areaKey:'sokol',lookingForGame:false};
  players.setScope(`native:${actor.actorId}:${actor.sessionId}:${actor.generation}`,{
    list:async()=>({items:[ordinary],nextCursor:null}),
    detail:async id=>{calls.push(id);if(unavailable)throw new PlayersError('unavailable',404);return profile;},
  });
  await players.loadList(filters);const list=players.getSnapshot().list;
  const detail=await helpers.loadExpandedPlayerInspection(players,context,preview,()=>true,f.now);
  assert.equal(detail.status,'ready');assert.strictEqual(detail.data,profile);assert.strictEqual(players.getSnapshot().list,list);
  // The real loadDetail(peer,true) keeps all auth/target fences and only isolates 404's catalog clearing.
  unavailable=true;const hidden=await helpers.loadExpandedPlayerInspection(players,context,preview,()=>true,f.now);
  assert.equal(hidden.status,'error');assert.equal(hidden.data,null);assert.equal(players.getSnapshot().detail.data,null);
  assert.ok(hidden.error instanceof PlayersError);assert.equal(hidden.error.status,404);
  assert.strictEqual(players.getSnapshot().list,list);assert.strictEqual(players.getSnapshot().list.data?.items[0],ordinary);
  assert.deepEqual(calls,['peer','peer']);assert.equal(helpers.radarContactAvailable(row,preview,f.now()),false);
  assert.equal(f.commands.length,1);assert.equal(f.commands[0]?.kind,'start');
  await players.loadList(filters);assert.equal(players.getSnapshot().list.status,'ready');assert.deepEqual(players.getSnapshot().list.data?.items,[ordinary]);
});

test('expanded detail rejects selection retirement, scope generation changes and competing detail ownership without cached fallback',async t=>{
  const {helpers}=await uiFunctions();const f=fixture();t.after(f.owner.dispose);await f.start();
  const row=f.owner.getSnapshot().rows[0]!,context=f.owner.contactContext(row)!;
  const preview=await helpers.loadPlayerInspection(context,async()=>({player:row.player,proximityBand:null,radar:row.radar,upcomingGames:[]}),f.now);
  const scope=`native:${actor.actorId}:${actor.sessionId}:${actor.generation}`;
  const players=new PlayersCoordinator();const profile={...row.player,bio:'Authorized',lookingForGame:false};
  let gate=deferred<typeof profile>(),current=true;
  const reader={list:async()=>({items:[profile],nextCursor:null}),detail:()=>gate.promise};players.setScope(scope,reader);
  const retired=helpers.loadExpandedPlayerInspection(players,context,preview,()=>current,f.now);
  current=false;gate.resolve(profile);await assert.rejects(retired,/Retired/);
  current=true;gate=deferred<typeof profile>();
  const actorChanged=helpers.loadExpandedPlayerInspection(players,context,preview,()=>current,f.now);
  players.setScope(`${scope}-next-generation`,reader);gate.resolve(profile);await assert.rejects(actorChanged,/Retired/);
  assert.equal(players.getSnapshot().detail.data,null);
  await assert.rejects(helpers.loadExpandedPlayerInspection(players,context,preview,()=>true,f.now),/Retired/);
  players.setScope(scope,reader);gate=deferred<typeof profile>();
  const competing=helpers.loadExpandedPlayerInspection(players,context,preview,()=>true,f.now);
  const other=players.loadDetail('other',true);gate.resolve({...profile,publicPlayerId:'other'});await other;
  await assert.rejects(competing,/Retired/);assert.equal(players.getSnapshot().detail.id,'other');
  gate=deferred<typeof profile>();
  const wrongTarget=helpers.loadExpandedPlayerInspection(players,context,preview,()=>true,f.now);
  gate.resolve({...profile,publicPlayerId:'wrong-target'});const wrong=await wrongTarget;
  assert.equal(wrong.status,'error');assert.equal(wrong.data,null);assert.equal(players.getSnapshot().detail.data,null);
  gate=deferred<typeof profile>();
  const expired=helpers.loadExpandedPlayerInspection(players,context,preview,()=>true,f.now);
  f.advance(60001);gate.resolve(profile);await assert.rejects(expired,/Retired/);
  assert.equal(f.commands.filter(command=>command.kind==='start').length,1);
});

// Execute the actual native close handler against the real coordinator; no native render claim.
async function nativeClose(owner: RadarCoordinator) {
  const {controls,stripTypeScriptTypes,runInNewContext}=await uiFunctions();
  const start=controls.indexOf('  const close ='),end=controls.indexOf('  return <>',start);
  assert.ok(start>=0 && end>start);
  assert.match(controls,/<Modal visible=\{open\} onRequestClose=\{close\}/);
  assert.match(controls,/accessibilityLabel="Закрыть"/);
  assert.match(controls,/<DiscoveryIcon name="close"/);
  assert.doesNotMatch(controls,/<TextButton title="Закрыть"/);
  let open=true,accepted=true;
  const close=runInNewContext(stripTypeScriptTypes(controls.slice(start,end)+'\nclose;'),{
    owner,state:owner.getSnapshot(),setOpen:(value:boolean)=>{open=value;},setAccepted:(value:boolean)=>{accepted=value;},
  }) as ()=>void;
  close();assert.equal(open,false);assert.equal(accepted,false);
}

test('actual native close cancels deferred start into safety DELETE; only cleanup ACK confirms off and fresh consent permits enable',async t=>{
  const f=fixture();t.after(f.owner.dispose);
  const startAck=deferred<unknown>(),stopAck=deferred<unknown>();
  f.send(p=>p.kind==='start'?startAck.promise:stopAck.promise);
  const work=f.start();await flush();
  const original=f.owner.getSnapshot().command!,bytes=JSON.stringify(original);
  assert.equal(original.kind,'start');assert.equal(f.owner.getSnapshot().enabling,true);
  assert.ok(Object.isFrozen(original));assert.ok(Object.isFrozen(original.actor));
  if(original.kind==='start'){assert.ok(Object.isFrozen(original.body));assert.ok(Object.isFrozen(original.body.consent));}
  const phaseIndex=f.phases.length;
  await nativeClose(f.owner);await flush();
  assert.strictEqual(f.owner.getSnapshot().command,original);assert.equal(f.owner.getSnapshot().phase,'unknown');
  assert.match(f.owner.getSnapshot().notice!,/ожидает подтверждения/);
  assert.equal(f.owner.getSnapshot().enabling,false);assert.equal(f.commands.length,1);
  startAck.resolve(f.activation());await flush();
  assert.deepEqual(f.commands.map(p=>p.kind),['start','stop']);
  const cleanup=f.commands[1]!;
  assert.deepEqual(cleanup,{kind:'stop',actor,key:'key-2',activationId:'activation'});
  assert.ok(Object.isFrozen(cleanup));assert.ok(Object.isFrozen(cleanup.actor));
  assert.equal(f.owner.getSnapshot().command,null);assert.equal(f.owner.getSnapshot().activation?.state,'active');
  assert.equal(f.owner.getSnapshot().phase,'unknown');assert.match(f.owner.getSnapshot().notice!,/ожидает подтверждения/);
  assert.equal(f.phases.slice(phaseIndex).includes('off'),false);
  assert.equal(f.owner.getSnapshot().pins.length,0);assert.equal(f.owner.getSnapshot().rows.length,0);assert.equal(f.owner.getSnapshot().query,null);
  await f.owner.enable(DISCLOSURE_HASH);await f.owner.query();await f.owner.map();await f.owner.tick();
  assert.equal(f.commands.length,2);assert.equal(f.reads.filter(op=>op.kind==='query'||op.kind==='map').length,0);
  f.current({state:'off',ownerHere:false});stopAck.resolve({state:'off',ownerHere:false});await work;
  assert.equal(f.owner.getSnapshot().phase,'off');assert.equal(f.owner.getSnapshot().activation?.state,'off');
  assert.equal(f.owner.getSnapshot().command,null);assert.equal(f.owner.getSnapshot().notice,null);
  await f.owner.restore();await f.owner.enable(DISCLOSURE_HASH);assert.equal(f.commands.length,2);
  await f.owner.consent();assert.equal(f.owner.getSnapshot().phase,'consent');
  f.send(async()=>f.activation());await f.owner.enable(DISCLOSURE_HASH);
  assert.equal(f.owner.getSnapshot().phase,'ready');assert.equal(f.commands.length,3);
  assert.equal(f.commands[2]!.kind,'start');assert.notEqual(f.commands[2]!.key,original.key);
  assert.equal(f.commands.filter(p=>p===original).length,1);assert.equal(JSON.stringify(original),bytes);
  assert.ok(f.readActors.every(a=>JSON.stringify(a)===JSON.stringify(actor)));
});

test('cancel of owned publication clears real private context immediately; failed cleanup retries the exact frozen DELETE',async t=>{
  const f=fixture();t.after(f.owner.dispose);await f.start();await f.owner.map();
  const context=f.owner.contactContext(f.owner.getSnapshot().pins[0]!)!;
  const ordinary=[{...f.row().player,publicPlayerId:'ordinary',lookingForGame:false}],merged=mergeRadarPlayers(ordinary,f.owner.getSnapshot().rows);
  const gate=deferred<unknown>();let fail=true;
  f.send(async()=>{if(fail)throw Error('cleanup response lost');return gate.promise;});
  f.owner.cancel();
  assert.equal(f.owner.getSnapshot().pins.length,0);assert.equal(f.owner.getSnapshot().rows.length,0);
  assert.equal(f.owner.getSnapshot().query,null);assert.equal(context.valid(),false);
  assert.strictEqual(mergeRadarPlayers(ordinary,[]).ordinary[0],ordinary[0]);assert.strictEqual(merged.ordinary[0],ordinary[0]);
  await flush();const cleanup=f.commands[1]!,bytes=JSON.stringify(cleanup);
  assert.equal(cleanup.kind,'stop');assert.equal(f.owner.getSnapshot().command,null);
  assert.equal(f.owner.getSnapshot().phase,'unknown');assert.match(f.owner.getSnapshot().notice!,/ожидает подтверждения/);
  assert.equal(f.owner.getSnapshot().activation?.state,'active');
  fail=false;const retry=f.owner.stop();await flush();
  assert.equal(f.commands.length,3);assert.strictEqual(f.commands[2],cleanup);
  assert.equal(JSON.stringify(cleanup),bytes);assert.equal(f.owner.getSnapshot().phase,'unknown');
  gate.resolve({state:'off',ownerHere:false});await retry;
  assert.equal(f.owner.getSnapshot().phase,'off');assert.equal(f.owner.getSnapshot().activation?.state,'off');
  assert.equal(context.valid(),false);assert.equal(f.reads.filter(op=>op.kind==='query').length,1);
});

test('native close with lost start response retains original UNKNOWN through status discovery and cleanup ACK without replay',async t=>{
  const f=fixture();t.after(f.owner.dispose);const lost=deferred<void>();
  f.send(async p=>{if(p.kind==='start'){await lost.promise;throw Error('lost response');}return {state:'off',ownerHere:false};});
  const work=f.start();await flush();const original=f.owner.getSnapshot().command!,bytes=JSON.stringify(original);
  await nativeClose(f.owner);await flush();assert.equal(f.commands.length,1);
  lost.resolve();await work;assert.strictEqual(f.owner.getSnapshot().command,original);
  f.current(f.activation());await f.owner.restore();
  assert.deepEqual(f.commands.map(p=>p.kind),['start','stop']);
  assert.equal(f.owner.getSnapshot().activation?.state,'off');assert.equal(f.owner.getSnapshot().phase,'unknown');
  assert.strictEqual(f.owner.getSnapshot().command,original);
  await f.owner.restore();await f.owner.consent();await f.owner.enable(DISCLOSURE_HASH);await f.owner.query();await f.owner.tick();
  assert.equal(f.commands.length,2);assert.strictEqual(f.owner.getSnapshot().command,original);
  assert.equal(JSON.stringify(original),bytes);assert.equal(f.reads.filter(op=>op.kind==='query').length,0);
  assert.equal(f.owner.getSnapshot().pins.length,0);assert.equal(f.owner.getSnapshot().query,null);
});

test('native cancel cleanup discovery and old start ACK cannot cross actor/session rotation or consume the new command',async t=>{
  for(const replacement of [{...actor,sessionId:'rotated',generation:2},{actorId:'other-account',sessionId:'other',generation:2}]){
    const f=fixture();t.after(f.owner.dispose);
    const oldAck=deferred<unknown>(),oldStatus=deferred<unknown>(),newAck=deferred<unknown>();
    f.send(p=>p.actor.sessionId===actor.sessionId?oldAck.promise:newAck.promise);
    const work=f.start();await flush();const original=f.owner.getSnapshot().command!;
    f.read(async op=>op.kind==='config'?config:oldStatus.promise);
    await nativeClose(f.owner);await flush();
    f.read(async op=>op.kind==='config'?config:op.kind==='query'?f.snapshot():{state:'off',ownerHere:false});
    f.owner.setActor(replacement);await flush();await f.owner.consent();
    const next=f.owner.enable(DISCLOSURE_HASH);await flush();const current=f.owner.getSnapshot();
    assert.ok(current.command);assert.notStrictEqual(current.command,original);assert.deepEqual(current.command.actor,replacement);
    oldAck.resolve(f.activation());oldStatus.resolve(f.activation());await work;await flush();
    assert.strictEqual(f.owner.getSnapshot(),current);assert.equal(f.commands.length,2);
    assert.equal(f.permits[0]!(),false);assert.equal(f.commands.some(p=>p.kind==='stop'),false);
    assert.equal(current.pins.length,0);assert.equal(current.query,null);
    newAck.resolve(f.activation());await next;
    assert.equal(f.owner.getSnapshot().command,null);assert.equal(f.owner.getSnapshot().phase,'ready');
    assert.deepEqual(f.owner.getSnapshot().actor,replacement);
  }
});

// FIRST CodeQA cd791: real owner, controllable transport boundaries.
for (const kind of ['start','update','heartbeat','stop'] as const) test(`actual late ${kind} ACK settles its exact command; confirmed cleanup permits only fresh explicit reentry`,async t=>{
  const f=fixture();t.after(f.owner.dispose);
  let oldContext:RadarContactContext|null=null;
  if(kind!=='start'){
    await f.start();await f.owner.map();assert.equal(f.owner.getSnapshot().pins.length,1);
    oldContext=f.owner.contactContext(f.owner.getSnapshot().pins[0]!)!;
  }
  const originalAck=deferred<unknown>(),cleanupAck=deferred<unknown>();
  f.send(async packet=>packet.kind===kind?originalAck.promise:cleanupAck.promise);
  const work=kind==='start'?f.start():kind==='update'?f.owner.change('update',10):kind==='stop'?f.owner.stop():(()=>{f.advance(45001);return f.owner.tick();})();
  await flush();const original=f.owner.getSnapshot().command!;assert.equal(original.kind,kind);
  const bytes=JSON.stringify(original),queries=f.reads.filter(op=>op.kind==='query').length;
  f.owner.setForeground(false);await flush();
  assert.equal(f.owner.getSnapshot().pins.length,0);assert.equal(f.owner.getSnapshot().rows.length,0);
  assert.equal(f.owner.getSnapshot().enabling,false);assert.strictEqual(f.owner.getSnapshot().command,original);
  // Discovery GET and even an in-flight cleanup cannot acknowledge the original mutation.
  assert.equal(f.owner.getSnapshot().phase,'unknown');assert.equal(oldContext?.valid()??false,false);
  originalAck.resolve(kind==='stop'?{state:'off',ownerHere:false}:{...f.activation(),version:2});await flush();
  assert.equal(f.owner.getSnapshot().command,null);
  assert.equal(f.commands.filter(p=>p.kind===kind).length,1);
  const stops=f.commands.filter(p=>p.kind==='stop');assert.equal(stops.length,1);
  if(kind==='stop')assert.strictEqual(stops[0],original);
  else {
    assert.deepEqual(stops[0],{kind:'stop',actor,key:kind==='start'?'key-2':'key-3',activationId:'activation'});
    assert.notEqual(stops[0]!.key,original.key);
    assert.equal(f.owner.getSnapshot().phase,'unknown');assert.match(f.owner.getSnapshot().notice!,/ожидает подтверждения/);
  }
  assert.ok(Object.isFrozen(stops[0]));assert.ok(Object.isFrozen(stops[0]!.actor));
  f.current({state:'off',ownerHere:false});cleanupAck.resolve({state:'off',ownerHere:false});await work;await flush();
  assert.equal(JSON.stringify(original),bytes);assert.equal(f.owner.getSnapshot().activation?.state,'off');
  assert.equal(f.owner.getSnapshot().command,null);assert.equal(f.owner.getSnapshot().phase,'off');assert.equal(f.owner.getSnapshot().notice,null);
  const writes=kind==='start'?2:kind==='stop'?2:3;assert.equal(f.commands.length,writes);
  f.owner.setForeground(true);await flush();await f.owner.restore();await f.owner.stop();
  await f.owner.query();await f.owner.change('update',10);await f.owner.tick();await f.owner.enable(DISCLOSURE_HASH);
  assert.equal(f.commands.length,writes);assert.equal(f.reads.filter(op=>op.kind==='query').length,queries);
  assert.equal(f.owner.getSnapshot().pins.length,0);assert.equal(f.owner.getSnapshot().rows.length,0);
  assert.equal(f.owner.getSnapshot().query,null);assert.equal(f.owner.getSnapshot().command,null);
  assert.equal(f.owner.getSnapshot().phase,'off');assert.equal(f.owner.getSnapshot().busy,false);assert.equal(f.owner.getSnapshot().enabling,false);
  assert.ok(f.readActors.every(a=>JSON.stringify(a)===JSON.stringify(actor)));
  // The settled safety intent must not strand consent/enable, nor replay any old packet.
  await f.owner.consent();assert.equal(f.owner.getSnapshot().phase,'consent');assert.equal(f.commands.length,writes);
  f.send(async()=>{const active=f.activation();f.current(active);return active;});
  await f.owner.enable(DISCLOSURE_HASH);assert.equal(f.owner.getSnapshot().phase,'ready');
  assert.equal(f.commands.length,writes+1);const next=f.commands.at(-1)!;assert.equal(next.kind,'start');
  assert.ok(f.commands.slice(0,-1).every(p=>p.key!==next.key));assert.notStrictEqual(next,original);
  assert.equal(f.commands.filter(p=>p===original).length,1);assert.equal(JSON.stringify(original),bytes);
  assert.equal(oldContext?.valid()??false,false);assert.equal(f.owner.getSnapshot().pins.length,0);
});

test('lost start response is discovered by bounded current status; GET and cleanup never acknowledge or replay original UNKNOWN',async t=>{
  const f=fixture();t.after(f.owner.dispose);
  f.send(async packet=>{if(packet.kind==='start'){f.current(f.activation());throw Error('response lost');}return {state:'off',ownerHere:false};});
  await f.start();const original=f.owner.getSnapshot().command!,bytes=JSON.stringify(original);
  const statusReads=f.reads.filter(op=>op.kind==='status').length;
  f.owner.setForeground(false);await flush();
  assert.equal(f.reads.filter(op=>op.kind==='status').length,statusReads+1);
  assert.deepEqual(f.commands.map(p=>p.kind),['start','stop']);
  assert.strictEqual(f.owner.getSnapshot().command,original);assert.equal(f.owner.getSnapshot().phase,'unknown');
  f.owner.setForeground(true);await flush();await f.owner.restore();
  await f.owner.query();await f.owner.change('update',10);await f.owner.consent();await f.owner.enable(DISCLOSURE_HASH);await f.owner.tick();
  assert.equal(f.commands.length,2);assert.strictEqual(f.owner.getSnapshot().command,original);
  assert.equal(JSON.stringify(original),bytes);assert.equal(f.owner.getSnapshot().pins.length,0);
  assert.equal(f.reads.filter(op=>op.kind==='query').length,0);
});

test('foreground restore honors undiscovered cleanup debt; late ACK settles only the original write and safety cleanup',async t=>{
  const f=fixture();t.after(f.owner.dispose);const gate=deferred<unknown>();
  f.send(async packet=>packet.kind==='start'?gate.promise:{state:'off',ownerHere:false});
  const work=f.start();await flush();const original=f.owner.getSnapshot().command!;
  f.owner.setForeground(false);await flush();assert.equal(f.commands.length,1); // current status still off
  f.owner.setForeground(true);await flush();await f.owner.restore();
  assert.equal(f.commands.length,1);assert.strictEqual(f.owner.getSnapshot().command,original);
  gate.resolve(f.activation());await work;await flush();
  assert.deepEqual(f.commands.map(p=>p.kind),['start','stop']);assert.equal(f.owner.getSnapshot().command,null);
  assert.equal(f.owner.getSnapshot().phase,'off');assert.equal(JSON.stringify(f.commands[0]),JSON.stringify(original));
  assert.equal(f.reads.filter(op=>op.kind==='query').length,0);assert.equal(f.owner.getSnapshot().activation?.state,'off');
});

test('cleanup ACK before the original update ACK stays off; late receipt cannot restore private publication or block consent',async t=>{
  const f=fixture();t.after(f.owner.dispose);await f.start();await f.owner.map();
  const context=f.owner.contactContext(f.owner.getSnapshot().pins[0]!)!,gate=deferred<unknown>();
  f.send(async p=>{if(p.kind==='update')return gate.promise;f.current({state:'off',ownerHere:false});return {state:'off',ownerHere:false};});
  const work=f.owner.change('update',10);await flush();const original=f.owner.getSnapshot().command!,bytes=JSON.stringify(original);
  f.owner.setForeground(false);await flush();
  assert.equal(f.owner.getSnapshot().activation?.state,'off');assert.strictEqual(f.owner.getSnapshot().command,original);
  f.owner.setForeground(true);await flush();await f.owner.restore();
  assert.strictEqual(f.owner.getSnapshot().command,original);assert.equal(f.commands.length,3);
  gate.resolve({...f.activation(),version:2});await work;
  assert.equal(f.owner.getSnapshot().command,null);assert.equal(f.owner.getSnapshot().phase,'off');
  assert.equal(f.owner.getSnapshot().activation?.state,'off');assert.equal(f.owner.getSnapshot().pins.length,0);
  assert.equal(f.owner.getSnapshot().rows.length,0);assert.equal(f.owner.getSnapshot().query,null);assert.equal(context.valid(),false);
  await f.owner.restore();await f.owner.stop();await f.owner.enable(DISCLOSURE_HASH);
  assert.equal(f.commands.length,3);assert.equal(f.reads.filter(op=>op.kind==='query').length,1);
  assert.equal(JSON.stringify(original),bytes);await f.owner.consent();assert.equal(f.owner.getSnapshot().phase,'consent');
  f.send(async()=>f.activation());await f.owner.enable(DISCLOSURE_HASH);
  assert.equal(f.commands.length,4);assert.equal(f.owner.getSnapshot().phase,'ready');assert.equal(context.valid(),false);
});

test('failed separate cleanup retains original bytes and honest pending; restore retries only the frozen cleanup packet',async t=>{
  const f=fixture();t.after(f.owner.dispose);let failStop=true;
  f.send(async packet=>{
    if(packet.kind==='start'){f.current(f.activation());throw Error('lost original response');}
    if(failStop)throw Error('stop response unknown');return {state:'off',ownerHere:false};
  });
  await f.start();const original=f.owner.getSnapshot().command!,bytes=JSON.stringify(original);
  f.owner.setForeground(false);await flush();const stop=f.commands[1]!;
  assert.equal(stop.kind,'stop');assert.strictEqual(f.owner.getSnapshot().command,original);
  assert.match(f.owner.getSnapshot().notice!,/ожидает подтверждения/);assert.notEqual(f.owner.getSnapshot().activation?.state,'off');
  failStop=false;f.owner.setForeground(true);await flush();
  assert.equal(f.commands.length,3);assert.strictEqual(f.commands[2],stop);
  assert.equal(JSON.stringify(f.commands[2]),JSON.stringify(stop));assert.equal(JSON.stringify(original),bytes);
  assert.strictEqual(f.owner.getSnapshot().command,original);assert.equal(f.owner.getSnapshot().activation?.state,'off');
  assert.equal(f.reads.filter(op=>op.kind==='query').length,0);
});

test('a lost response still unknown at background is discovered on foreground restore without resending start',async t=>{
  const f=fixture();t.after(f.owner.dispose);const gate=deferred<void>();
  f.send(async packet=>{if(packet.kind==='start'){await gate.promise;throw Error('lost');}return {state:'off',ownerHere:false};});
  const work=f.start();await flush();const original=f.owner.getSnapshot().command!;
  f.owner.setForeground(false);await flush();gate.resolve();await work;
  assert.equal(f.commands.length,1);assert.strictEqual(f.owner.getSnapshot().command,original);
  f.current(f.activation());f.owner.setForeground(true);await flush();
  assert.deepEqual(f.commands.map(p=>p.kind),['start','stop']);assert.strictEqual(f.owner.getSnapshot().command,original);
  assert.equal(f.reads.filter(op=>op.kind==='query').length,0);assert.equal(f.owner.getSnapshot().pins.length,0);
});

for (const replacement of [{...actor,sessionId:'rotated',generation:2},{actorId:'other-account',sessionId:'other',generation:2}]) test(`late activation/status and safety permit cannot cross ${replacement.actorId===actor.actorId?'session':'account'} rotation`,async t=>{
  const f=fixture();t.after(f.owner.dispose);const accepted=deferred<unknown>(),status=deferred<unknown>();
  f.send(async()=>accepted.promise);const work=f.start();await flush();
  f.read(async op=>op.kind==='config'?config:status.promise);
  f.owner.setForeground(false);await flush();
  f.owner.setActor(replacement);const after=f.owner.getSnapshot();
  accepted.resolve(f.activation());status.resolve(f.activation());await work;await flush();
  assert.strictEqual(f.owner.getSnapshot(),after);assert.equal(f.commands.length,1);
  assert.equal(f.owner.getSnapshot().command,null);assert.equal(f.owner.getSnapshot().pins.length,0);
  assert.ok(f.permits.every(permit=>!permit()));
});

test('old actor late write ACK cannot acknowledge a new actor current command or inherit its cleanup/private context',async t=>{
  const f=fixture();t.after(f.owner.dispose);const oldAck=deferred<unknown>(),currentAck=deferred<unknown>();
  f.send(p=>p.actor.sessionId===actor.sessionId?oldAck.promise:currentAck.promise);
  const oldWork=f.start();await flush();const original=f.owner.getSnapshot().command!;
  f.owner.setForeground(false);await flush();
  const replacement={actorId:'other-account',sessionId:'replacement',generation:2};
  f.owner.setActor(replacement);f.owner.setForeground(true);await flush();await f.owner.consent();
  const currentWork=f.owner.enable(DISCLOSURE_HASH);await flush();const current=f.owner.getSnapshot();
  assert.ok(current.command);assert.equal(current.command.kind,'start');assert.deepEqual(current.command.actor,replacement);
  assert.notStrictEqual(current.command,original);
  oldAck.resolve(f.activation());await oldWork;await flush();
  assert.strictEqual(f.owner.getSnapshot(),current);assert.equal(f.commands.length,2);
  assert.equal(f.owner.getSnapshot().pins.length,0);assert.equal(f.owner.getSnapshot().query,null);
  assert.equal(f.permits[0]!(),false);
  currentAck.resolve(f.activation());await currentWork;
  assert.equal(f.owner.getSnapshot().command,null);assert.equal(f.owner.getSnapshot().phase,'ready');
  assert.deepEqual(f.owner.getSnapshot().actor,replacement);assert.equal(f.commands.length,2);
});

test('cleanup queued in auth transport is denied after authority rotates, without dispatch using captured previous principal',async t=>{
  const f=fixture();t.after(f.owner.dispose);await f.start();const gate=deferred<void>();
  f.beforeDispatch(async p=>{if(p.kind==='stop')await gate.promise;});
  f.owner.setForeground(false);await flush();const stopPermit=f.permits.at(-1)!;assert.equal(stopPermit(),true);
  f.owner.setActor(null);const after=f.owner.getSnapshot();assert.equal(stopPermit(),false);
  gate.resolve();await flush();assert.equal(f.commands.length,1);assert.strictEqual(f.owner.getSnapshot(),after);
});

test('original stop UNKNOWN is never replaced or automatically replayed; explicit cleanup retry keeps the exact original stop',async t=>{
  const f=fixture();t.after(f.owner.dispose);await f.start();
  f.send(async()=>{throw Error('stop unknown');});await f.owner.stop();
  const original=f.owner.getSnapshot().command!,bytes=JSON.stringify(original);assert.equal(original.kind,'stop');
  f.owner.setForeground(false);await flush();f.owner.setForeground(true);await flush();await f.owner.restore();
  assert.equal(f.commands.length,2);assert.strictEqual(f.owner.getSnapshot().command,original);
  await f.owner.stop();assert.equal(f.commands.length,3);assert.strictEqual(f.commands[2],original);
  assert.equal(JSON.stringify(original),bytes);assert.strictEqual(f.owner.getSnapshot().command,original);
  assert.equal(f.owner.getSnapshot().phase,'unknown');
  f.send(async()=>({state:'off',ownerHere:false}));await f.owner.stop();
  assert.equal(f.commands.length,4);assert.strictEqual(f.commands[3],original);
  assert.equal(f.owner.getSnapshot().command,null);assert.equal(f.owner.getSnapshot().phase,'off');
});

function mapSnapshot(f:ReturnType<typeof fixture>,peer='peer',next:string|null=null) {
  const base=f.snapshot();return {...base,items:base.items.map(row=>({...row,publicPlayerId:peer,player:{...row.player,publicPlayerId:peer},radar:{...row.radar,resultRef:`u1.${peer}`}})),
    page:undefined,mapPage:{returnedCount:1,rankStart:1,rankEnd:1,hasMore:next!==null,nextMapCursor:next}};
}
function composer(f:ReturnType<typeof fixture>) {
  let writes=0;
  const contact=new ContactCoordinator({preview:context=>f.owner.preview(context),
    state:async target=>({targetPublicPlayerId:target,state:'none',canRequestContact:true}),
    player:async()=>{throw Error('directory fallback forbidden');},conversation:async()=>{throw Error('unexpected conversation');},
    send:async()=>{writes++;throw Error('stale composer dispatched');}},()=>`contact-key`);
  contact.setActor(actor);return {contact,writes:()=>writes};
}
for (const operation of ['refresh','next','error'] as const) test(`map ${operation} retires actual map composer before late preview; list context survives and replacement pins acquire new authority`,async t=>{
  const f=fixture();t.after(f.owner.dispose);await f.start();
  f.read(async op=>op.kind==='map'?mapSnapshot(f,'peer','cursor-two'):f.snapshot());
  await f.owner.map();const listRow=f.owner.getSnapshot().rows[0]!,pin=f.owner.getSnapshot().pins[0]!;
  assert.notStrictEqual(listRow,pin);const list=f.owner.contactContext(listRow)!,context=f.owner.contactContext(pin)!;
  const ready=composer(f),late=composer(f);
  const preview={player:pin.player,proximityBand:null,radar:pin.radar,upcomingGames:[]};
  const previewGate=deferred<unknown>(),mapGate=deferred<unknown>();let waitPreview=false;
  f.read(async op=>op.kind==='preview'?(waitPreview?previewGate.promise:preview):op.kind==='map'?mapGate.promise:f.snapshot());
  assert.equal(ready.contact.stageRadar(context),true);await ready.contact.openComposer('peer');
  assert.equal(ready.contact.getSnapshot().status,'ready');ready.contact.draft('peer','hello');
  waitPreview=true;const opening=late.contact.open('peer',context);await flush();
  const rows=f.owner.getSnapshot().rows,query=f.owner.getSnapshot().query,generation=f.owner.getSnapshot().generation;
  const refresh=f.owner.map(operation==='next');
  assert.equal(context.valid(),false);assert.equal(f.owner.getSnapshot().pins.length,0);
  assert.equal(f.owner.getSnapshot().mapValidUntil,null);assert.equal(list.valid(),true);
  assert.equal(f.owner.contactContext(pin),null);assert.equal(late.contact.stageRadar(context),false);
  await ready.contact.send();assert.equal(ready.writes(),0);
  previewGate.resolve(preview);await opening;await late.contact.send();assert.equal(late.writes(),0);
  assert.notEqual(late.contact.getSnapshot().status,'ready');
  if(operation==='error')mapGate.resolve({invalid:true});else mapGate.resolve(mapSnapshot(f,'replacement'));
  await refresh;
  assert.strictEqual(f.owner.getSnapshot().rows,rows);assert.strictEqual(f.owner.getSnapshot().query,query);
  assert.equal(f.owner.getSnapshot().generation,generation);assert.equal(list.valid(),true);assert.equal(context.valid(),false);
  const calls=f.reads.filter(op=>op.kind==='map');assert.equal(calls.length,2);
  assert.deepEqual(calls[1],{kind:'map',body:{contractVersion:RADAR_WIRE,queryRef:'query-one',...(operation==='next'?{mapCursor:'cursor-two'}:{}),limit:100}});
  if(operation==='error'){
    assert.equal(f.owner.getSnapshot().pins.length,0);assert.equal(f.owner.getSnapshot().mapPage,null);
    f.read(async op=>op.kind==='map'?mapSnapshot(f,'replacement'):f.snapshot());await f.owner.map();
  }
  const fresh=f.owner.contactContext(f.owner.getSnapshot().pins[0]!)!;assert.equal(fresh.target,'replacement');assert.equal(fresh.valid(),true);
  assert.equal(f.commands.length,1);assert.equal(ready.writes()+late.writes(),0);
});

test('map-window expiry rejects map proof; failed map with expired query retains mandatory private clearing',async t=>{
  const f=fixture();t.after(f.owner.dispose);await f.start();
  f.read(async()=>({...mapSnapshot(f),validUntil:instant(f.now()+1000)}));await f.owner.map();
  const context=f.owner.contactContext(f.owner.getSnapshot().pins[0]!)!,list=f.owner.contactContext(f.owner.getSnapshot().rows[0]!)!;
  f.advance(1001);assert.equal(context.valid(),false);assert.equal(list.valid(),true);
  const gate=deferred<unknown>();f.read(async()=>gate.promise);const work=f.owner.map();f.advance(60000);gate.resolve({invalid:true});await work;
  assert.equal(f.owner.getSnapshot().rows.length,0);assert.equal(f.owner.getSnapshot().query,null);assert.equal(list.valid(),false);
});

test('confirmed cleanup on foreground return requires a fresh explicit enable intent before another publication/query',async t=>{
  const f=fixture();t.after(f.owner.dispose);await f.start();await f.owner.map();
  f.owner.setForeground(false);await flush();f.owner.setForeground(true);await flush();
  assert.deepEqual(f.commands.map(p=>p.kind),['start','stop']);
  assert.equal(f.owner.getSnapshot().phase,'off');assert.equal(f.owner.getSnapshot().pins.length,0);
  await f.owner.query();await f.owner.change('update',10);await f.owner.tick();await f.owner.enable(DISCLOSURE_HASH);
  assert.equal(f.commands.length,2);assert.equal(f.reads.filter(op=>op.kind==='query').length,1);
  await f.owner.consent();await f.owner.enable(DISCLOSURE_HASH);
  assert.deepEqual(f.commands.map(p=>p.kind),['start','stop','start']);assert.equal(f.owner.getSnapshot().phase,'ready');
});

test('late update receipt never automatically retries an already UNKNOWN cleanup stop; restore reconciles that same packet',async t=>{
  const f=fixture();t.after(f.owner.dispose);await f.start();const gate=deferred<unknown>();let fail=true;
  f.send(async p=>{if(p.kind==='update')return gate.promise;if(fail)throw Error('cleanup unknown');return {state:'off',ownerHere:false};});
  const work=f.owner.change('update',10);await flush();const original=f.owner.getSnapshot().command!,bytes=JSON.stringify(original);
  f.owner.setForeground(false);await flush();const cleanup=f.commands[2]!;assert.equal(cleanup.kind,'stop');
  gate.resolve({...f.activation(),version:2});await work;await flush();
  assert.equal(f.commands.length,3);assert.equal(f.owner.getSnapshot().command,null);assert.equal(JSON.stringify(original),bytes);
  assert.match(f.owner.getSnapshot().notice!,/ожидает подтверждения/);assert.equal(f.owner.getSnapshot().pins.length,0);
  fail=false;f.owner.setForeground(true);await flush();
  assert.equal(f.commands.length,4);assert.strictEqual(f.commands[3],cleanup);assert.equal(f.owner.getSnapshot().command,null);
  assert.equal(f.owner.getSnapshot().phase,'off');
  assert.equal(f.owner.getSnapshot().activation?.state,'off');assert.equal(f.reads.filter(op=>op.kind==='query').length,1);
});
