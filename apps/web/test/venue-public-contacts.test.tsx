import { Children, isValidElement } from "react";
import type * as React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { VenueSummary } from "../src/lib/consumer-types";
import { VenueSheet } from "../src/components/consumer/games/VenueSheet";
import { listAllCityVenues } from "../src/lib/api-client";

vi.mock("next/link", () => ({ default: ({href, children}: {href:string;children:React.ReactNode}) => <a href={href}>{children}</a> }));
// Render the real component with React's server dispatcher: effects do not run.
// Capture the element output in the same dispatcher to assert actual props/order.
let captured: React.ReactNode;
function Capture({venue}: {venue:VenueSummary}) {
  captured = VenueSheet({venue,games:[],gamesReady:true,now:0,onCollapse:()=>{},onDeselect:()=>{}});
  return <>{captured}</>;
}
function elements(node:React.ReactNode):React.ReactElement<Record<string,unknown>>[] {
  if(!isValidElement<Record<string,unknown>>(node))return [];
  return [node,...Children.toArray(node.props.children as React.ReactNode).flatMap(elements)];
}
function text(node:React.ReactNode):string {
  if(typeof node==="string" || typeof node==="number")return String(node);
  if(Array.isArray(node))return node.map(text).join("");
  return isValidElement<{children?:React.ReactNode}>(node)?text(node.props.children):"";
}
const base:VenueSummary={id:"synthetic",cityId:"city",name:"Зал",address:"Адрес",timezone:"Europe/Moscow"};
const populated={phone:"+7 (999) 123-45-67",website:"https://venue.example.invalid",messengers:[{kind:"telegram",url:"https://t.me/synthetic"},{kind:"whatsapp",url:"https://wa.me/79991234567"},{kind:"vk",url:"https://vk.com/synthetic"}]};
async function load(publicContacts:unknown, omitted=false){
  vi.stubEnv("API_BASE_URL","http://localhost:19441");
  const item={...base,...(omitted?{}:{publicContacts}),contactPhone:"PRIVATE_PHONE",contactWebsite:"https://private.invalid",bookingNote:"PRIVATE_NOTE"};
  const fetch=vi.fn().mockResolvedValue(new Response(JSON.stringify({items:[item],nextCursor:null}),{status:200,headers:{"content-type":"application/json"}}));vi.stubGlobal("fetch",fetch);
  const result=await listAllCityVenues("city");expect(result.ok).toBe(true);
  if(!result.ok)throw new Error(result.error);
  const venue=result.data[0];if(!venue)throw new Error("Missing catalog venue");
  expect(venue).toEqual(item);expect(fetch).toHaveBeenCalledTimes(1);
  renderToStaticMarkup(<Capture venue={venue}/>);
  const nodes=elements(captured);
  expect(text(captured)).not.toContain("PRIVATE");expect(text(captured)).not.toContain("private.invalid");
  return nodes;
}
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();captured=null;});
it("whole catalog object reaches real info sheet: labels, order, safe href/target/rel",async()=>{
 const nodes=await load(populated), links=nodes.filter(n=>typeof n.props.href==="string");
 expect(links.map(n=>text(n))).toEqual([populated.phone,"Сайт площадки","Telegram","WhatsApp","ВКонтакте","Создать игру на этой площадке"]);
 expect(links[0]?.props).toMatchObject({href:"tel:+79991234567"});expect(links[0]?.props.target).toBeUndefined();
 for(const [i,url] of [populated.website,...populated.messengers.map(m=>m.url)].entries())expect(links[i+1]?.props).toMatchObject({href:url,target:"_blank",rel:"noopener noreferrer"});
 const section=nodes.find(n=>n.type==="section" && n.props["aria-label"]==="Контакты площадки");expect(section).toBeDefined();if(!section)throw new Error("Missing contacts section");
 expect(nodes.filter(n=>n.type==="h3").map(n=>text(n))).toEqual(["Зал","Контакты площадки"]);
 expect(text(section)).toContain("Публичные контакты организации");
 expect(nodes.findIndex(n=>n.type==="p" && text(n)==="Адрес")).toBeLessThan(nodes.indexOf(section));
 expect(nodes.indexOf(section)).toBeLessThan(nodes.findIndex(n=>typeof n.props.href==="string" && text(n)==="Создать игру на этой площадке"));
});
it("missing, old API, malformed outer types and unsafe-only data show explicit empty state",async()=>{
 for(const value of [undefined,null,[],"contacts",1,{phone:"PRIVATE_PHONE",website:"javascript:bad",messengers:[{kind:"telegram",url:"https://evil.invalid/x"}]}]){
  const nodes=await load(value,value===undefined);expect(nodes.some(n=>n.type==="p" && text(n)==="Публичные контакты не указаны")).toBe(true);
  expect(nodes.filter(n=>typeof n.props.href==="string")).toHaveLength(1);
 }
});
it("partly safe unknown JSON preserves safe neighbors, ignores private keys, filters and deduplicates",async()=>{
 const nodes=await load({phone:"\n+79991234567",website:populated.website,private:"PRIVATE_NOTE",messengers:[{kind:"telegram",url:"https://user@t.me/bad"},{kind:"telegram",url:"https://t.me/safe",private:"PRIVATE_NOTE"},{kind:"telegram",url:"https://t.me/duplicate"},{kind:"whatsapp",url:"http://wa.me/bad"},{kind:"vk",url:"https://vk.com/safe"}]});
 expect(nodes.filter(n=>typeof n.props.href==="string").map(n=>n.props.href)).toEqual([populated.website,"https://t.me/safe","https://vk.com/safe",expect.stringContaining("venueId=synthetic")]);
});
it("browser independently rejects URL hazards and phone limits while retaining safe messenger",async()=>{
 for(const url of ["https://@venue.invalid","https://user:pass@venue.invalid","https://venue.invalid:444/a","https://venue.invalid/\\bad","\thttps://venue.invalid","https://venue.invalid/\u0085bad","ftp://venue.invalid","https://venue.invalid/"+"x".repeat(300)]){
  const nodes=await load({phone:"1234567890123456",website:url,messengers:[{kind:"vk",url:"https://vk.com/safe"}]});
  expect(nodes.filter(n=>typeof n.props.href==="string").map(n=>text(n))).toEqual(["ВКонтакте","Создать игру на этой площадке"]);
 }
 for(const phone of ["１２３４５６７","123456","12+34567","1234567"+"-".repeat(34),"1234567\u007f"]){
  const nodes=await load({phone,website:null,messengers:[]});expect(nodes.filter(n=>typeof n.props.href==="string")).toHaveLength(1);
 }
});

it("safe ASCII phone without plus and HTTP website retain correct link behavior",async()=>{
 const nodes=await load({phone:" 123 4567 ",website:"http://venue.invalid/path",messengers:[]});
 const links=nodes.filter(n=>typeof n.props.href==="string");
 expect(links[0]?.props).toMatchObject({href:"tel:1234567"});expect(text(links[0])).toBe("123 4567");
 expect(links[0]?.props.target).toBeUndefined();expect(links[0]?.props.rel).toBeUndefined();
 expect(links[1]?.props).toMatchObject({href:"http://venue.invalid/path",target:"_blank",rel:"noopener noreferrer"});
});
