import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { URL } from 'node:url';
import { adaptNativeStyle, expandedVenueCreate, gamesContext, gamesRoute, loadMapSnapshot, loadNativeStyle, mapBack, mapDataKey, mapPackForCity, markerActivation, nativeMapCamera, nativeResource, publicGamesIntent, resolveMapSelection, validMapCamera, venueMarkerLabel, venueSchedules, verifiedNativeStyle, visibleMapVenues } from '../src/maps.ts';
import { createPublicApi } from '../src/public-api.ts';
import type { MapSnapshot, MapOverlay } from '../src/maps.ts';
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
  const pushes:unknown[]=[], returns:unknown[]=[], listOffset={current:0};
  const onScroll=listSource.match(/onScroll=\{(.+)\} scrollEventThrottle/)![1]!;
  const scroll=runInNewContext(`(${stripTypeScriptTypes(onScroll)})`,{listOffset}) as (event:unknown)=>void;
  scroll({nativeEvent:{contentOffset:{y:735}}});assert.equal(listOffset.current,735);
  const open=listSource.match(/const openMap = (.+);/)![1]!;
  const openMap=runInNewContext(`(${stripTypeScriptTypes(open)})`,{cityId:pack.cityId,day:context.day,activityKind:context.activity,level:'',listOffset,gamesRoute,router:{push:(route:unknown)=>pushes.push(route)}}) as ()=>void;
  openMap();assert.equal(pushes.length,1);
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
