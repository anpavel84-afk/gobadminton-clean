import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { VenueCover, venueCoverUrl } from "../src/components/consumer/venues/VenueCover";
import { VenueCoverEditor } from "../src/components/consumer/venues/VenueCoverEditor";
import { DiscoveryGameCard } from "../src/components/consumer/discovery/DiscoveryGameCard";
import { GameHero } from "../src/components/consumer/games/GameDetailComposition";
import { venueCoverRequest } from "../src/lib/venue-cover-api";
import type { Game } from "../src/lib/consumer-types";
afterEach(()=>vi.unstubAllGlobals());
const url="/v1/media/venue-covers/"+"a".repeat(64)+".png";
describe("venue cover presentation / mutation wire protocol",()=>{
  it("accepts current same-origin derivative only, defaults for arbitrary/private/active URLs",()=>{
    expect(renderToStaticMarkup(<VenueCover cover={{uploadedUrl:url}} name="Synthetic"/>)).toContain(url);
    for(const value of [null,"https://evil.invalid/photo.png","javascript:alert(1)","/v1/media/covers/"+"a".repeat(64)+".png","/v1/media/venue-covers/../../secret"]){
      expect(venueCoverUrl(value)).toBeNull();expect(renderToStaticMarkup(<VenueCover cover={{uploadedUrl:value}}/>)).toContain('data-cover="default"');
    }
  });
  it("does not grant an editor by venueId; no controls until scoped server access",()=>{
    expect(renderToStaticMarkup(<VenueCoverEditor venueId="00000037-1111-4111-8111-111111111111" onChange={vi.fn()}/>)).toBe("");
  });
  it("uses venue cover in existing discovery and detail media slots and preserves venue identity",()=>{
    const game={id:"synthetic",version:1,title:"Synthetic game",status:"published",visibility:"public",activityKind:"regular",trainer:null,trainingDescription:null,
      venue:{id:"00000037-1111-4111-8111-111111111111",name:"Synthetic venue",address:"Synthetic address",timezone:"Europe/Moscow",cityId:"synthetic",cover:{uploadedUrl:url}},
      organizer:{id:null,displayName:"Synthetic host",publicContact:"Synthetic"},startsAt:"2027-01-01T15:00:00Z",endsAt:"2027-01-01T16:00:00Z",timezone:"Europe/Moscow",capacity:4,externalReservedCount:0,confirmedCount:0,availablePlaces:4,formatKey:"doubles",applicationDeadlineAt:"2027-01-01T15:00:00Z",
      levelRule:{scaleId:"test",scaleVersion:1,allowedLevelIds:["test"]},settlement:{mode:"external",purpose:"no_trainer_fee",priceMinor:null,currency:null,terms:"Synthetic"}} as Game;
    for(const render of [(g:Game)=><DiscoveryGameCard game={g}/>,(g:Game)=><GameHero game={g}/>]){
      expect(renderToStaticMarkup(render(game))).toContain(url);
      expect(renderToStaticMarkup(render({...game,venue:{...game.venue,cover:{uploadedUrl:null}}}))).toContain('data-cover="default"');
    }
  });
  it("sends bounded derivative confirmation with cookie/CSRF/CAS/replay; DELETE has exact JSON command",async()=>{
    const fetch=vi.fn<(input: string, init: RequestInit & {headers: Headers}) => Promise<Response>>()
      .mockImplementation(async()=>new Response(JSON.stringify({version:2,cover:{uploadedUrl:url}}),{status:200}));
    vi.stubGlobal("fetch",fetch);
    function callAt(index:number){
      const call=fetch.mock.calls[index];
      if(!call)throw new Error(`Missing fetch call ${index}`);
      return call;
    }
    const id="00000037-1111-4111-8111-111111111111",access={version:1,hasCover:false,csrfToken:"synthetic-csrf",cover:{uploadedUrl:null}},controller=new AbortController(),blob=new Blob(["synthetic"],{type:"image/png"});
    await venueCoverRequest(id,"PUT",controller.signal,access,blob);
    expect(callAt(0)[0]).toBe(`/v1/admin/venues/${id}/cover`);
    const init=callAt(0)[1];expect(init.credentials).toBe("include");expect(init.cache).toBe("no-store");expect(init.headers.get("X-Venue-Version")).toBe("1");expect(init.headers.get("X-CSRF-Token")).toBe(access.csrfToken);expect(init.headers.get("Idempotency-Key")).toBeTruthy();expect(init.body).toBe(blob);
    await venueCoverRequest(id,"DELETE",controller.signal,access);
    const deleteBody=callAt(1)[1].body;
    if(typeof deleteBody!=="string")throw new Error("DELETE body must be JSON text");
    expect(JSON.parse(deleteBody)).toEqual({expectedVersion:1});
    await venueCoverRequest(id,"GET",controller.signal);expect(callAt(2)[0]).toBe(`/v1/admin/venues/${id}/cover/access`);expect(callAt(2)[1].body).toBeUndefined();
  });
});
