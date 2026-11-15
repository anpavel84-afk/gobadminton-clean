import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { URL } from 'node:url';
import { adaptNativeStyle, closeVenueSheet, expandedVenueCreate, gamesContext, gamesRoute, loadMapSnapshot, loadNativeStyle, mapBack, mapControlBottom, mapDataKey, mapPackForCity, markerActivation, nativeMapCamera, nativeResource, publicGamesIntent, resolveMapSelection, retainedGamesOffset, validMapCamera, venueMarkerLabel, venueScheduleDays, venueSchedules, verifiedNativeStyle, visibleMapVenues } from '../src/maps.ts';
import { appendUpcomingPage } from '../src/upcoming.ts';
import type { GamePage } from '../src/public-api.ts';
import { createPublicApi, gamesResourceKey } from '../src/public-api.ts';
import type { MapSnapshot, MapOverlay, SheetMeasurement } from '../src/maps.ts';
import { LatestResource } from '../src/resource.ts';
import { parseVenue } from '../src/venues.ts';
import { game } from './fixtures.ts';
const pack = mapPackForCity('a0000000-0000-4000-8000-000000000001')!;
const id = '11111111-1111-4111-8111-111111111111', alias = '22222222-2222-4222-8222-222222222222';
const venue = {id,name:'Зал',address:'Улица',cityId:pack.cityId,timezone:'Europe/Moscow',latitude:55.75,longitude:37.61};
const now = Date.parse('2026-11-15T00:00:00Z');
const upcoming = {...game,venue,timezone:venue.timezone};
const hash = async (bytes:Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const style = () => ({version:8,glyphs:'fonts/{fontstack}/{range}.pbf',sprite:'sprites/v4/light',sources:{protomaps:{type:'vector',url:'pmtiles://moscow.pmtiles',bounds:[36,54.5,39.5,56.5],minzoom:0,maxzoom:15,attribution:'© OpenStreetMap contributors · Protomaps'},metro:{type:'geojson',data:{type:'FeatureCollection',features:[]}}},layers:[{id:'water',type:'fill',source:'protomaps','source-layer':'water'}]});

test('11.5.1 camera events read nativeEvent center/zoom and reject invalid updates without inventing a fallback', () => {
  const center = [venue.longitude,venue.latitude], expected = {center,zoom:12};
  const event = {nativeEvent:{...expected,bearing:0,pitch:0,bounds:[36,54.5,39.5,56.5],animated:false,userInteraction:true},
    geometry:{coordinates:[0,0]},properties:{zoomLevel:99}};
  assert.deepEqual(nativeMapCamera(event,pack),expected);
  assert.notStrictEqual(nativeMapCamera(event,pack)?.center,center);
  for (const zoom of [0,16]) assert.equal(nativeMapCamera({nativeEvent:{center,zoom}},pack)?.zoom,zoom);
  for (const invalid of [null,{},expected,{nativeEvent:null},{geometry:{coordinates:center},properties:{zoomLevel:12}},
    ...[undefined,[],[venue.longitude],[...center,0],['37.61',55.75],[NaN,55.75],[Infinity,55.75],[0,0]].map(center => ({nativeEvent:{center,zoom:12}})),
    ...[undefined,'12',NaN,Infinity,-1,16.01].map(zoom => ({nativeEvent:{center,zoom}}))]) {
    assert.equal(nativeMapCamera(invalid,pack),null);
  }
});

test('closed city packs have no unknown-city substitution and camera/markers stay within their selected bounds', () => {
  assert.equal(mapPackForCity('unknown'),null);assert.equal(mapPackForCity(null),null);
  const spb=mapPackForCity('a0000000-0000-4000-8000-000000000002')!;
  assert.equal(spb.mapId,'saint-petersburg');assert.equal(mapPackForCity('5c219eb1-87da-5fd3-9194-20e9d1501315')?.mapId,'kazan');
  assert.deepEqual(validMapCamera({center:[0,0],zoom:12},pack).center,pack.center);
  assert.deepEqual(visibleMapVenues([venue,{...venue,id:alias,longitude:0}],null,'all',pack),[venue]);
  assert.deepEqual(visibleMapVenues([venue],null,'with_games',pack),[venue]);
  assert.deepEqual(visibleMapVenues([venue],new Map([[id,0]]),'with_games',pack),[]);
  assert.deepEqual(visibleMapVenues([venue],new Map([[id,2]]),'with_games',pack),[venue]);
  assert.match(venueMarkerLabel(venue,null),/расписание недоступно/);assert.match(venueMarkerLabel(venue,new Map([[id,0]])),/0 доступных игр/);
});
test('raw-byte SHA precedes parsing; absolute native PMTiles and glyph/sprite expansion retain original semantics', async () => {
  const original=style(), bytes=new TextEncoder().encode(JSON.stringify(original));
  const verifiedPack={...pack,styleHash:await hash(bytes)};
  const adapted=await verifiedNativeStyle(bytes,verifiedPack,hash);
  assert.equal((adapted.sources.protomaps as {url:string}).url,`pmtiles://${pack.prefix}moscow.pmtiles`);
  assert.equal(adapted.glyphs,`${pack.prefix}fonts/{fontstack}/{range}.pbf`);
  assert.equal(adapted.sprite,`${pack.prefix}sprites/v4/light`);
  assert.deepEqual(adapted.layers,original.layers);assert.deepEqual((adapted.sources.protomaps as {bounds:number[]}).bounds,original.sources.protomaps.bounds);
  assert.equal((adapted.sources.protomaps as {attribution:string}).attribution,original.sources.protomaps.attribution);
  assert.equal(original.sources.protomaps.url,'pmtiles://moscow.pmtiles');
  await assert.rejects(verifiedNativeStyle(new TextEncoder().encode('{broken'),pack,hash),/identity/);
  await assert.rejects(verifiedNativeStyle(bytes,pack,hash),/identity/);
  const sprites=adaptNativeStyle({...original,sprite:[{id:'default',url:'sprites/v4/light'}]},pack);
  assert.deepEqual(sprites.sprite,[{id:'default',url:`${pack.prefix}sprites/v4/light`}]);
});
test('all network-bearing style resource types reject escape, userinfo, query and unsupported nested sources', () => {
  for (const url of ['../outside.pmtiles','https://evil.example/a','https://@dev.gobadminton.ru/map-assets/a','moscow.pmtiles?token=x','moscow.pmtiles#x','%2e%2e/a','pmtiles://http://dev.gobadminton.ru/a','\\evil/a']) assert.throws(() => nativeResource(url,pack),url);
  for (const change of [
    {glyphs:'https://evil.example/{fontstack}/{range}.pbf'},
    {sprite:'../sprites/light'},
    {sources:{...style().sources,raster:{type:'raster',tiles:['https://evil.example/{z}/{x}/{y}']}}},
    {sources:{...style().sources,metro:{type:'geojson',data:'https://evil.example/metro.json'}}},
    {sources:{protomaps:{type:'vector',url:'tiles.json'}}},
  ]) assert.throws(() => adaptNativeStyle({...style(),...change},pack));
  assert.equal(nativeResource(`pmtiles://${pack.prefix}moscow.pmtiles`,pack),`pmtiles://${pack.prefix}moscow.pmtiles`);
});
test('style transport uses only the selected pack without auth/Origin and propagates cancellation and failure', async () => {
  const bytes=new TextEncoder().encode(JSON.stringify(style())), verifiedPack={...pack,styleHash:await hash(bytes)};
  let options:RequestInit|undefined;
  const fetcher:typeof fetch=async (url,init) => {assert.equal(url,`${pack.prefix}style-dev.json`);options=init;return new Response(bytes);};
  await loadNativeStyle(verifiedPack,hash,new AbortController().signal,fetcher);
  assert.equal(options?.credentials,'omit');assert.equal(options?.redirect,'error');assert.equal(options?.headers,undefined);
  await assert.rejects(loadNativeStyle(pack,hash,new AbortController().signal,async () => new Response('',{status:503})));
  const controller=new AbortController();controller.abort();
  await assert.rejects(loadNativeStyle(verifiedPack,hash,controller.signal,fetcher),/cancelled/);
  assert.equal(options?.signal?.aborted,true);
});
test('all real cursor pages dedupe and retain empty intermediate pages; query generation freezes startsFrom and proves canonical game aliases', async () => {
  const calls:URL[]=[];
  const api=createPublicApi(async url => {
    const u=new URL(String(url));calls.push(u);
    if (u.pathname.endsWith(`/venues/${alias}`)) return Response.json({...venue,resolvedFromVenueId:alias});
    if (u.pathname.endsWith('/venues')) return Response.json({items:[venue,venue],nextCursor:u.searchParams.has('cursor') ? null : 'V2'});
    if (!u.searchParams.has('cursor')) return Response.json({items:[],nextCursor:'G2'});
    return Response.json({items:[{...upcoming,venue:{...venue,id:alias}},upcoming],nextCursor:null});
  },()=>now);
  const result=await loadMapSnapshot(api,pack.cityId,{activityKind:'regular'},new AbortController().signal,now);
  assert.equal(result.venues.length,1);assert.equal(result.games?.length,1);assert.equal(result.aliases.get(alias),undefined);
  const games=calls.filter(u=>u.pathname.endsWith('/games'));
  assert.equal(games.length,2);assert.ok(games.every(u=>u.searchParams.get('startsFrom')===new Date(now).toISOString() && u.searchParams.get('activityKind')==='regular'));
  assert.equal(calls.filter(u=>u.pathname.endsWith(`/venues/${alias}`)).length,0); // same immutable game ID replaced the obsolete projection
  const aliasApi={mapVenues:async()=>({items:[venue],nextCursor:null}),games:async()=>({items:[{...upcoming,venue:{...venue,id:alias}}],nextCursor:null}),venue:async()=>parseVenue({...venue,resolvedFromVenueId:alias},alias)};
  const bound=await loadMapSnapshot(aliasApi,pack.cityId,{},new AbortController().signal,now);
  assert.equal(bound.aliases.get(alias),id);assert.equal(venueSchedules(bound,{},now)?.get(id)?.length,1);
});
test('partial/looping schedule remains unavailable and never zero; selected venue aliases need a real matching public binding', async () => {
  let page=0;
  const api={mapVenues:async()=>({items:[venue],nextCursor:null}),games:async()=>{if (++page===1) return {items:[upcoming],nextCursor:'A'};throw new Error('network');},venue:async()=>parseVenue({...venue,resolvedFromVenueId:alias},alias)};
  const result=await loadMapSnapshot(api,pack.cityId,{},new AbortController().signal,now);
  assert.equal(result.games,null);assert.equal(result.scheduleError,true);assert.equal(venueSchedules(result,{},now),null);
  assert.equal((await resolveMapSelection(alias,[venue],api,new AbortController().signal)).id,id);
  await assert.rejects(resolveMapSelection(alias,[venue],{venue:async()=>parseVenue({...venue,id:alias},alias)},new AbortController().signal));
  const looping=await loadMapSnapshot({...api,games:async()=>({items:[upcoming],nextCursor:'A'})},pack.cityId,{},new AbortController().signal,now);
  assert.equal(looping.games,null);
});
test('same city/day/activity generation aborts and fences late responses even if transport ignores the signal', async () => {
  const resource=new LatestResource<MapSnapshot>();let finish!:(value:MapSnapshot)=>void, oldSignal!:AbortSignal;
  const a=mapDataKey(pack.cityId,{day:'2026-11-20',activityKind:'regular'}), b=mapDataKey(pack.cityId,{day:'2026-11-21',activityKind:'trainer_led'});
  const late=resource.load(a,signal=>{oldSignal=signal;return new Promise(resolve=>{finish=resolve;});});
  const fresh:MapSnapshot={venues:[],games:[],aliases:new Map(),scheduleError:false};
  await resource.load(b,async()=>fresh);assert.equal(oldSignal.aborted,true);
  finish({venues:[venue],games:[upcoming],aliases:new Map(),scheduleError:false});await late;
  assert.strictEqual(resource.state.data,fresh);assert.equal(resource.state.key,b);
});
test('accepted WEB eligibility uses public/published, availablePlaces, future/deadline and venue-local day/activity', () => {
  const valid={...upcoming,startsAt:'2026-11-20T22:30:00Z',applicationDeadlineAt:'2026-11-20T20:00:00Z'};
  const snapshot:MapSnapshot={venues:[venue],games:[valid,{...valid,id:'cancel',status:'cancelled'},{...valid,id:'full',availablePlaces:0},{...valid,id:'deadline',applicationDeadlineAt:new Date(now).toISOString()},{...valid,id:'past',startsAt:new Date(now).toISOString()},{...valid,id:'trainer',activityKind:'trainer_led'}],aliases:new Map(),scheduleError:false};
  assert.deepEqual(venueSchedules(snapshot,{day:'2026-11-21',activityKind:'regular'},now)?.get(id)?.map(g=>g.id),[valid.id]);
  assert.equal(venueSchedules(snapshot,{day:'2026-11-20'},now)?.get(id)?.length,0);
  assert.equal(venueSchedules({...snapshot,games:[]},{},now)?.get(id)?.length,0);
});
test('typed Games query/list return and hierarchical Back retain only public context, with no arbitrary returnTo', () => {
  const context=gamesContext({cityId:pack.cityId,day:'2026-11-20',activity:'trainer_led',selectedVenue:alias,listOffset:'812',origin:'list'})!;
  assert.ok(context);
  const map=gamesRoute(context,'map');assert.equal(map.pathname,'/games/map');
  assert.deepEqual(gamesContext(map.params),context);
  const list=gamesRoute(context,'list');assert.equal(list.pathname,'/games');assert.equal(list.params.listOffset,'812');assert.equal(list.params.activity,'trainer_led');assert.equal(list.params.selectedVenue,undefined);
  assert.equal(gamesContext({returnTo:'https://evil.example'}),null);assert.equal(gamesContext({day:'2026-02-30'}),null);assert.equal(gamesContext({cityId:'unknown'}),null);
  let state:MapOverlay={filter:true,expanded:true,selected:id};
  state=mapBack(state)!;assert.equal(state.filter,false);assert.equal(state.expanded,true);
  state=mapBack(state)!;assert.equal(state.expanded,false);assert.equal(state.selected,id);
  state=mapBack(state)!;assert.equal(state.selected,null);assert.equal(mapBack(state),null);
  const publicMap=publicGamesIntent(`/games?view=map&cityId=${pack.cityId}&day=2026-11-20&activity=regular`)!;
  assert.equal(new URL(publicMap,'https://dev.gobadminton.ru').pathname,'/games/map');
});
test('drag never activates selection; create requires expanded verified venue and remains a typed inert intent', () => {
  const activation=markerActivation();activation.start(0,0);activation.move(10,0);assert.equal(activation.allow(),false);
  activation.start(0,0);activation.move(2,0);assert.equal(activation.allow(),true);activation.cancel();assert.equal(activation.allow(),false);
  const detail=parseVenue(venue,id);
  assert.equal(expandedVenueCreate(false,detail),null);assert.equal(expandedVenueCreate(true,undefined),null);
  assert.equal(expandedVenueCreate(true,detail),`/games/create/venue/${id}`);
});

test('owning Games handlers carry the current query/scroll into map and restore the origin list with changed map filters', async () => {
  const {readFileSync}=await import('node:fs');
  const {stripTypeScriptTypes}=await import('node:module');
  const {runInNewContext}=await import('node:vm');
  const listSource=readFileSync(new URL('../app/games/index.tsx',import.meta.url),'utf8');
  const mapSource=readFileSync(new URL('../app/games/map.tsx',import.meta.url),'utf8');
  const context=gamesContext({cityId:pack.cityId,day:'2026-11-20',activity:'regular',listOffset:'735',origin:'list'})!;
  const pushes:unknown[]=[], returns:unknown[]=[], listOffset={current:0}, mapBookmark={current:null};
  const key=gamesResourceKey(pack.cityId,{day:context.day,activityKind:context.activity,timezone:venue.timezone});
  const onScroll=listSource.match(/onScroll=\{(.+)\} scrollEventThrottle/)![1]!;
  const scroll=runInNewContext(`(${stripTypeScriptTypes(onScroll)})`,{listOffset,restoreOffset:{current:null}}) as (event:unknown)=>void;
  scroll({nativeEvent:{contentOffset:{y:735}}});assert.equal(listOffset.current,735);
  const open=listSource.match(/const openMap = (.+);/)![1]!;
  const openMap=runInNewContext(`(${stripTypeScriptTypes(open)})`,{cityId:pack.cityId,day:context.day,activityKind:context.activity,level:'',listOffset,mapBookmark,key,gamesRoute,router:{push:(route:unknown)=>pushes.push(route)}}) as ()=>void;
  openMap();assert.equal(pushes.length,1);
  assert.equal(retainedGamesOffset(mapBookmark.current,context,key),735);
  assert.deepEqual(JSON.parse(JSON.stringify(pushes[0])),gamesRoute(context,'map'));
  const callback=mapSource.slice(mapSource.indexOf('  const returnToList ='),mapSource.indexOf('  const back ='))+'\nreturn returnToList;';
  const returnToList=runInNewContext(stripTypeScriptTypes(`(function(){${callback}})()`),{
    useCallback:(fn:unknown)=>fn,context,cityId:pack.cityId,day:'2026-11-21',activity:'trainer_led',gamesRoute,
    router:{canGoBack:()=>true,dismissTo:(route:unknown)=>returns.push(route),replace:(route:unknown)=>returns.push(route)},
  }) as ()=>void;
  returnToList();
  assert.deepEqual(JSON.parse(JSON.stringify(returns[0])),gamesRoute({...context,day:'2026-11-21',activity:'trainer_led'},'list'));
  let restored:number|null=null;
  const onSize=listSource.match(/onContentSizeChange=\{(.+)\}/)![1]!;
  const restoreOffset={current:735 as number|null};
  const resized=runInNewContext(`(${stripTypeScriptTypes(onSize)})`,{restoreOffset,state:{data:{items:[]}},listRef:{current:{scrollToOffset:({offset}:{offset:number})=>{restored=offset;}}}}) as (w:number,h:number)=>void;
  resized(360,500);assert.equal(restored,null);resized(360,1500);assert.equal(restored,735);assert.equal(restoreOffset.current,null);
});

test('mounted useResource retains real second/third cursor pages and local scroll bookmark across map/back without any restore fetch', async () => {
  const {readFileSync}=await import('node:fs');
  const {stripTypeScriptTypes}=await import('node:module');
  const {runInNewContext}=await import('node:vm');
  // Execute the actual hook with a retained React-style state/effect owner.
  // This exercises its dependencies and resource lifetime; it is not a native mount/scroll test.
  const hooks=readFileSync(new URL('../src/hooks.ts',import.meta.url),'utf8');
  const source=hooks.slice(hooks.indexOf('export function useResource'),hooks.indexOf('export function useReduceMotion')).replace('export function','function');
  let owned:unknown, deps:unknown[]|undefined;
  const lifecycle:{cleanup?:()=>void}={};
  const hook=runInNewContext(stripTypeScriptTypes(`${source}\nuseResource;`),{
    LatestResource,
    useState:(initialize:()=>unknown)=>{owned ??= initialize();return [owned];},
    useSyncExternalStore:(_subscribe:unknown,getSnapshot:()=>unknown)=>getSnapshot(),
    useEffect:(effect:()=>()=>void,next:unknown[])=>{
      if (!deps || next.some((value,index)=>value !== deps![index])) {lifecycle.cleanup?.();deps=next;lifecycle.cleanup=effect();}
    },
  }) as (key:string,task:(signal:AbortSignal)=>Promise<GamePage>)=>{state:LatestResource<GamePage>['state'];resource:LatestResource<GamePage>};
  const calls:string[]=[], api=createPublicApi(async url=>{
    const cursor=new URL(String(url)).searchParams.get('cursor') ?? 'first';calls.push(cursor);
    return Response.json(cursor === 'first' ? {items:[upcoming],nextCursor:'second'} : cursor === 'second'
      ? {items:[{...upcoming,id:'page-2'}],nextCursor:'third'} : {items:[{...upcoming,id:'page-3'}],nextCursor:null});
  },()=>now);
  const filters={day:'2026-11-20',activityKind:'regular' as const,timezone:venue.timezone};
  const key=gamesResourceKey(pack.cityId,filters), task=(signal:AbortSignal)=>api.games(pack.cityId,undefined,signal,filters);
  const initial=hook(key,task);await new Promise(resolve=>setImmediate(resolve));
  const first=hook(key,task);assert.strictEqual(first.resource,initial.resource);assert.equal(first.state.data?.nextCursor,'second');
  const listSource=readFileSync(new URL('../app/games/index.tsx',import.meta.url),'utf8');
  const moreSource=listSource.slice(listSource.indexOf('  const more ='),listSource.indexOf('  const selectCity ='))+'\nmore;';
  const more=()=>runInNewContext(stripTypeScriptTypes(moreSource),{cityId:pack.cityId,key,day:filters.day,activityKind:filters.activityKind,timezone:venue.timezone,
    state:first.resource.state,resource:first.resource,publicApi:api,appendUpcomingPage:(old:GamePage,page:GamePage)=>appendUpcomingPage(old,page,now)}) as ()=>void;
  more()();await new Promise(resolve=>setImmediate(resolve));more()();await new Promise(resolve=>setImmediate(resolve));
  const loaded=hook(key,task).state.data!;
  assert.deepEqual(loaded.items.map(item=>item.id),[upcoming.id,'page-2','page-3']);assert.equal(loaded.nextCursor,null);
  const context=gamesContext({cityId:pack.cityId,day:filters.day,activity:filters.activityKind,listOffset:'12800',origin:'list'})!;
  const bookmark={context,resourceKey:key};
  // Focus changes do not change the hook key or task, so neither cleanup nor a first-page reload runs.
  hook(key,task);const returned=hook(key,task);
  assert.strictEqual(returned.state.data,loaded);assert.deepEqual(calls,['first','second','third']);
  assert.equal(retainedGamesOffset(bookmark,context,key),12800);
  assert.equal(retainedGamesOffset(null,context,key),null); // a forged origin/offset has no local authority
  assert.equal(retainedGamesOffset(bookmark,{...context,origin:'external'},key),null);
  assert.equal(retainedGamesOffset(bookmark,{...context,day:'2026-11-21'},key),null);
  assert.equal(retainedGamesOffset(bookmark,{...context,activity:'trainer_led'},key),null);
  assert.equal(retainedGamesOffset(bookmark,context,`${key}:new-generation`),null);
  const size=listSource.match(/onContentSizeChange=\{(.+)\}/)![1]!;
  let restored:number|null=null;const restoreOffset={current:retainedGamesOffset(bookmark,context,key)};
  const resize=runInNewContext(`(${stripTypeScriptTypes(size)})`,{restoreOffset,state:returned.state,listRef:{current:{scrollToOffset:({offset}:{offset:number})=>{restored=offset;}}}}) as (w:number,h:number)=>void;
  resize(360,20000);assert.equal(restored,12800);assert.equal(restoreOffset.current,null);
  more()();await new Promise(resolve=>setImmediate(resolve));assert.equal(calls.length,3); // real end cursor is final
  // Actual hook query change aborts an in-flight old cursor and cannot publish it over the new query.
  let oldSignal!:AbortSignal, finish!:(page:GamePage)=>void;
  const late=returned.resource.load(key,signal=>{oldSignal=signal;return new Promise(resolve=>{finish=resolve;});},appendUpcomingPage);
  const nextKey=gamesResourceKey(pack.cityId,{...filters,day:'2026-11-21'});
  const nextTask=async()=>({items:[],nextCursor:null});hook(nextKey,nextTask);
  await new Promise(resolve=>setImmediate(resolve));assert.equal(oldSignal.aborted,true);
  finish({items:[{...upcoming,id:'late-old-page'}],nextCursor:'old'});await late;
  assert.equal(returned.resource.state.key,nextKey);assert.deepEqual(returned.resource.state.data,{items:[],nextCursor:null});
  lifecycle.cleanup?.();
});

test('retained Games cursor errors preserve already loaded pages, retry stays explicit, and cancelled append never overwrites a new query', async () => {
  const resource=new LatestResource<GamePage>(), key=gamesResourceKey(pack.cityId,{day:'2026-11-20'});
  const page={items:[upcoming],nextCursor:'second'};
  await resource.load(key,async()=>page);
  await resource.load(key,async()=>({items:[{...upcoming,id:'beyond-first'}],nextCursor:'third'}),(a,b)=>appendUpcomingPage(a,b,now));
  const loaded=resource.state.data!;
  await resource.load(key,async()=>{throw new Error('cursor transport failed');},appendUpcomingPage);
  assert.equal(resource.state.status,'error');assert.strictEqual(resource.state.data,loaded);assert.equal(resource.state.data?.nextCursor,'third');
  const context=gamesContext({cityId:pack.cityId,day:'2026-11-20',listOffset:'12800',origin:'list'})!;
  assert.equal(retainedGamesOffset({context,resourceKey:key},context,key),12800);
  // Empty final page is a valid end; no additional page is invented to reach an offset.
  await resource.load(key,async()=>({items:[],nextCursor:null}),(a,b)=>appendUpcomingPage(a,b,now));
  assert.deepEqual(resource.state.data?.items,loaded.items);assert.equal(resource.state.data?.nextCursor,null);
  let finish!:(page:GamePage)=>void, signal!:AbortSignal;
  const old=resource.load(key,s=>{signal=s;return new Promise(resolve=>{finish=resolve;});},appendUpcomingPage);
  resource.cancel();assert.equal(signal.aborted,true);
  const next=gamesResourceKey(pack.cityId,{activityKind:'trainer_led'});
  await resource.load(next,async()=>({items:[],nextCursor:null}));
  finish({items:[upcoming],nextCursor:'stale'});await old;
  assert.equal(resource.state.key,next);assert.deepEqual(resource.state.data,{items:[],nextCursor:null});
});

test('expanded X preserves selection; compact dismiss clears it; real measured obstruction follows growth and rejects stale owners', async () => {
  const expanded:MapOverlay={filter:false,expanded:true,selected:id};
  const compact=closeVenueSheet(expanded);assert.equal(compact.expanded,false);assert.equal(compact.selected,id);
  assert.equal(closeVenueSheet(compact).selected,null);
  assert.deepEqual(mapBack({...expanded,filter:true}),{...expanded});
  assert.deepEqual(mapBack(expanded),compact);assert.equal(mapBack(compact)?.selected,null);
  const compactOwner='1:query:venue:compact', expandedOwner='2:query:venue:expanded';
  assert.equal(mapControlBottom({owner:compactOwner,height:208},compactOwner,false,34),262);
  assert.equal(mapControlBottom({owner:compactOwner,height:340},compactOwner,false,34),394);
  assert.equal(mapControlBottom({owner:expandedOwner,height:680},expandedOwner,true,34),688);
  assert.equal(mapControlBottom({owner:compactOwner,height:340},expandedOwner,true,34),42);
  assert.equal(mapControlBottom({owner:expandedOwner,height:680},null,false,34),42);
  assert.equal(mapControlBottom({owner:compactOwner,height:340},'3:new-query:same-venue',false,34),42);
  assert.equal(mapControlBottom({owner:compactOwner,height:NaN},compactOwner,false,0),8);
  const {readFileSync}=await import('node:fs');
  const {stripTypeScriptTypes}=await import('node:module');
  const {runInNewContext}=await import('node:vm');
  const mapSource=readFileSync(new URL('../app/games/map.tsx',import.meta.url),'utf8');
  const measurementSource=mapSource.slice(mapSource.indexOf('  const measureSheet ='),mapSource.indexOf('  const controlBottom ='))+'\nmeasureSheet;';
  const activeSheet={current:compactOwner as string|null};let published:unknown=null;
  const measure=runInNewContext(stripTypeScriptTypes(measurementSource),{useCallback:(fn:unknown)=>fn,sheetOwner:compactOwner,activeSheet,
    setSheetMeasurement:(value:unknown)=>{published=value;}}) as (height:number)=>void;
  measure(208);assert.deepEqual(JSON.parse(JSON.stringify(published)),{owner:compactOwner,height:208});
  measure(340);assert.deepEqual(JSON.parse(JSON.stringify(published)),{owner:compactOwner,height:340});
  activeSheet.current=expandedOwner;published=null;measure(208);measure(0);assert.equal(published,null); // stale layout/unmount
  activeSheet.current=null;measure(208);assert.equal(published,null); // deselect / parent unmount
  const sheetSource=readFileSync(new URL('../src/components/venue-sheet.tsx',import.meta.url),'utf8');
  const closeSource=sheetSource.slice(sheetSource.indexOf('  const close ='),sheetSource.indexOf('  return <View'))+'\nclose;';
  let collapsed:boolean|null=null, dismissed=0;
  const makeClose=(expanded:boolean)=>runInNewContext(stripTypeScriptTypes(closeSource),{closeVenueSheet,expanded,selection:venue,
    onExpand:(value:boolean)=>{collapsed=value;},onClose:()=>{dismissed++;}}) as ()=>void;
  makeClose(true)();assert.equal(collapsed,false);assert.equal(dismissed,0);
  makeClose(false)();assert.equal(dismissed,1);

});

test('map schedule groups only the real eligible snapshot by venue-local date, preserving unavailable versus empty', () => {
  const a={...upcoming,id:'a',startsAt:'2026-11-20T22:30:00Z',applicationDeadlineAt:'2026-11-20T21:00:00Z'};
  const b={...a,id:'b',startsAt:'2026-11-21T21:30:00Z'}, c={...a,id:'c',startsAt:'2026-11-20T19:30:00Z'};
  const snapshot:MapSnapshot={venues:[venue],games:[b,a,c,{...a,id:'full',availablePlaces:0}],aliases:new Map(),scheduleError:false};
  const eligible=venueSchedules(snapshot,{},now)!.get(id)!;
  assert.deepEqual(venueScheduleDays(eligible,venue.timezone).map(day=>({date:day.date,ids:day.games.map(g=>g.id)})),[
    {date:'2026-11-20',ids:['c']},{date:'2026-11-21',ids:['a']},{date:'2026-11-22',ids:['b']},
  ]);
  assert.deepEqual(venueScheduleDays([],venue.timezone),[]);
  assert.equal(venueSchedules({...snapshot,games:null,scheduleError:true},{},now),null);
});

test('Players venue/person measured owners reserve actual safe clearance and reject retired layout callbacks across transitions',async()=>{
  const {readFileSync}=await import('node:fs'),{stripTypeScriptTypes}=await import('node:module'),{runInNewContext}=await import('node:vm');
  const source=readFileSync(new URL('../app/players/index.tsx',import.meta.url),'utf8');
  const body=source.slice(source.indexOf('  const sheetContext ='),source.indexOf('  const statusTop ='))+'\n({sheetOwner,measureSheet,controlBottom});';
  const refs:{current:unknown}[]=[],lifecycle:{deps?:unknown[];cleanup?:()=>void}={};
  let measurement:SheetMeasurement|null=null;
  const input={mapOpen:true,selection:venue,person:null as {publicPlayerId:string}|null,params:{view:'map'},key:'filters',mapCityId:pack.cityId,
    venueMode:'all',showPeople:true,radarState:{generation:1},expanded:false,window:{width:390,height:844,fontScale:1},insets:{top:44,bottom:34,left:0,right:0}};
  const render=()=>{
    let ref=0;
    return runInNewContext(stripTypeScriptTypes(body),{...input,sheetMeasurement:measurement,mapControlBottom,
      useRef:(initial:unknown)=>{const i=ref++;return refs[i] ?? (refs[i]={current:initial});},
      useCallback:(fn:unknown)=>fn,setSheetMeasurement:(value:typeof measurement)=>{measurement=value;},
      useLayoutEffect:(effect:()=>()=>void,deps:unknown[])=>{
        if(!lifecycle.deps || deps.some((v,i)=>v!==lifecycle.deps![i])){lifecycle.cleanup?.();lifecycle.deps=deps;lifecycle.cleanup=effect();}
      }}) as {sheetOwner:string|null;measureSheet:(height:number)=>void;controlBottom:number};
  };
  const compact=render();compact.measureSheet(208);assert.equal(render().controlBottom,262);
  compact.measureSheet(340);assert.equal(render().controlBottom,394); // text/content growth
  input.person={publicPlayerId:'peer'};const person=render();assert.notEqual(person.sheetOwner,compact.sheetOwner);
  compact.measureSheet(900);assert.equal(measurement,null);person.measureSheet(180);assert.equal(render().controlBottom,234);
  input.expanded=true;const expanded=render();person.measureSheet(900);assert.equal(measurement,null);
  expanded.measureSheet(680);assert.equal(render().controlBottom,688);
  input.expanded=false;const back=render();assert.notEqual(back.sheetOwner,person.sheetOwner);person.measureSheet(900);assert.equal(measurement,null);
  input.window={width:844,height:390,fontScale:1.5};input.insets={top:0,bottom:21,left:44,right:44};
  const rotated=render();back.measureSheet(900);assert.equal(measurement,null);rotated.measureSheet(200);assert.equal(render().controlBottom,241);
  input.key='changed filters';const filtered=render();rotated.measureSheet(900);assert.equal(measurement,null);assert.notEqual(filtered.sheetOwner,rotated.sheetOwner);
  input.mapOpen=false;const closed=render();filtered.measureSheet(900);assert.equal(measurement,null);assert.equal(closed.sheetOwner,null);
  assert.match(source,/key=\{sheetOwner\} onLayout=\{event => measureSheet\(event.nativeEvent.layout.height\)\}/);
  assert.match(source,/<VenueSheet key=\{sheetOwner\}[\s\S]*onMeasure=\{measureSheet\}/);
  assert.match(source,/setControlsBottom\(event.nativeEvent.layout.y\+event.nativeEvent.layout.height\)/);
  assert.doesNotMatch(source,/sheetHeight\+24|statusTop=\{140\}/);
});

test('shared person marker uses safe PlayerAvatar projection, selected identity and the exact selected-row callback',async()=>{
  const {readFileSync}=await import('node:fs'),{stripTypeScriptTypes}=await import('node:module'),{runInNewContext}=await import('node:vm');
  const source=readFileSync(new URL('../src/components/native-map.tsx',import.meta.url),'utf8');
  const personSource=source.slice(source.indexOf("{phase === 'loaded' && people"),source.indexOf("{phase === 'loaded' && venues"));
  assert.match(source,/import \{ PlayerAvatar \} from '.\/player-card.tsx'/);
  assert.match(personSource,/<PlayerAvatar[\s\S]*player=\{radarPlayer\(row\)\}/);
  assert.match(personSource,/selectedPerson === row.publicPlayerId && mapStyles.markerSelected/);
  assert.doesNotMatch(personSource,/displayName.slice|<Image|uri:/);
  const row={publicPlayerId:'peer',player:{displayName:'Игрок'}},selected:unknown[]=[];
  const callback=personSource.match(/onPress=\{(\(\) => selectPerson\(row\))\}/)![1]!;
  const press=runInNewContext(stripTypeScriptTypes(`(${callback})`),{row,selectPerson:(value:unknown)=>selected.push(value)}) as ()=>void;
  press();assert.strictEqual(selected[0],row);
});

// Execute the component's actual declarations and bound event expressions without React/SDK imports.
// Native hit delivery and pan discrimination still require the code10 device check.
async function nativeMarkerEvents() {
  const {readFileSync}=await import('node:fs'),{stripTypeScriptTypes}=await import('node:module'),{runInNewContext}=await import('node:vm');
  const source=readFileSync(new URL('../src/components/native-map.tsx',import.meta.url),'utf8');
  const evaluate=(code:string,scope:Record<string,unknown>)=>runInNewContext(stripTypeScriptTypes(code),scope);
  const binding=(tag:string,name:string,scope:Record<string,unknown>)=>{
    const start=tag.indexOf(`${name}={`);
    if(start<0) return undefined;
    const begin=start+name.length+2;
    let end=begin,depth=1;
    for(;end<tag.length && depth;end++){
      if(tag[end]==='{') depth++;
      else if(tag[end]==='}') depth--;
    }
    assert.equal(depth,0,`Unclosed ${name} binding`);
    const expression=tag.slice(begin,end-1);
    return evaluate(`(${expression})`,scope) as (event?:unknown)=>void;
  };
  const venueSource=source.slice(source.indexOf('  const activate ='),source.indexOf('/** Shared native basemap'));
  const personSource=source.slice(source.indexOf("{phase === 'loaded' && people"),source.indexOf("{phase === 'loaded' && venues"));
  const venueTag=source.split('\n').find(line=>line.includes('<VenueMarker key='))!;
  const ownerSource=source.slice(source.indexOf('  const markerOwner ='),source.indexOf('  const restart ='));
  const activeMarkers={current:null as object|null};
  let cleanup:(()=>void)|undefined, clock=now;
  const render=(input:{venues:readonly typeof venue[];people:readonly unknown[];onSelect:(id:string)=>void;onPerson:(row:unknown)=>void;phase?:string;failed?:boolean})=>{
    const callbacks=evaluate(`${ownerSource}\n({selectVenue,selectPerson});`,{
      ...input,phase:input.phase ?? 'loaded',failed:input.failed ?? false,state:{data:{}},Date:{now:()=>clock,parse:Date.parse},
      useRef:()=>activeMarkers,useEffect:(effect:()=>()=>void)=>{cleanup?.();cleanup=effect();},
    }) as {selectVenue:(id:string)=>void;selectPerson:(row:unknown)=>void};
    return {
      venue(value:typeof venue,counts:ReadonlyMap<string,number>|null){
        const scope={venue:value,counts,onSelect:binding(venueTag,'onSelect',callbacks)};
        const declarations=venueSource.slice(0,venueSource.indexOf('  return <Marker'));
        const locals=evaluate(`${declarations}\n({activate,counted});`,scope) as {activate:()=>void;counted:boolean};
        const marker=venueSource.split('\n').find(line=>line.includes('return <Marker'))!;
        const child=venueSource.slice(venueSource.indexOf('<View accessible'),venueSource.indexOf('style={[mapStyles.marker,'));
        const accessibleAction=binding(child,'onAccessibilityAction',locals)!;
        return {native:binding(marker,'onPress',locals)!,accessible:()=>accessibleAction({nativeEvent:{actionName:'activate'}}),accessibleAction,
          childPress:binding(child,'onPress',locals),childMove:binding(child,'onTouchMove',locals),childCancel:binding(child,'onTouchCancel',locals),counted:locals.counted};
      },
      person(row:unknown){
        const scope={row,...callbacks};
        const marker=personSource.split('\n')[0]!;
        const child=personSource.slice(personSource.indexOf('<View accessible'),personSource.indexOf('style={{minWidth:52'));
        const accessibleAction=binding(child,'onAccessibilityAction',scope)!;
        return {native:binding(marker,'onPress',scope)!,accessible:()=>accessibleAction({nativeEvent:{actionName:'activate'}}),accessibleAction,childPress:binding(child,'onPress',scope)};
      },
    };
  };
  return {render,unmount:()=>cleanup?.(),advance:(time:number)=>{clock=time;}};
}

test('actual plain/counted Marker bindings select the closed venue once per native tap and keep explicit accessibility activation',async()=>{
  const harness=await nativeMarkerEvents(), selected:string[]=[];
  const owner=harness.render({venues:[venue,{...venue,id:alias}],people:[],onSelect:id=>selected.push(id),onPerson:()=>assert.fail('venue selected a person')});
  const plain=owner.venue(venue,null), counted=owner.venue({...venue,id:alias},new Map([[alias,3]]));
  assert.equal(plain.counted,false);assert.equal(counted.counted,true);
  for(const marker of [plain,counted]){
    assert.equal(marker.childPress,undefined); // physical tap has just the native Marker path
    const before=selected.length;
    marker.native({nativeEvent:{id:'untrusted-event-id',lngLat:[0,0],point:[5,5]}});
    assert.equal(selected.length,before+1);
  }
  assert.deepEqual(selected,[id,alias]);
  plain.native();plain.native();counted.native(); // repeated taps and nearby distinct pins have no debounce
  assert.deepEqual(selected,[id,alias,id,id,alias]);
  plain.accessible();counted.accessible();assert.deepEqual(selected.slice(-2),[id,alias]);
  const beforeOtherAction=selected.length;
  plain.accessibleAction({nativeEvent:{actionName:'longpress'}});assert.equal(selected.length,beforeOtherAction);
  const beforePan=selected.length;
  const childGuard=markerActivation();childGuard.start(0,0);childGuard.move(20,0);childGuard.cancel();
  plain.childMove?.({nativeEvent:{pageX:20,pageY:0}});plain.childCancel?.();plain.childPress?.();
  assert.equal(childGuard.allow(),false);assert.equal(selected.length,beforePan);
  plain.native();assert.equal(selected.length,beforePan+1); // a native click does not consume child-only cancel state
});

test('actual queued marker callbacks cannot select an old marker, city, renderer, failed map or unmounted owner',async()=>{
  const harness=await nativeMarkerEvents(),selected:string[]=[];
  const input={venues:[venue],people:[],onSelect:(id:string)=>selected.push(id),onPerson:()=>{}};
  const old=harness.render(input).venue(venue,null);
  const next=harness.render({...input,venues:[{...venue,id:alias,cityId:'another-city'}]}).venue({...venue,id:alias,cityId:'another-city'},null);
  old.native();old.accessible();assert.deepEqual(selected,[]);
  next.native({nativeEvent:{id}});assert.deepEqual(selected,[alias]);
  const retry=harness.render({...input,phase:'loading'}).venue(venue,null);
  next.native();retry.native();assert.deepEqual(selected,[alias]);
  const recovered=harness.render(input).venue(venue,null);
  retry.native();recovered.native();assert.deepEqual(selected,[alias,id]);
  const failed=harness.render({...input,failed:true}).venue(venue,null);
  recovered.native();failed.native();assert.deepEqual(selected,[alias,id]);
  const removed=harness.render({...input,venues:[]}).venue(venue,null);
  removed.native();assert.deepEqual(selected,[alias,id]);
  const mounted=harness.render(input).venue(venue,null);harness.unmount();mounted.native();mounted.accessible();
  assert.deepEqual(selected,[alias,id]);
});

test('actual native/accessible people bindings reuse onPerson only for the current eligible row and unexpired window',async()=>{
  const harness=await nativeMarkerEvents(),selected:unknown[]=[];
  const row={publicPlayerId:'peer',radar:{validUntil:new Date(now+1000).toISOString()}},fresh={...row,radar:{validUntil:new Date(now+2000).toISOString()}};
  const input={venues:[],people:[row],onSelect:()=>assert.fail('person selected a venue'),onPerson:(value:unknown)=>selected.push(value)};
  const marker=harness.render(input).person(row);assert.equal(marker.childPress,undefined);
  marker.native({nativeEvent:{id:'other-player'}});assert.equal(selected.length,1);assert.strictEqual(selected[0],row);
  marker.accessible();assert.equal(selected.length,2);
  harness.advance(now+1000);marker.native();marker.accessible();assert.equal(selected.length,2);
  const current=harness.render({...input,people:[fresh]}).person(fresh);
  marker.native();current.native();assert.equal(selected.length,3);assert.strictEqual(selected[2],fresh);
  // The parent supplies this collection after its existing city/renderer/authority gates.
  const hidden=harness.render({...input,people:[]}).person(fresh);
  current.native();hidden.native();hidden.accessible();assert.equal(selected.length,3);
});
