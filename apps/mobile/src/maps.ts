import type { StyleSpecification } from '@maplibre/maplibre-react-native';
import { PublicApiError, gamesResourceKey } from './public-api.ts';
import type { PublicApi, PublicGame, GameFilters } from './public-api.ts';
import type { PublicVenue, MapVenue } from './venues.ts';
import { forbiddenUrlScalars, isVenueId, venueCreatePath } from './venues.ts';
import { cityDate, levelGuideSkillFor } from './presentation.ts';

/** Static finite regional map packs for public games/venues — #485 descriptors only. */
export type CityMapPack = {
  readonly version: string;
  readonly mapId: string;
  readonly cityId: string;
  readonly cityLabel: string;
  readonly prefix: string;
  readonly styleHash: string;
  /** Mutable MapLibre LngLat tuple — property itself stays readonly. */
  readonly center: [number, number];
  readonly bounds: [[number, number], [number, number]];
  readonly defaultZoom: number;
};

export const REGIONAL_MAP_PACKS: readonly CityMapPack[] = [
  {
    version: "novosibirsk-20261106-p4-a6ed9f64-v001",
    mapId: "novosibirsk",
    cityId: "1775016f-373e-5a15-958b-1305770b2b16",
    cityLabel: "Новосибирск",
    prefix: "https://dev.gobadminton.ru/map-assets/releases/novosibirsk-20261106-p4-a6ed9f64-v001/",
    styleHash: "a10e2b090f052e32ba47cd690d67166515083cd243cf1721d76d1bfea93b0a0c",
    center: [82.9226887, 55.0288307] as [number, number],
    bounds: [[82.1821334449726, 54.6088307], [83.66324395502738, 55.4488307]] as [[number, number], [number, number]],
    defaultZoom: 10.5,
  },
  {
    version: "yekaterinburg-20261106-p4-f6d8c8b6-v001",
    mapId: "yekaterinburg",
    cityId: "bec5831e-d6d2-59da-9d17-0c32b1eca331",
    cityLabel: "Екатеринбург",
    prefix: "https://dev.gobadminton.ru/map-assets/releases/yekaterinburg-20261106-p4-f6d8c8b6-v001/",
    styleHash: "56f1d2385152d5b156510734f81e6c5252d12b09e2fc30a8b0d5acec33b79387",
    center: [60.6007886, 56.8382071] as [number, number],
    bounds: [[59.824238913432914, 56.4182071], [61.37733828656709, 57.2582071]] as [[number, number], [number, number]],
    defaultZoom: 10.5,
  },
  {
    version: "kazan-20261106-p4-23932c53-v001",
    mapId: "kazan",
    cityId: "5c219eb1-87da-5fd3-9194-20e9d1501315",
    cityLabel: "Казань",
    prefix: "https://dev.gobadminton.ru/map-assets/releases/kazan-20261106-p4-23932c53-v001/",
    styleHash: "7ecd4d4840692e24d58a63f827fc3c76a64b42dd63a6f0c465505ccfe948829a",
    center: [49.1115022, 55.7946485] as [number, number],
    bounds: [[48.35621946126495, 55.3746485], [49.866784938735044, 56.2146485]] as [[number, number], [number, number]],
    defaultZoom: 10.5,
  },
  {
    version: "nizhny-novgorod-20261106-p4-da507726-v001",
    mapId: "nizhny-novgorod",
    cityId: "3113cbf1-c8bd-5475-9774-2e9567414f46",
    cityLabel: "Нижний Новгород",
    prefix: "https://dev.gobadminton.ru/map-assets/releases/nizhny-novgorod-20261106-p4-da507726-v001/",
    styleHash: "f9e26076f2742b2cbdb811e78f8edd433bdbb036aed46e5594d5ddfbf56cb272",
    center: [44.0051395, 56.3264816] as [number, number],
    bounds: [[43.2391977671483, 55.9064816], [44.7710812328517, 56.7464816]] as [[number, number], [number, number]],
    defaultZoom: 10.5,
  },
  {
    version: "krasnoyarsk-20261106-p4-606a2792-v001",
    mapId: "krasnoyarsk",
    cityId: "1a08b6d0-7bb8-5df5-903d-633ebc064a6e",
    cityLabel: "Красноярск",
    prefix: "https://dev.gobadminton.ru/map-assets/releases/krasnoyarsk-20261106-p4-606a2792-v001/",
    styleHash: "88c9b39de6f3e8a27afe0b36735c4bfb42173be0a0b26feb66a68304d754ae4a",
    center: [92.872586, 56.0091173] as [number, number],
    bounds: [[92.11304864302863, 55.5891173], [93.63212335697136, 56.4291173]] as [[number, number], [number, number]],
    defaultZoom: 10.5,
  },
  {
    version: "samara-20261106-p4-ac978012-v001",
    mapId: "samara",
    cityId: "2f9a0a40-b6cd-53f6-8f0d-06cfb607cd0e",
    cityLabel: "Самара",
    prefix: "https://dev.gobadminton.ru/map-assets/releases/samara-20261106-p4-ac978012-v001/",
    styleHash: "fa97fef853f911f5d8a2533c4bd537ddf78be8cbf74e9dba77cdb3ab30eb4e44",
    center: [50.1014927, 53.1956255] as [number, number],
    bounds: [[49.39346765715722, 52.7756255], [50.809517742842786, 53.6156255]] as [[number, number], [number, number]],
    defaultZoom: 10.5,
  },
  {
    version: "rostov-on-don-20261106-p4-17f21674-v001",
    mapId: "rostov-on-don",
    cityId: "38d822e9-2c2a-5969-871c-ee6da3c702da",
    cityLabel: "Ростов-на-Дону",
    prefix: "https://dev.gobadminton.ru/map-assets/releases/rostov-on-don-20261106-p4-17f21674-v001/",
    styleHash: "39945f0e37c2eefd1e47513f025df397395da261a0e14dddc5a61218f7cea9c4",
    center: [39.7198736, 47.2222596] as [number, number],
    bounds: [[39.09650395497187, 46.8022596], [40.34324324502813, 47.6422596]] as [[number, number], [number, number]],
    defaultZoom: 10.5,
  },
  {
    version: "krasnodar-20261106-p4-c9e7f371-v001",
    mapId: "krasnodar",
    cityId: "17b9f926-c927-59be-9adb-1434a971e2e4",
    cityLabel: "Краснодар",
    prefix: "https://dev.gobadminton.ru/map-assets/releases/krasnodar-20261106-p4-c9e7f371-v001/",
    styleHash: "cc71d8890be1e0bb607d12dfd3e9167bdf66daf8ec9faa3d2b5385a9d4ed7219",
    center: [38.9772396, 45.0351532] as [number, number],
    bounds: [[38.37849467884494, 44.6151532], [39.57598452115506, 45.455153200000005]] as [[number, number], [number, number]],
    defaultZoom: 10.5,
  },
  {
    version: "omsk-20261106-p4-b1be1c48-v001",
    mapId: "omsk",
    cityId: "cc3fde74-3c6d-5dc6-8e87-eb463e45ade3",
    cityLabel: "Омск",
    prefix: "https://dev.gobadminton.ru/map-assets/releases/omsk-20261106-p4-b1be1c48-v001/",
    styleHash: "a004ac255b59cefac5a6695469bf1999f92dd87d818b3f95ef62dd0edd7f811b",
    center: [73.371529, 54.991375] as [number, number],
    bounds: [[72.63167597277582, 54.571374999999996], [74.11138202722417, 55.411375]] as [[number, number], [number, number]],
    defaultZoom: 10.5,
  },
  {
    version: "voronezh-20261106-p4-01abc364-v001",
    mapId: "voronezh",
    cityId: "f89658dd-d378-593d-9ec0-b8dae693f0af",
    cityLabel: "Воронеж",
    prefix: "https://dev.gobadminton.ru/map-assets/releases/voronezh-20261106-p4-01abc364-v001/",
    styleHash: "306adabebed284539dec9c7e14113eda64df6ac2ff6f1913af82c158122c06d2",
    center: [39.2005858, 51.6605982] as [number, number],
    bounds: [[38.51716153643916, 51.2405982], [39.88401006356084, 52.080598200000004]] as [[number, number], [number, number]],
    defaultZoom: 10.5,
  },
  {
    version: "volgograd-20261106-p4-40c5114e-v001",
    mapId: "volgograd",
    cityId: "dc1f0006-1076-5e28-8608-63ecd96240eb",
    cityLabel: "Волгоград",
    prefix: "https://dev.gobadminton.ru/map-assets/releases/volgograd-20261106-p4-40c5114e-v001/",
    styleHash: "30577ab7680e866df7b8288f665765f24e61000531e46ec7d9bb2d5f014e8386",
    center: [44.5153353, 48.7081906] as [number, number],
    bounds: [[43.87349544747879, 48.2881906], [45.157175152521205, 49.1281906]] as [[number, number], [number, number]],
    defaultZoom: 10.5,
  },
];

// Closed descriptors copied from accepted WEB radar-map-assets; no remote registry.
const FIXED_PACKS: readonly CityMapPack[] = [
  { version: 'moscow-20261007-p4-098a869f-v001', mapId: 'moscow', cityId: 'a0000000-0000-4000-8000-000000000001', cityLabel: 'Москва',
    prefix: 'https://dev.gobadminton.ru/map-assets/releases/moscow-20261007-p4-098a869f-v001/', styleHash: '0ed88388e2cbc21b99425af5164430abda36b599c68f02623725779ec8ab731d', center: [37.6176,55.7517], bounds: [[36,54.5],[39.5,56.5]], defaultZoom: 10.5 },
  { version: 'saint-petersburg-20261104-p4-b7d3b1a8-v001', mapId: 'saint-petersburg', cityId: 'a0000000-0000-4000-8000-000000000002', cityLabel: 'Санкт-Петербург',
    prefix: 'https://dev.gobadminton.ru/map-assets/releases/saint-petersburg-20261104-p4-b7d3b1a8-v001/', styleHash: 'd87e1b4a28944babc70133ce9bb89dce2ccbd6ac7d5594f4691c79ccf54cb6ea', center: [30.3158,59.9391], bounds: [[27.25,58.35],[36.05,62.25]], defaultZoom: 10.5 },
];
export function mapPackForCity(id: string | null | undefined): CityMapPack | null {
  return [...FIXED_PACKS,...REGIONAL_MAP_PACKS].find(pack => pack.cityId === id) ?? null;
}
export function pointInPack(lon: number, lat: number, pack: CityMapPack): boolean {
  const [[w,s],[e,n]] = pack.bounds;
  return Number.isFinite(lon) && Number.isFinite(lat) && lon >= w && lon <= e && lat >= s && lat <= n;
}
function row(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid map style');
  return value as Record<string, unknown>;
}
/** Resolve against the verified style, then enforce the same closed pack boundary.
 * Braces must survive for native glyph/tile/sprite suffix expansion. */
export function nativeResource(value: unknown, pack: CityMapPack): string {
  if (typeof value !== 'string' || !value || forbiddenUrlScalars(value) || /[?#@%]/.test(value)) throw new Error('Unapproved map resource');
  const pmtiles = value.startsWith('pmtiles://');
  const raw = pmtiles ? value.slice(10) : value;
  const url = new URL(raw, `${pack.prefix}style-dev.json`);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !url.href.startsWith(pack.prefix)) throw new Error('Unapproved map resource');
  if (pmtiles && (!url.pathname.endsWith('.pmtiles') || /[{}]/.test(raw))) throw new Error('Invalid PMTiles archive');
  return `${pmtiles ? 'pmtiles://' : ''}${url.href.replace(/%7B/g,'{').replace(/%7D/g,'}')}`;
}
/** Called ONLY after the original byte hash is checked. Keeps layers/attribution/bounds/zoom intact. */
export function adaptNativeStyle(value: unknown, pack: CityMapPack): StyleSpecification {
  const style = row(JSON.parse(JSON.stringify(value)));
  if (style.version !== 8 || !Array.isArray(style.layers) || style.imports !== undefined) throw new Error('Unsupported map style');
  if (style.glyphs !== undefined) style.glyphs = nativeResource(style.glyphs, pack);
  if (style.sprite !== undefined) {
    style.sprite = Array.isArray(style.sprite) ? style.sprite.map(item => { const sprite = row(item); return { ...sprite, url: nativeResource(sprite.url,pack) }; }) : nativeResource(style.sprite, pack);
  }
  const sources = row(style.sources);
  let archives = 0;
  for (const source of Object.values(sources)) {
    const s = row(source);
    if (!['vector','raster','raster-dem','geojson'].includes(String(s.type))) throw new Error('Unsupported source');
    if (s.url !== undefined) {
      s.url = nativeResource(s.url,pack);
      // External TileJSON could introduce unchecked nested URLs. Approved native vector packs use PMTiles.
      if (!String(s.url).startsWith('pmtiles://https://') || s.type !== 'vector') throw new Error('Expected native PMTiles source');
      archives++;
    }
    if (s.tiles !== undefined) {
      if (!Array.isArray(s.tiles)) throw new Error('Invalid tiles');
      s.tiles = s.tiles.map(url => nativeResource(url,pack));
    }
    if (s.type === 'geojson' && typeof s.data === 'string') s.data = nativeResource(s.data,pack);
  }
  if (!archives) throw new Error('Missing PMTiles source');
  return style as unknown as StyleSpecification;
}
export type ByteDigest = (bytes: Uint8Array) => Promise<string>;
export async function verifiedNativeStyle(bytes: Uint8Array, pack: CityMapPack, digest: ByteDigest): Promise<StyleSpecification> {
  if (!bytes.length || bytes.length > 2_000_000 || await digest(bytes) !== pack.styleHash) throw new Error('Map style identity mismatch');
  // No TextDecoder dependency on a particular Hermes version; strict UTF-8 after raw-byte hashing.
  const text = decodeURIComponent(Array.from(bytes,byte => `%${byte.toString(16).padStart(2,'0')}`).join(''));
  return adaptNativeStyle(JSON.parse(text),pack);
}
export async function loadNativeStyle(pack: CityMapPack, digest: ByteDigest, signal: AbortSignal, fetcher: typeof fetch = fetch) {
  const controller = new AbortController(), abort = () => controller.abort();
  if (signal.aborted) abort();
  signal.addEventListener('abort',abort,{once:true});
  const timeout = setTimeout(abort,15000);
  try {
    const response = await fetcher(`${pack.prefix}style-dev.json`, { method: 'GET', credentials: 'omit', redirect: 'error', signal: controller.signal });
    if (!response.ok || response.redirected || response.url && response.url !== `${pack.prefix}style-dev.json`) throw new Error('Map style request failed');
    const style = await verifiedNativeStyle(new Uint8Array(await response.arrayBuffer()),pack,digest);
    if (controller.signal.aborted) throw new Error('Map style cancelled');
    return style;
  } finally { clearTimeout(timeout); signal.removeEventListener('abort',abort); }
}

export type GamesContext = { cityId?: string; day: string; activity: 'all' | 'regular' | 'trainer_led'; level: string; selectedVenue?: string; listOffset: number; origin: 'list' | 'external' };
export type RouteParams = Record<string, string | string[] | undefined>;
export function gamesContext(params: RouteParams): GamesContext | null {
  const allowed = ['view','cityId','day','activity','level','selectedVenue','listOffset','origin'];
  if (Object.keys(params).some(key => !allowed.includes(key) || Array.isArray(params[key]) || typeof params[key] === 'string' && forbiddenUrlScalars(params[key] as string))) return null;
  const cityId = params.cityId as string | undefined, day = (params.day as string) ?? '', activity = (params.activity as string) ?? 'all';
  const selectedVenue = params.selectedVenue as string | undefined, level = (params.level as string) ?? '';
  const offset = params.listOffset === undefined ? 0 : Number(params.listOffset);
  if (cityId !== undefined && !isVenueId(cityId) || selectedVenue !== undefined && !isVenueId(selectedVenue) ||
    day && (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(`${day}T00:00:00Z`)) || new Date(`${day}T00:00:00Z`).toISOString().slice(0,10) !== day) ||
    !['all','regular','trainer_led'].includes(activity) || level && !levelGuideSkillFor(level) ||
    !Number.isFinite(offset) || offset < 0 || offset > 10_000_000 || params.origin !== undefined && !['list','external'].includes(String(params.origin)) ||
    params.view !== undefined && !['map','list'].includes(String(params.view))) return null;
  return { ...(cityId ? {cityId} : {}), day, activity: activity as GamesContext['activity'], level, ...(selectedVenue ? {selectedVenue} : {}), listOffset: offset, origin: params.origin === 'list' ? 'list' : 'external' };
}
export function gamesRoute(context: GamesContext, view: 'list' | 'map'): { pathname: '/games' | '/games/map'; params: Record<string,string> } {
  return { pathname: view === 'map' ? '/games/map' : '/games', params: {
    ...(context.cityId ? {cityId:context.cityId} : {}), day: context.day, activity: context.activity, level: context.level,
    listOffset: String(context.listOffset), origin: context.origin, ...(view === 'map' && context.selectedVenue ? {selectedVenue:context.selectedVenue} : {}),
  } };
}
/** Only exact public Games links are adapted; auth callbacks keep their separate verified owner. */
export function publicGamesIntent(path: string): string | null {
  let url: URL;
  try { url = new URL(path,'https://dev.gobadminton.ru'); } catch { return '/games'; }
  if (!['/games','/games/map'].includes(url.pathname)) {
    if (url.searchParams.get('view') === 'map' || url.pathname.startsWith('/games/map/') || url.protocol !== 'https:' && url.hostname === 'games') return '/games';
    return null;
  }
  if (forbiddenUrlScalars(path) || /[%@]/.test(path) || url.origin !== 'https://dev.gobadminton.ru' || url.username || url.password || url.hash ||
    !/^(?:https:\/\/dev\.gobadminton\.ru)?\/games(?:\/map)?(?:\?[^#]*)?$/.test(path)) return '/games';
  const params: RouteParams = {};
  for (const [key,value] of url.searchParams) { if (key in params) return '/games'; params[key] = value; }
  const context = gamesContext(params);
  if (!context) return '/games';
  const route = gamesRoute({...context,origin:'external'}, params.view === 'map' || url.pathname === '/games/map' ? 'map' : 'list');
  const query = new URLSearchParams(route.params).toString();
  return `${route.pathname}?${query}`;
}
export function fullscreenGamesMap(path: string): boolean { return path === '/games/map'; }
export type MapOverlay = { filter: boolean; expanded: boolean; selected: string | null };
export function mapBack(state: MapOverlay): MapOverlay | null {
  if (state.filter) return {...state,filter:false};
  if (state.expanded) return {...state,expanded:false};
  if (state.selected) return {...state,selected:null};
  return null;
}
export function expandedVenueCreate(expanded: boolean, venue: PublicVenue | undefined): string | null {
  return expanded && venue ? venueCreatePath(venue.id) : null;
}
export function venueSheetSpacing(bottomInset: number) { return { bodyBottom: 24, footerBottom: Math.max(0,bottomInset) + 16 }; }
export type MapCamera = { center: [number,number]; zoom: number };
export function validMapCamera(camera: MapCamera | null, pack: CityMapPack): MapCamera {
  return camera && pointInPack(...camera.center,pack) && Number.isFinite(camera.zoom) && camera.zoom >= 0 && camera.zoom <= 16 ? camera : { center: [...pack.center], zoom: pack.defaultZoom };
}
/** MapLibre 11.5.1 NativeSyntheticEvent envelope; invalid updates retain the last camera. */
export function nativeMapCamera(event: unknown, pack: CityMapPack): MapCamera | null {
  if (!event || typeof event !== 'object' || !('nativeEvent' in event)) return null;
  const state = event.nativeEvent;
  if (!state || typeof state !== 'object' || !('center' in state) || !('zoom' in state)) return null;
  const {center,zoom} = state;
  if (!Array.isArray(center) || center.length !== 2 || typeof center[0] !== 'number' || typeof center[1] !== 'number' ||
    !pointInPack(center[0],center[1],pack) || typeof zoom !== 'number' || !Number.isFinite(zoom) || zoom < 0 || zoom > 16) return null;
  return {center:[center[0],center[1]],zoom};
}
export function markerActivation() {
  let origin: [number,number] | null = null, dragged = false;
  return { start(x: number,y: number) {origin=[x,y];dragged=false;}, move(x: number,y: number) {if (origin && Math.hypot(x-origin[0],y-origin[1])>5) dragged=true;}, cancel() {dragged=true;}, allow() {return !dragged;} };
}

export type MapSnapshot = { venues: MapVenue[]; games: PublicGame[] | null; aliases: ReadonlyMap<string,string>; scheduleError: boolean };
async function allPages<T extends {id:string}>(read: (cursor?: string) => Promise<{items:T[];nextCursor:string|null}>, signal: AbortSignal): Promise<T[]> {
  const items = new Map<string,T>(), used = new Set<string>();
  let cursor: string | undefined;
  do {
    if (signal.aborted) throw new Error('Cancelled');
    const page = await read(cursor);
    if (signal.aborted) throw new Error('Cancelled');
    for (const item of page.items) items.set(item.id,item);
    if (page.nextCursor !== null && (!page.nextCursor || page.nextCursor.length > 4096 || used.has(page.nextCursor))) throw new PublicApiError('invalid');
    cursor = page.nextCursor ?? undefined;
    if (cursor) used.add(cursor);
  } while (cursor);
  return [...items.values()];
}
export function mapDataKey(cityId: string, filters: GameFilters) { return `public-map:${gamesResourceKey(cityId,filters)}`; }
/** One city/filter generation owns all pages and canonical alias proofs. Partial games are never a zero count. */
export async function loadMapSnapshot(api: Pick<PublicApi,'mapVenues'|'games'|'venue'>, cityId: string, filters: GameFilters, signal: AbortSignal, now = Date.now()): Promise<MapSnapshot> {
  const [venuesResult,gamesResult] = await Promise.allSettled([
    allPages(cursor => api.mapVenues(cityId,cursor,signal),signal),
    allPages(cursor => api.games(cityId,cursor,signal,filters,now),signal),
  ]);
  if (signal.aborted) throw new Error('Cancelled');
  if (venuesResult.status === 'rejected') throw venuesResult.reason;
  const venues = venuesResult.value, aliases = new Map<string,string>();
  if (gamesResult.status === 'rejected') return {venues,games:null,aliases,scheduleError:true};
  try {
    const byId = new Map(venues.map(v => [v.id,v]));
    for (const game of gamesResult.value) {
      if (signal.aborted) throw new Error('Cancelled');
      if (game.venue.cityId !== cityId || !isVenueId(game.venue.id)) throw new PublicApiError('invalid');
      if (!byId.has(game.venue.id) && !aliases.has(game.venue.id)) {
        const bound = await api.venue(game.venue.id,signal), canonical = byId.get(bound.id);
        if (!canonical || bound.cityId !== cityId || bound.timezone !== canonical.timezone) throw new PublicApiError('invalid');
        aliases.set(game.venue.id,bound.id);
      }
      const venue = byId.get(aliases.get(game.venue.id) ?? game.venue.id)!;
      if (venue.timezone !== game.venue.timezone || venue.timezone !== game.timezone) throw new PublicApiError('invalid');
    }
    if (signal.aborted) throw new Error('Cancelled');
    return {venues,games:gamesResult.value,aliases,scheduleError:false};
  } catch (error) {
    if (signal.aborted) throw error;
    return {venues,games:null,aliases:new Map(),scheduleError:true};
  }
}
export function venueSchedules(snapshot: MapSnapshot, filters: GameFilters, now: number): Map<string,PublicGame[]> | null {
  if (snapshot.games === null) return null;
  const schedules = new Map(snapshot.venues.map(v => [v.id,[] as PublicGame[]]));
  for (const game of new Map(snapshot.games.map(g => [g.id,g])).values()) {
    if (game.status !== 'published' || game.visibility !== 'public' || game.availablePlaces <= 0 || !Number.isFinite(Date.parse(game.startsAt)) ||
      Date.parse(game.startsAt) <= now || !Number.isFinite(Date.parse(game.applicationDeadlineAt)) || Date.parse(game.applicationDeadlineAt) <= now ||
      filters.activityKind && filters.activityKind !== 'all' && game.activityKind !== filters.activityKind ||
      filters.day && cityDate(new Date(game.startsAt),game.venue.timezone) !== filters.day) continue;
    schedules.get(snapshot.aliases.get(game.venue.id) ?? game.venue.id)?.push(game);
  }
  for (const items of schedules.values()) items.sort((a,b) => Date.parse(a.startsAt)-Date.parse(b.startsAt) || a.id.localeCompare(b.id));
  return schedules;
}
export function visibleMapVenues(venues: readonly MapVenue[], counts: ReadonlyMap<string,number> | null, mode: 'all'|'with_games', pack: CityMapPack): MapVenue[] {
  return venues.filter(v => v.cityId === pack.cityId && pointInPack(v.longitude,v.latitude,pack) && (mode === 'all' || counts?.get(v.id) === undefined || counts.get(v.id)! > 0));
}
export function venueMarkerLabel(venue: Pick<MapVenue,'id'|'name'>, counts: ReadonlyMap<string,number> | null): string {
  const count = counts?.get(venue.id);
  return count === undefined ? `${venue.name}: расписание недоступно` : `${venue.name}: ${count} доступных игр`;
}
export async function resolveMapSelection(id: string, venues: readonly MapVenue[], api: Pick<PublicApi,'venue'>, signal: AbortSignal): Promise<MapVenue> {
  const exact = venues.find(v => v.id === id);
  if (exact) return exact;
  const bound = await api.venue(id,signal), canonical = venues.find(v => v.id === bound.id);
  if (signal.aborted || !canonical || canonical.cityId !== bound.cityId || canonical.timezone !== bound.timezone) throw new PublicApiError('invalid');
  return canonical;
}
