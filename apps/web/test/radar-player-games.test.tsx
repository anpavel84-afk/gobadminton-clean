import { Children, isValidElement } from "react";
import type * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Map as LibreMap } from "maplibre-gl";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { UnifiedPreview, UnifiedRow, UnifiedSnapshot } from "@gobadminton/contracts";
import type { DirectoryView } from "../src/lib/unified-directory";
import { MOSCOW_BUNDLE } from "../src/lib/radar-map-assets";
import { RadarPage } from "../src/components/consumer/radar/RadarPage";
import { UnifiedPlayerPreview } from "../src/components/consumer/radar/UnifiedPlayerPreview";
import { CloseButton } from "../src/components/consumer/CloseButton";

// Only local hook storage, as in venue-preview-card.test.tsx; no renderer or DOM framework.
const hooks=vi.hoisted(()=>({slots:[] as unknown[],cursor:0,effects:[] as (()=>void)[],cleanups:[] as (()=>void)[]}));
const context=vi.hoisted(()=>({directory:{} as Record<string,unknown>, session:{} as Record<string,unknown>, config:{} as Record<string,unknown>}));
vi.mock("react",async original=>({
  ...await original<typeof React>(),
  useState<T>(initial:T) { const i=hooks.cursor++; if(!(i in hooks.slots))hooks.slots[i]=initial; return [hooks.slots[i],(next:T|((old:T)=>T))=>{hooks.slots[i]=typeof next==='function'?(next as (old:T)=>T)(hooks.slots[i] as T):next;}]; },
  useRef(initial:unknown) { const i=hooks.cursor++; return hooks.slots[i]??={current:initial}; },
  useMemo(fn:()=>unknown,deps:unknown[]) { const i=hooks.cursor++,old=hooks.slots[i] as {deps:unknown[];value:unknown}|undefined;if(!old||deps.some((v,n)=>v!==old.deps[n]))hooks.slots[i]={deps,value:fn()};return (hooks.slots[i] as {value:unknown}).value; },
  useEffect(fn:()=>void|(()=>void),deps:unknown[]) { const i=hooks.cursor++,old=hooks.slots[i] as unknown[]|undefined;if(!old||deps.some((v,n)=>v!==old[n])){hooks.slots[i]=deps;hooks.effects.push(()=>{hooks.cleanups[i]?.();hooks.cleanups[i]=fn()||(()=>{});});} },
}));
vi.mock("next/link",()=>({default:({href,children}:{href:string;children:React.ReactNode})=><a href={href}>{children}</a>}));
vi.mock("next/dynamic",()=>({default:()=>function MapLayer(){return <div data-map-layer="same-map"/>;}}));
vi.mock("../src/components/consumer/games/GamesMapView",()=>({GamesMapView:()=> <div data-basemap/>}));
vi.mock("../src/components/consumer/games/GamesMapViewport",()=>({GamesMapViewport:({children}:{children:React.ReactNode})=><div>{children}</div>}));
vi.mock("../src/components/consumer/radar/RadarContact",()=>({RadarContact:()=> <div data-contact/>}));
vi.mock("../src/components/consumer/radar/RadarSessionProvider",()=>({
  useUnifiedDirectory:()=>context.directory,useRadarSession:()=>({view:context.session}),useRadarConfig:()=>context.config,
  useDirectoryFilters:()=>({filters:{cityId:MOSCOW_BUNDLE.cityId,areaKey:"",name:"",lookingOnly:false,trainerOnly:false}}),
  RadarStatusAffordance:()=>null,
}));
const now=Date.parse('2030-01-01T00:00:00Z');
const pin=(name='Player A')=>({publicPlayerId:name,projection:'directory',player:{publicPlayerId:name,displayName:name,avatar:{uploadedUrl:null,providerUrl:null},level:null,trainer:false,canRequestContact:false},radar:{resultRef:`u1.${name}`,resultId:name,validUntil:new Date(now+45000).toISOString(),distance:null,geo:{uncertaintyMeters:100,sourceAgeSeconds:2,quality:'approximate'}}}) as UnifiedRow;
const payload=(p:UnifiedRow)=>({player:p.player,proximityBand:null,radar:{...p.radar,consentPolicyVersion:'radar-geographic-sharing-v2'},upcomingGames:[{id:'00000000-0000-4000-8000-000000000001',title:'From API',activityKind:'regular',startsAt:'2030-01-01T01:00:00Z',endsAt:'2030-01-01T02:00:00Z',timezone:'Europe/Moscow',cover:{uploadedUrl:`/v1/media/game-covers/${'a'.repeat(64)}.png`},venue:{name:'API hall',cover:{uploadedUrl:null}}}]}) as UnifiedPreview;
let view:DirectoryView;
let trigger:{isConnected:boolean;focus:ReturnType<typeof vi.fn>};
let controller:{close:ReturnType<typeof vi.fn>;select:ReturnType<typeof vi.fn>;matches:ReturnType<typeof vi.fn>;snapshot:()=>DirectoryView;map:ReturnType<typeof vi.fn>;tick:ReturnType<typeof vi.fn>};
function elements(node:React.ReactNode):React.ReactElement<Record<string,unknown>>[] {
  if(!isValidElement<Record<string,unknown>>(node))return [];
  return [node,...Children.toArray(node.props.children as React.ReactNode).flatMap(elements)];
}
function scope<T>(fn:()=>T) {
  const saved={...hooks};hooks.slots=[];hooks.cursor=0;hooks.effects=[];hooks.cleanups=[];
  try{return fn();}finally{Object.assign(hooks,saved);}
}
const markup=(node:React.ReactNode)=>scope(()=>renderToStaticMarkup(node));
function pageHarness() {
  const canvas=new EventTarget();const map={getCanvas:()=>Object.assign(canvas,{setAttribute:vi.fn(),removeAttribute:vi.fn(),focus:vi.fn()}),on:vi.fn(),off:vi.fn()} as unknown as LibreMap;
  const slots:unknown[]=[],cleanups:(()=>void)[]=[];
  const render=()=>{
    const saved={...hooks};Object.assign(hooks,{slots,cleanups,cursor:0,effects:[]});
    const tree=RadarPage({sharedMap:map});
    elements(tree).forEach(node=>{const ref=node.props.ref as {current:unknown}|undefined;if(ref)ref.current={focus:vi.fn()};});
    hooks.effects.splice(0).forEach(fn=>fn());Object.assign(hooks,saved);return tree;
  };
  render();render();
  const child=()=>elements(render()).find(node=>node.type===UnifiedPlayerPreview)!;
  const layer=()=>elements(render()).find(node=>node.props.sharedMap===map)!;
  return {render,child,layer,map,dispose:()=>cleanups.forEach(fn=>fn?.())};
}
beforeEach(()=>{
  vi.useFakeTimers();vi.setSystemTime(now);hooks.slots=[];hooks.cursor=0;hooks.effects=[];hooks.cleanups=[];
  trigger={isConnected:true,focus:vi.fn()};
  const windowStub=new EventTarget();
  const history={state:{} as Record<string,unknown>,pushState:vi.fn((state:Record<string,unknown>)=>{history.state=state;}),back:vi.fn(()=>{history.state={};windowStub.dispatchEvent(new Event('popstate'));})};
  vi.stubGlobal('window',Object.assign(windowStub,{location:{origin:'https://dev.gobadminton.ru',href:'https://dev.gobadminton.ru/map'},history,setTimeout,clearTimeout}));
  vi.stubGlobal('document',{activeElement:trigger,body:{style:{overflow:''}},querySelector:()=>null});
  vi.stubGlobal('requestAnimationFrame',(fn:()=>void)=>{fn();return 1;});
  const p=pin();view={mode:'unified',snapshot:{validUntil:new Date(now+45000).toISOString(),query:{queryRef:'private'}} as UnifiedSnapshot,rows:[p],pins:[p],mapPage:{nextMapCursor:null} as DirectoryView['mapPage'],selected:null,preview:null,previewBusy:false,previewError:'',busy:false,notice:'',stale:false,capabilityUnavailable:false,authenticationRequired:false};
  controller={close:vi.fn(()=>{view.selected=null;view.preview=null;}),select:vi.fn(async(row:UnifiedRow)=>{view.selected=row.publicPlayerId;view.preview=payload(row);}),matches:vi.fn(()=>true),snapshot:()=>view,map:vi.fn(),tick:vi.fn()};
  context.directory={view,controller};context.session={phase:'active',confirmedOn:true,pendingStop:false,me:{id:'viewer',csrfToken:'csrf'},status:{state:'active',contractVersion:'players-unified-radar-v1',activationId:'activation',version:1,coarseCenter:{latitude:55.75,longitude:37.61}}};
  context.config={exposureMode:'live',unifiedDirectory:{enabled:true},cities:[{cityId:MOSCOW_BUNDLE.cityId,map:{availability:'dev_preview',version:MOSCOW_BUNDLE.version,mapId:'moscow'}}]};
});
afterEach(()=>{hooks.cleanups.forEach(fn=>fn?.());vi.useRealTimers();vi.unstubAllGlobals();});
it('marker selection expands/collapses over the same map element with real API rows and approved cover',async()=>{
  const h=pageHarness(),before=h.layer();
  await (before.props.onSelect as (row:UnifiedRow)=>Promise<void>)(view.pins[0]!);h.render();
  const compact=h.child();expect(compact.props.expanded).toBe(false);expect(compact.props.dialog).toBeUndefined();
  const compactHtml=markup(compact);expect(compactHtml).toContain('Player A');expect(compactHtml).not.toContain('From API');expect(compactHtml).not.toContain('/players/');
  const compactContent=scope(()=>UnifiedPlayerPreview(compact.props as Parameters<typeof UnifiedPlayerPreview>[0]));
  const keyboardToggle=elements(compactContent).find(node=>node.props.className==='unified-preview-toggle')!;
  expect(keyboardToggle.type).toBe('button');expect(keyboardToggle.props.type).toBe('button');expect(keyboardToggle.props['aria-expanded']).toBe(false);
  (keyboardToggle.props.onClick as ()=>void)();const expanded=h.child();expect(expanded.props.expanded).toBe(true);
  const html=markup(expanded);expect(html).toContain('From API');expect(html).toContain('API hall');expect(html).toContain('/v1/media/game-covers/');expect(html).not.toContain('/players/');expect(html).not.toContain('<dialog');
  expect(h.layer().type).toBe(before.type);expect(h.layer().key).toBe(before.key);expect(h.layer().props.sharedMap).toBe(h.map);expect(h.layer().props.rows).toBe(before.props.rows);
  (expanded.props.onToggle as ()=>void)();expect(h.child().props.expanded).toBe(false);h.dispose();
});
it('selection change resets expanded detail; Escape/back/CloseButton close and restore the map trigger',async()=>{
  const h=pageHarness();(h.layer().props.onSelect as (row:UnifiedRow)=>void)(view.pins[0]!);h.render();(h.child().props.onToggle as ()=>void)();expect(h.child().props.expanded).toBe(true);
  const b=pin('Player B');view.pins=[b];view.rows=[b];await controller.select(b);h.render();expect(h.child().props.expanded).toBe(false);
  const child=h.child();const tree=scope(()=>UnifiedPlayerPreview(child.props as Parameters<typeof UnifiedPlayerPreview>[0]));
  const escape={key:'Escape',target:{closest:()=>null},preventDefault:vi.fn(),stopPropagation:vi.fn()};
  (elements(tree).find(node=>node.props.className==='unified-preview')!.props.onKeyDown as (e:unknown)=>void)(escape);
  expect(view.preview).toBeNull();expect(view.selected).toBeNull();expect(trigger.focus).toHaveBeenCalled();expect(escape.preventDefault).toHaveBeenCalledOnce();
  await controller.select(b);h.render();window.dispatchEvent(new Event('popstate'));expect(view.selected).toBeNull();h.render();expect(trigger.focus).toHaveBeenCalled();
  await controller.select(b);h.render();(elements(h.render()).find(node=>node.type===CloseButton)!.props.onClick as ()=>void)();expect(view.preview).toBeNull();h.dispose();
});
it('shows loading, safe failure/retry and truthful empty copy from actual preview content',()=>{
  const p=view.pins[0]!;view.selected=p.publicPlayerId;view.previewBusy=true;
  const props={onClose:vi.fn(),onMap:true,expanded:true,onToggle:vi.fn()};
  expect(markup(<UnifiedPlayerPreview {...props}/>)).toContain('Загружаем данные игрока');
  view.previewBusy=false;view.previewError='Не удалось загрузить данные игрока. Попробуйте снова.';
  const tree=scope(()=>UnifiedPlayerPreview(props));expect(markup(tree)).toContain('role="alert"');expect(markup(tree)).not.toContain('Нет доступных');
  const retry=elements(tree).find(node=>node.props.children==='Повторить')!;(retry.props.onClick as ()=>void)();expect(controller.select).toHaveBeenCalledWith(p);
  view.previewError='';view.preview={...payload(p),upcomingGames:[]};const html=markup(<UnifiedPlayerPreview {...props}/>);
  expect(html).toContain('Нет доступных ближайших публичных игр');expect(html).not.toContain('нет игр');
});
it.each(['identity','preview-deadline','snapshot-deadline','row-deadline','pendingStop','inactive'])("render fence suppresses retained schedule for %s",kind=>{
  const p=view.pins[0]!;view.selected=p.publicPlayerId;view.preview=payload(p);
  if(kind==='identity')view.preview.player={...view.preview.player,publicPlayerId:'another'};
  if(kind==='preview-deadline')view.preview.radar.validUntil='invalid';if(kind==='snapshot-deadline')view.snapshot!.validUntil=new Date(now).toISOString();
  if(kind==='row-deadline')p.radar!.validUntil=new Date(now).toISOString();if(kind==='pendingStop')context.session.pendingStop=true;if(kind==='inactive')context.session.phase='expired';
  expect(markup(<UnifiedPlayerPreview onMap expanded onClose={()=>{}}/>)).toBe('');
});
it.each([false,true])('focuses the actual compact control or expanded detail, expanded=%s',expanded=>{
  const p=view.pins[0]!;view.selected=p.publicPlayerId;view.preview=payload(p);
  const rootFocus=vi.fn(),toggleFocus=vi.fn();
  scope(()=>{
    const tree=UnifiedPlayerPreview({onMap:true,expanded,onToggle:vi.fn(),onClose:vi.fn()});
    for(const node of elements(tree)) {
      const ref=node.props.ref as {current:unknown}|undefined;
      if(ref)ref.current={focus:node.props.className==='unified-preview-toggle'?toggleFocus:rootFocus};
    }
    hooks.effects.splice(0).forEach(effect=>effect());
    expect(rootFocus).toHaveBeenCalled();if(!expanded)expect(toggleFocus).toHaveBeenCalled();
    hooks.cleanups.forEach(cleanup=>cleanup?.());
  });
});
it('retains the ordinary directory dialog/profile action and disposes map selection on unmount',async()=>{
  const p=view.pins[0]!;view.selected=p.publicPlayerId;view.preview=payload(p);
  const html=markup(<UnifiedPlayerPreview dialog onClose={()=>{}}/>);expect(html).toContain('<dialog');expect(html).toContain('/players/');
  const h=pageHarness();await controller.select(p);h.render();h.dispose();expect(view.preview).toBeNull();
});
