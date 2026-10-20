import type * as React from "react";
import { Children, isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VenueSheet } from "../src/components/consumer/games/VenueSheet";
import { listAllCityVenues } from "../src/lib/api-client";
import type { VenueSummary } from "../src/lib/consumer-types";
vi.mock("react", async original => ({...await original<typeof React>(),useState:<T,>(v:T)=>[v,()=>{}],useEffect:()=>{},useRef:(v:unknown)=>({current:v}),useId:()=>"contacts"}));
vi.mock("next/link",()=>({default:({href,children}:{href:string;children:React.ReactNode})=><a href={href}>{children}</a>}));
const venue:VenueSummary={id:"venue",cityId:"city",name:"Зал",address:"Адрес",timezone:"Europe/Moscow"};
function walk(node:React.ReactNode):React.ReactElement<Record<string,unknown>>[]{
 if(!isValidElement<Record<string,unknown>>(node))return [];
 if(typeof node.type==='function')return walk((node.type as (p:Record<string,unknown>)=>React.ReactNode)(node.props));
 return [node,...Children.toArray(node.props.children as React.ReactNode).flatMap(walk)];
}
function render(value:unknown,gamesReady=true){
 const v={...venue,publicContacts:value} as VenueSummary;
 const tree=VenueSheet({venue:v,games:[],gamesReady,now:0,onCollapse:()=>{},onDeselect:()=>{}});
 return {nodes:walk(tree),html:renderToStaticMarkup(tree)};
}
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
describe("VenueSheet public organization contacts",()=>{
 it("keeps the entire API object and renders labels/order/link props",async()=>{
  vi.stubEnv("API_BASE_URL", "http://localhost:19441");
  const publicContacts={phone:" +7 (999) 123-45-67 ",website:"https://пример.рф/contact",messengers:[{kind:"vk",url:"https://vk.com/club"},{kind:"telegram",url:"https://t.me/club"},{kind:"whatsapp",url:"https://wa.me/79991234567"}]};
  vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response(JSON.stringify({items:[{...venue,publicContacts}],nextCursor:null}),{status:200})));
  const result=await listAllCityVenues("city");expect(result.ok).toBe(true);if(!result.ok)throw new Error(result.error);
  expect(result.data[0]?.publicContacts).toEqual(publicContacts);
  const {nodes,html}=render(result.data[0]?.publicContacts);
  const anchors=nodes.filter(n=>n.type==='a' && !String(n.props.href).startsWith('/'));
  expect(anchors.map(n=>n.props.href)).toEqual(["tel:+79991234567","https://xn--e1afmkfd.xn--p1ai/contact","https://t.me/club","https://wa.me/79991234567","https://vk.com/club"]);
  expect(anchors.map(n=>n.props.children)).toEqual(["+7 (999) 123-45-67","Сайт площадки","Telegram","WhatsApp","ВКонтакте"]);
  expect(anchors[0]?.props.target).toBeUndefined();
  expect(anchors[0]?.props.rel).toBeUndefined();
  for(const a of anchors.slice(1)){expect(a.props.target).toBe('_blank');expect(a.props.rel).toBe('noopener noreferrer');}
  expect(html).toContain("Публичные контакты организации");
  const labels=["Сайт площадки","Telegram","WhatsApp","ВКонтакте"];expect(labels.map(l=>html.indexOf(l))).toEqual(labels.map(l=>html.indexOf(l)).sort((a,b)=>a-b));
 });
 it("missing/old/unsafe data shows empty independent of schedules; private fields ignored",()=>{
  for(const ready of [true,false])for(const value of [undefined,null,[],{contact_phone:"+79991234567",contactWebsite:"https://private.example"},{phone:"123\n4567",website:"https://foo／bar.example/path",messengers:[{kind:"telegram",url:"https://t.me/a/.."}]}]){
   const {html}=render(value,ready);expect(html).toContain("Публичные контакты не указаны");expect(html).not.toContain("private.example");
  }
 });
 it("retains safe neighbors and independently enforces URL policy",()=>{
  const bad=["https://a@b/","https://b:444/","https://b/\n","https://b/\\x","javascript:x","https://example.com/"+"я".repeat(100)];
  for(const website of bad){const {html}=render({phone:"+1234567",website,messengers:[]});expect(html).toContain('tel:+1234567');expect(html).not.toContain('Сайт площадки');}
  for(const [raw,expected] of [[" HTTP://Example.COM:80/a/../b ","http://example.com/b"],["https://[::1]/","https://[::1]/"],["https://127.0.0.1/","https://127.0.0.1/"],[" ".repeat(310)+"https://example.com/","https://example.com/"]]){
   expect(render({phone:null,website:raw,messengers:[]}).nodes.some(n=>n.props.href===expected)).toBe(true);
  }
  const {nodes}=render({phone:null,website:null,messengers:[{kind:"telegram",url:"http://t.me/club"},{kind:"telegram",url:"https://t.me/club"},{kind:"telegram",url:"https://t.me/duplicate"}]});
  expect(nodes.filter(n=>n.props.href==='https://t.me/club')).toHaveLength(1);expect(nodes.some(n=>n.props.href==='https://t.me/duplicate')).toBe(false);
 });
});
