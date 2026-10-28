import { Children, isValidElement } from "react";
import type * as React from "react";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { UnifiedPreview, UnifiedRow, UnifiedSnapshot } from "@gobadminton/contracts";
import type { Map as LibreMap } from "maplibre-gl";
import type { Me } from "../src/lib/consumer-types";
import { UnifiedDirectoryController } from "../src/lib/unified-directory";
import type { apiFetch } from "../src/lib/api-client";
import { MOSCOW_BUNDLE } from "../src/lib/radar-map-assets";
import { RadarPage } from "../src/components/consumer/radar/RadarPage";
import { UnifiedPlayerPreview } from "../src/components/consumer/radar/UnifiedPlayerPreview";
import { PublicPlayerProfile } from "../src/components/consumer/players/PublicPlayerProfile";
import { VenuePopup } from "../src/components/consumer/games/VenuePopup";

const hooks = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, effects: [] as (() => void)[], cleanups: [] as (() => void)[] }));
const context = vi.hoisted(() => ({ directory: null as unknown, session: null as unknown, config: null as unknown }));
vi.mock("react", async original => ({ ...await original<typeof React>(),
  useState<T>(initial: T) {
    const i = hooks.cursor++; const slots = hooks.slots;
    if (!(i in slots)) slots[i] = initial;
    // Capture this fiber's slots; callbacks must not mutate another render's storage.
    return [slots[i], (next: T | ((value: T) => T)) => { slots[i] = typeof next === "function" ? (next as (value: T) => T)(slots[i] as T) : next; }];
  },
  useRef(initial: unknown) { const i=hooks.cursor++; return hooks.slots[i] ??= { current: initial }; },
  useMemo(fn:()=>unknown,deps:unknown[]) { const i=hooks.cursor++,old=hooks.slots[i] as {deps:unknown[];value:unknown}|undefined; if(!old||deps.some((v,n)=>v!==old.deps[n]))hooks.slots[i]={deps,value:fn()};return (hooks.slots[i] as {value:unknown}).value; },
  useCallback(fn: unknown, deps: unknown[]) {
    const i = hooks.cursor++; const old = hooks.slots[i] as { deps: unknown[]; fn: unknown } | undefined;
    if (!old || deps.some((v, n) => v !== old.deps[n])) hooks.slots[i] = { deps, fn };
    return (hooks.slots[i] as { fn: unknown }).fn;
  },
  useContext(context: { _currentValue: unknown }) { return context._currentValue; },
  useEffect(effect:()=>void|(()=>void),deps:unknown[]) {
    const i=hooks.cursor++,old=hooks.slots[i] as unknown[]|undefined;
    if(!old||deps.some((v,n)=>v!==old[n])){hooks.slots[i]=deps;hooks.effects.push(()=>{hooks.cleanups[i]?.();hooks.cleanups[i]=effect()||(()=>{});});}
  },
}));
vi.mock("next/link",()=>({default:({href,children}:{href:string;children:ReactNode})=><a href={href}>{children}</a>}));
vi.mock("next/dynamic",()=>({default:()=>function MapLayer(){return null;}}));
vi.mock("../src/components/consumer/radar/RadarSessionProvider",()=>({
  useUnifiedDirectory:()=>context.directory,useRadarSession:()=>context.session,useRadarConfig:()=>context.config,
  useDirectoryFilters:()=>({filters:{cityId:"a0000000-0000-4000-8000-000000000001",areaKey:"",name:"",lookingOnly:false,trainerOnly:false}}),RadarStatusAffordance:()=>null,
}));
vi.mock("../src/components/consumer/radar/RadarContact",()=>({RadarContact:()=>null}));
vi.mock("../src/lib/api-client", async importOriginal => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getMe: vi.fn(async () => ({ ok: true, status: 200, data: { id: "viewer", csrfToken: "csrf", displayName: "Viewer", locale: "ru", linkedProviders: [] } })),
    getPlayer: vi.fn(async () => ({ ok: true, status: 200, data: {
      publicPlayerId: "peer", displayName: "Игрок", cityId: "a0000000-0000-4000-8000-000000000001", areaKey: null, level: null,
      bio: null, trainer: false, lookingForGame: false, avatar: { uploadedUrl: null, providerUrl: null }, canRequestContact: false,
    } })),
    listCities: vi.fn(async () => ({ ok: true, status: 200, data: { items: [] } })),
    createAbuseReport: vi.fn(), putMyBlock: vi.fn(), deleteMyBlock: vi.fn(),
  };
});
vi.mock("../src/components/consumer/friends/ProfileFriendship", () => ({ ProfileFriendship: () => null }));
vi.mock("../src/components/consumer/players/ContactAction", () => ({
  useContactState: () => null,
  ContactAction: () => null,
  ContactNote: () => null,
}));
const now=Date.parse("2030-01-01T00:00:00Z"), until=new Date(now+45000).toISOString();
const row:UnifiedRow={publicPlayerId:"peer",projection:"directory",player:{publicPlayerId:"peer",displayName:"Игрок",cityId:MOSCOW_BUNDLE.cityId,areaKey:null,level:null,trainer:false,lookingForGame:false,avatar:{uploadedUrl:null,providerUrl:null},canRequestContact:false},
  radar:{resultId:"r",resultRef:"private-proof",consentPolicyVersion:"radar-geographic-sharing-v2",validUntil:until,distance:null,geo:{latitude:55.75,longitude:37.6,crs:"EPSG:4326",model:"regional_grid_100m_v1",gridSizeMeters:100,uncertaintyMeters:100,quality:"approximate",sourceTimestampBucket:new Date(now).toISOString(),sourceAgeSeconds:0}}};
// D1: complete UnifiedSnapshot, without assertion casts hiding missing totals.
const snapshot:UnifiedSnapshot={contractVersion:"players-unified-radar-v1",policyVersion:"radar-geographic-sharing-v2",exposureMode:"synthetic_demo",cityId:MOSCOW_BUNDLE.cityId,regionId:"moscow",generatedAt:new Date(now).toISOString(),validUntil:until,refreshAfterSeconds:30,
  query:{queryRef:"q",asOf:new Date(now).toISOString(),ordering:"radar_city_then_directory",originState:"none",originRef:null},
  totals:{matchingTotal:1,radarTotal:1,ordinaryOnlyTotal:0,completeness:"exact_at_asOf"},map:{availability:"missing",mapId:null,version:null},items:[row],page:{returnedCount:1,rankStart:1,rankEnd:1,hasMore:false,nextCursor:null}};
const preview:UnifiedPreview={player:{publicPlayerId:"peer",displayName:"Игрок",level:null,trainer:false,avatar:{uploadedUrl:null,providerUrl:null},canRequestContact:false},proximityBand:null,
  radar:{consentPolicyVersion:row.radar!.consentPolicyVersion,geo:row.radar!.geo,validUntil:until,distance:null},upcomingGames:[{id:"g",title:"Разрешённая игра",activityKind:"regular",startsAt:new Date(now+86400000).toISOString(),endsAt:new Date(now+90000000).toISOString(),timezone:"Europe/Moscow",cover:{uploadedUrl:null},venue:{name:"Зал",cover:{uploadedUrl:null}}}]};
type Node=React.ReactElement<Record<string,unknown>>;
function nodes(tree:ReactNode):Node[]{const found:Node[]=[];function walk(node:ReactNode){if(!isValidElement<Record<string,unknown>>(node))return;found.push(node);Children.forEach(node.props.children as ReactNode,walk);if("preview" in node.props)walk(node.props.preview as ReactNode);}walk(tree);return found;}
function activate(tree:ReactNode,label:string){const node=nodes(tree).find(n=>n.props.children===label||n.props["aria-label"]===label);if(!node)throw Error(`Missing ${label}`);(node.props.onClick as ()=>void)();}
const trigger={isConnected:true,focus:vi.fn()}, sheet={focus:vi.fn()};
let controller:UnifiedDirectoryController;
const request=vi.fn();
beforeEach(async()=>{
  hooks.slots=[];hooks.cursor=0;hooks.effects=[];hooks.cleanups=[];trigger.focus.mockClear();sheet.focus.mockClear();request.mockReset();
  vi.useFakeTimers();vi.setSystemTime(now);
  const stack:Record<string,unknown>[]=[{}];
  const history={
    stack,
    get state(){return stack.at(-1)??{};},
    pushState:vi.fn((state:Record<string,unknown>)=>{stack.push({...(stack.at(-1)??{}),...state});}),
    back:vi.fn(()=>{if(stack.length>1)stack.pop();else stack[0]={};window.dispatchEvent(new Event("popstate"));}),
  };
  vi.stubGlobal("window",Object.assign(new EventTarget(),{location:{origin:"https://dev.gobadminton.ru",href:"https://dev.gobadminton.ru/games?view=map"},history,
    setTimeout,clearTimeout,getComputedStyle:()=>({visibility:"visible"}),matchMedia:()=>({matches:false,addEventListener:()=>{},removeEventListener:()=>{}})}));
  vi.stubGlobal("document",Object.assign(new EventTarget(),{activeElement:trigger,querySelector:()=>null,body:{style:{overflow:""}},visibilityState:"visible"}));
  vi.stubGlobal("requestAnimationFrame",(fn:()=>void)=>fn());
  request.mockImplementation(async(path:string)=>({ok:true,status:200,data:path.endsWith("/preview")?preview:path.endsWith("/map")?{...snapshot,mapPage:{returnedCount:1,rankStart:1,rankEnd:1,hasMore:false,nextMapCursor:null}}:snapshot}));
  controller=new UnifiedDirectoryController(request as typeof apiFetch,Date.now);controller.bind({id:"viewer",csrfToken:"csrf"} as Me);await controller.query({cityId:MOSCOW_BUNDLE.cityId});await controller.map();await controller.select(controller.view.pins[0]!);
  context.session={view:{me:{id:"viewer",csrfToken:"csrf",displayName:"Viewer"},phase:"off",confirmedOn:false,pendingStop:false}};
  context.config={exposureMode:"live",unifiedDirectory:{enabled:true},cities:[{cityId:MOSCOW_BUNDLE.cityId,map:{availability:"dev_preview",mapId:"moscow",version:MOSCOW_BUNDLE.version}}]};
});
afterEach(()=>{hooks.cleanups.forEach(fn=>fn?.());controller.dispose();vi.unstubAllGlobals();vi.useRealTimers();});
function render<T>(fn:()=>T){context.directory={controller,view:controller.view};hooks.cursor=0;const tree=fn();for(const node of nodes(tree as ReactNode)){if(node.type==="aside"&&(node.props.ref as {current:unknown}|undefined)) (node.props.ref as {current:unknown}).current=sheet;}hooks.effects.splice(0).forEach(fn=>fn());return tree;}
function card(expanded=false){return render(()=>UnifiedPlayerPreview({expanded,onClose:()=>controller.close()}));}
it("renders compact -> expanded profile; games stay an internal sheet view",()=>{
  const expand=vi.fn();let tree=render(()=>UnifiedPlayerPreview({expanded:false,onExpandedChange:expand,onClose:()=>controller.close()}));
  const html=renderToStaticMarkup(tree);
  expect(html).toContain('data-preview-mode="compact"');
  expect(html).toContain("unified-preview__compact");
  expect(html).toContain("radar-player-preview");
  expect(html).toContain("Подробнее об игроке");
  expect(html).not.toContain("Разрешённая игра");
  expect(html).not.toContain("unified-preview__expanded");
  expect(html).not.toContain("/players/peer");
  activate(tree,"Подробнее об игроке");expect(expand).toHaveBeenCalledWith(true);
  tree=card(true);
  const expanded=renderToStaticMarkup(tree);
  expect(expanded).toContain('data-preview-mode="expanded"');
  expect(expanded).toContain('data-player-view="profile"');
  expect(expanded).toContain("unified-preview__expanded");
  expect(nodes(tree).some(n => n.type === PublicPlayerProfile)).toBe(true);
  const shared = nodes(tree).find(n => n.type === PublicPlayerProfile)!;
  expect(shared.props.publicPlayerId).toBe("peer");
  expect(shared.props.embedded).toBe(true);
  expect(shared.props.distance).toBeTruthy();
  expect(expanded).toContain("Ближайшие публичные игры");
  expect(expanded).not.toContain("Разрешённая игра");
  expect(expanded).toContain('aria-label="Свернуть карточку игрока"');
  expect(expanded).not.toContain(">Свернуть карточку<");
  expect(expanded).not.toContain("Приблизительное положение");
  expect(expanded).not.toContain("Подробнее об игроке");
  expect(expanded).not.toContain("/players/peer");
  activate(tree,"Ближайшие публичные игры");
  tree=card(true);
  const games=renderToStaticMarkup(tree);
  expect(games).toContain('data-player-view="games"');
  expect(games).toContain("Разрешённая игра");
  expect(games).toContain("Открыть игру");
  expect(games).toContain('href="/games/g"');
  activate(tree,`Назад к профилю ${preview.player.displayName}`);
  tree=card(true);
  expect(renderToStaticMarkup(tree)).toContain('data-player-view="profile"');
  expect(renderToStaticMarkup(tree)).not.toContain("Разрешённая игра");
  tree=card(false);expect(renderToStaticMarkup(tree)).not.toContain("Разрешённая игра");
  expect(renderToStaticMarkup(tree)).toContain('data-preview-mode="compact"');
});
it("keeps honest empty games state inside internal games view",()=>{
  controller.view={...controller.view,preview:{...preview,upcomingGames:[]}};
  let tree=card(true);
  activate(tree,"Ближайшие публичные игры");
  tree=card(true);
  const html=renderToStaticMarkup(tree);
  expect(html).toContain('data-player-view="games"');
  expect(html).toContain("Нет доступных ближайших публичных игр");
  expect(html).not.toContain("Разрешённая игра");
  expect(html).not.toContain("124 игры");
});
it("distinguishes API loading, error with retry, and authorized empty",async()=>{
  controller.view={...controller.view,preview:null,previewBusy:true};expect(renderToStaticMarkup(card(true))).toContain("Проверяем доступность");
  request.mockResolvedValueOnce({ok:false,status:503,error:"unavailable"});await controller.select(controller.view.pins[0]!);
  let tree=card(true);expect(renderToStaticMarkup(tree)).toContain("Повторить");expect(renderToStaticMarkup(tree)).not.toContain("Нет доступных ближайших");
  request.mockResolvedValueOnce({ok:true,status:200,data:{...preview,upcomingGames:[]}});activate(tree,"Повторить");await Promise.resolve();await Promise.resolve();
  tree=card(true);
  activate(tree,"Ближайшие публичные игры");
  tree=card(true);
  expect(renderToStaticMarkup(tree)).toContain("Нет доступных ближайших публичных игр");expect(renderToStaticMarkup(tree)).not.toContain("Разрешённая игра");
});
it("Escape clears real private selection and schedules",()=>{
  const tree=card(true);const e={key:"Escape",preventDefault:vi.fn(),stopPropagation:vi.fn()};(tree!.props.onKeyDown)(e);
  expect(controller.view.selected).toBeNull();expect(controller.view.preview).toBeNull();expect(e.preventDefault).toHaveBeenCalledOnce();
});
it("rejects expired or mismatched retained preview at render time",()=>{
  controller.view={...controller.view,preview:{...preview,player:{...preview.player,publicPlayerId:"other"}}};expect(card(true)).toBeNull();
  controller.view={...controller.view,preview};vi.setSystemTime(now+45000);expect(card(true)).toBeNull();
});
const map={getCanvas:()=>({setAttribute:vi.fn(),removeAttribute:vi.fn(),addEventListener:vi.fn(),removeEventListener:vi.fn()}),on:vi.fn(),off:vi.fn()} as unknown as LibreMap;
function page(){return render(()=>RadarPage({sharedMap:map}));}
it("uses VenuePopup shell over shared map; no g2-map-panel sidebar for selected player",()=>{
  page();let tree=page();
  const popup=nodes(tree).find(n=>n.type===VenuePopup)!;
  expect(popup).toBeDefined();
  expect(popup.props.expanded).toBe(false);
  expect(popup.props.labels).toMatchObject({dialog:"Выбранный игрок"});
  const previews=nodes(tree).filter(n=>n.type===UnifiedPlayerPreview);
  expect(previews.some(n=>n.props.surface==="compact")).toBe(true);
  expect(previews.some(n=>n.props.surface==="detail")).toBe(true);
  expect(nodes(tree).some(n=>n.props.children==="На карте: 1 из 1")).toBe(true);
  expect(nodes(tree).some(n=>n.type==="aside")).toBe(false);
  (popup.props.onExpandedChange as (value:boolean)=>void)(true);tree=page();
  expect(nodes(tree).find(n=>n.type===VenuePopup)!.props.expanded).toBe(true);
  const layer=nodes(tree).find(n=>n.props.sharedMap===map)!;expect(layer).toBeDefined();
  expect(nodes(tree).some(n=>n.type==="main")).toBe(false);
  expect(map).toBe(layer.props.sharedMap);
});
for(const action of ["close","Escape","back"] as const) it(`${action} restores focus and clears Page selection without navigating away`,()=>{
  controller.close();page();const initial=page();
  const layer=nodes(initial).find(n=>n.props.sharedMap===map)!;
  (layer.props.onSelect as (row:UnifiedRow)=>void)(controller.view.pins[0]!);
  const tree=page();
  if(action==="back")window.history.back();
  else (nodes(tree).find(n=>n.type===VenuePopup)!.props.onDeselect as ()=>void)();
  page();expect(controller.view.selected).toBeNull();expect(controller.view.preview).toBeNull();expect(trigger.focus).toHaveBeenCalled();expect(window.location.href).toContain("/games?view=map");
});
