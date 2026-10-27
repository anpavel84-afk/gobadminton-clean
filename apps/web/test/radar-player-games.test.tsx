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
function nodes(tree:ReactNode):Node[]{const found:Node[]=[];function walk(node:ReactNode){if(!isValidElement<Record<string,unknown>>(node))return;found.push(node);Children.forEach(node.props.children as ReactNode,walk);}walk(tree);return found;}
function activate(tree:ReactNode,label:string){const node=nodes(tree).find(n=>n.props.children===label||n.props["aria-label"]===label);if(!node)throw Error(`Missing ${label}`);(node.props.onClick as ()=>void)();}
const listeners=new Map<string,Set<()=>void>>();
const trigger={isConnected:true,focus:vi.fn()}, sheet={focus:vi.fn()};
let controller:UnifiedDirectoryController;
const request=vi.fn();
beforeEach(async()=>{
  hooks.slots=[];hooks.cursor=0;hooks.effects=[];hooks.cleanups=[];listeners.clear();trigger.focus.mockClear();sheet.focus.mockClear();request.mockReset();
  vi.useFakeTimers();vi.setSystemTime(now);
  const history:{state:Record<string,unknown>;pushState:(state:Record<string,unknown>)=>void;back:()=>void}={state:{},pushState:vi.fn((state:Record<string,unknown>)=>{history.state=state;}),back:vi.fn(()=>{history.state={};listeners.get("popstate")?.forEach(fn=>fn());})};
  vi.stubGlobal("window",{location:{origin:"https://dev.gobadminton.ru",href:"https://dev.gobadminton.ru/games?view=map"},history,
    addEventListener:(name:string,fn:()=>void)=>{if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name)!.add(fn);},removeEventListener:(name:string,fn:()=>void)=>listeners.get(name)?.delete(fn),setTimeout,clearTimeout});
  vi.stubGlobal("document",{activeElement:trigger,querySelector:()=>null,body:{style:{overflow:""}}});
  vi.stubGlobal("requestAnimationFrame",(fn:()=>void)=>fn());
  request.mockImplementation(async(path:string)=>({ok:true,status:200,data:path.endsWith("/preview")?preview:path.endsWith("/map")?{...snapshot,mapPage:{returnedCount:1,rankStart:1,rankEnd:1,hasMore:false,nextMapCursor:null}}:snapshot}));
  controller=new UnifiedDirectoryController(request as typeof apiFetch,Date.now);controller.bind({id:"viewer",csrfToken:"csrf"} as Me);await controller.query({cityId:MOSCOW_BUNDLE.cityId});await controller.map();await controller.select(controller.view.pins[0]!);
  context.session={view:{me:{id:"viewer",csrfToken:"csrf",displayName:"Viewer"},phase:"off",confirmedOn:false,pendingStop:false}};
  context.config={exposureMode:"live",unifiedDirectory:{enabled:true},cities:[{cityId:MOSCOW_BUNDLE.cityId,map:{availability:"dev_preview",mapId:"moscow",version:MOSCOW_BUNDLE.version}}]};
});
afterEach(()=>{hooks.cleanups.forEach(fn=>fn?.());controller.dispose();vi.unstubAllGlobals();vi.useRealTimers();});
function render<T>(fn:()=>T){context.directory={controller,view:controller.view};hooks.cursor=0;const tree=fn();for(const node of nodes(tree as ReactNode)){if(node.type==="aside"&&(node.props.ref as {current:unknown}|undefined)) (node.props.ref as {current:unknown}).current=sheet;}hooks.effects.splice(0).forEach(fn=>fn());return tree;}
function card(expanded=false){return render(()=>UnifiedPlayerPreview({expanded,onClose:()=>controller.close()}));}
it("renders compact -> expanded -> collapsed actual preview without profile navigation",()=>{
  const expand=vi.fn();let tree=render(()=>UnifiedPlayerPreview({expanded:false,onExpandedChange:expand,onClose:()=>controller.close()}));
  const html=renderToStaticMarkup(tree);expect(html).toContain("Подробнее об игроке");expect(html).not.toContain("Разрешённая игра");expect(html).not.toContain("/players/peer");
  activate(tree,"Подробнее об игроке");expect(expand).toHaveBeenCalledWith(true);
  tree=card(true);expect(renderToStaticMarkup(tree)).toContain("Разрешённая игра");expect(renderToStaticMarkup(tree)).toContain('href="/games/g"');
  tree=card(false);expect(renderToStaticMarkup(tree)).not.toContain("Разрешённая игра");
});
it("distinguishes API loading, error with retry, and authorized empty",async()=>{
  controller.view={...controller.view,preview:null,previewBusy:true};expect(renderToStaticMarkup(card(true))).toContain("Проверяем доступность");
  request.mockResolvedValueOnce({ok:false,status:503,error:"unavailable"});await controller.select(controller.view.pins[0]!);
  let tree=card(true);expect(renderToStaticMarkup(tree)).toContain("Повторить");expect(renderToStaticMarkup(tree)).not.toContain("Нет доступных ближайших");
  request.mockResolvedValueOnce({ok:true,status:200,data:{...preview,upcomingGames:[]}});activate(tree,"Повторить");await Promise.resolve();await Promise.resolve();
  tree=card(true);expect(renderToStaticMarkup(tree)).toContain("Нет доступных ближайших публичных игр");expect(renderToStaticMarkup(tree)).not.toContain("Разрешённая игра");
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
it("uses complete totals and controlled expansion over the same shared map with no dialog",()=>{
  page();let tree=page();const child=nodes(tree).find(n=>n.type===UnifiedPlayerPreview)!;expect(child).toBeDefined();expect(child.props.dialog).toBeUndefined();expect(child.props.expanded).toBe(false);
  const layer=nodes(tree).find(n=>n.props.sharedMap===map)!;expect(layer).toBeDefined();expect(nodes(tree).some(n=>n.props.children==="На карте: 1 из 1")).toBe(true);
  activate(tree,"Развернуть карточку");tree=page();expect(nodes(tree).find(n=>n.type===UnifiedPlayerPreview)!.props.expanded).toBe(true);
  expect(nodes(tree).find(n=>n.props.sharedMap===map)!.type).toBe(layer.type);expect(nodes(tree).some(n=>n.type==="main")).toBe(false);
});
for(const action of ["close","Escape","back"] as const) it(`${action} restores focus and clears Page selection without navigating away`,()=>{
  controller.close();page();const initial=page();
  const layer=nodes(initial).find(n=>n.props.sharedMap===map)!;
  (layer.props.onSelect as (row:UnifiedRow)=>void)(controller.view.pins[0]!);
  const tree=page();
  if(action==="close")activate(tree,"Закрыть карточку игрока");
  else if(action==="back")window.history.back();
  else (nodes(tree).find(n=>n.type==="aside")!.props.onKeyDown as (e:unknown)=>void)({key:"Escape",target:{closest:()=>null},stopPropagation:vi.fn()});
  page();expect(controller.view.selected).toBeNull();expect(controller.view.preview).toBeNull();expect(trigger.focus).toHaveBeenCalled();expect(window.location.href).toContain("/games?view=map");
});
