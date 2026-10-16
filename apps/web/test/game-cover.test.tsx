import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { GameCover, gameCoverUrl } from "../src/components/consumer/games/GameCover";
import { GamePhotoSelection } from "../src/components/consumer/games/GamePhotoSelection";
import { gameCoverRequest } from "../src/lib/game-cover-api";
import { DiscoveryGameCard } from "../src/components/consumer/discovery/DiscoveryGameCard";
import { GameHero, PersonalGameCard } from "../src/components/consumer/games/GameDetailComposition";
import type { Game } from "../src/lib/consumer-types";
const venueUrl="/v1/media/venue-covers/"+"a".repeat(64)+".png",ownUrl="/v1/media/game-covers/"+"b".repeat(64)+".png";
afterEach(()=>vi.unstubAllGlobals());
describe("Issue47 effective game cover",()=>{
  it("renders current own, inherited venue and default on new reads; refuses arbitrary/profile URLs",()=>{
    const venue={name:"Synthetic",cover:{uploadedUrl:venueUrl}};
    expect(renderToStaticMarkup(<GameCover game={{cover:{uploadedUrl:ownUrl},venue}}/>)).toContain(ownUrl);
    expect(renderToStaticMarkup(<GameCover game={{cover:{uploadedUrl:venueUrl},venue}}/>)).toContain(venueUrl);
    expect(renderToStaticMarkup(<GameCover game={{cover:{uploadedUrl:null},venue:{...venue,cover:{uploadedUrl:null}}}}/>)).toContain('data-cover="default"');
    for(const bad of ["https://evil.invalid/photo.png","/v1/media/covers/"+"b".repeat(64)+".png","javascript:alert(1)","/v1/media/game-covers/../secret"])expect(gameCoverUrl(bad)).toBeNull();
  });
  it("renders the effective image in discovery, detail and My Games without changing avatars",()=>{
    const game={id:"synthetic",version:1,title:"Synthetic game",status:"published",visibility:"public",activityKind:"regular",trainer:null,trainingDescription:null,
      cover:{uploadedUrl:ownUrl},venue:{id:"venue",name:"Synthetic",address:"Synthetic",cityId:"city",timezone:"Europe/Moscow",cover:{uploadedUrl:venueUrl}},
      organizer:{id:null,displayName:"Organizer",publicContact:"Synthetic"},startsAt:"2029-01-01T12:00:00Z",endsAt:"2029-01-01T13:00:00Z",timezone:"Europe/Moscow",applicationDeadlineAt:"2029-01-01T12:00:00Z",capacity:4,externalReservedCount:0,confirmedCount:1,availablePlaces:3,formatKey:"doubles",levelRule:{scaleId:"test",scaleVersion:1,allowedLevelIds:["test"]},settlement:{mode:"external",purpose:"no_trainer_fee",terms:"Synthetic",priceMinor:null,currency:null}} as Game;
    for(const element of [<DiscoveryGameCard key="discovery" game={game}/>,<GameHero key="detail" game={game}/>,<PersonalGameCard key="mine" game={game} ownStatus="confirmed"/>]){
      const html=renderToStaticMarkup(element);expect(html).toContain(ownUrl);expect(html).toContain("Organizer");
    }
    const inherited={...game,cover:{uploadedUrl:venueUrl}};
    expect(renderToStaticMarkup(<DiscoveryGameCard game={inherited}/>)).toContain(venueUrl);
    const changed="/v1/media/venue-covers/"+"c".repeat(64)+".png";
    expect(renderToStaticMarkup(<DiscoveryGameCard game={{...inherited,cover:{uploadedUrl:changed},venue:{...game.venue,cover:{uploadedUrl:changed}}}}/>)).toContain(changed);
  });
  it("keeps selection optional, local and explicit before upload",()=>{
    const onChange=vi.fn(),onReady=vi.fn(),fetch=vi.fn();vi.stubGlobal("fetch",fetch);
    const html=renderToStaticMarkup(<GamePhotoSelection onChange={onChange} onReady={onReady}/>);
    expect(html).toContain('type="file"');expect(html).toContain("необязательно");expect(html).toContain("текущая одобренная");expect(fetch).not.toHaveBeenCalled();expect(onChange).not.toHaveBeenCalled();
  });
  it("uses cookie CSRF replay and shared Game CAS; replacement/deletion never target Venue",async()=>{
    const fetch=vi.fn().mockImplementation(async()=>new Response(JSON.stringify({version:2,hasCover:true,cover:{uploadedUrl:ownUrl}}),{status:200}));vi.stubGlobal("fetch",fetch);
    const id="00000047-1111-4111-8111-111111111111",access={version:1,csrfToken:"synthetic"},blob=new Blob(["derivative"],{type:"image/webp"}),signal=new AbortController().signal;
    await gameCoverRequest(id,"PUT",signal,access,blob);
    const [url,init]=fetch.mock.calls[0]!;expect(url).toBe(`/v1/games/${id}/cover`);expect(init.credentials).toBe("include");expect(init.cache).toBe("no-store");expect(init.body).toBe(blob);expect(init.headers.get("X-Game-Version")).toBe("1");expect(init.headers.get("X-CSRF-Token")).toBe("synthetic");expect(init.headers.get("Idempotency-Key")).toBeTruthy();
    await gameCoverRequest(id,"DELETE",signal,access);expect(JSON.parse(fetch.mock.calls[1]![1].body)).toEqual({expectedVersion:1});
    fetch.mockResolvedValue(new Response("{}",{status:409}));await expect(gameCoverRequest(id,"PUT",signal,access,blob)).rejects.toMatchObject({status:409});
  });
});
