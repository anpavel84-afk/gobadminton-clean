import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { VenueCover, venueCoverUrl } from "../src/components/consumer/venues/VenueCover";
import { VenueCoverEditor } from "../src/components/consumer/venues/VenueCoverEditor";
import { DiscoveryGameCard } from "../src/components/consumer/discovery/DiscoveryGameCard";
import { GameHero } from "../src/components/consumer/games/GameDetailComposition";
import { VenueCoverError, venueCoverRequest } from "../src/lib/venue-cover-api";
import { VENUE_ILLUSTRATION_ALT, VENUE_ILLUSTRATION_URLS, venueIllustrationUrl } from "../src/lib/venue-illustration";
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
  it("uses court and trainer photos for default venue and discovery covers",()=>{
    const game: Game={id:"synthetic",version:1,title:"Synthetic game",status:"published",visibility:"public",activityKind:"regular",trainer:null,trainingDescription:null,
      venue:{id:"00000037-1111-4111-8111-111111111111",name:"Synthetic venue",address:"Synthetic address",timezone:"Europe/Moscow",cityId:"synthetic",cover:{uploadedUrl:null}},
      organizer:{id:null,displayName:"Synthetic host",publicContact:"Synthetic"},startsAt:"2027-01-01T15:00:00Z",endsAt:"2027-01-01T16:00:00Z",timezone:"Europe/Moscow",capacity:4,externalReservedCount:0,confirmedCount:0,availablePlaces:4,formatKey:"doubles",applicationDeadlineAt:"2027-01-01T15:00:00Z",
      levelRule:{scaleId:"test",scaleVersion:1,allowedLevelIds:["test"]},settlement:{mode:"external",purpose:"no_trainer_fee",priceMinor:null,currency:null,terms:"Synthetic"}};
    const cases = [
      { element: <VenueCover />, fallback: "court", image: "badminton-courts.jpg", alt: "Бадминтонный корт" },
      { element: <VenueCover cover={{uploadedUrl:"https://evil.invalid/photo.png"}} fallback="trainer" />, fallback: "trainer", image: "badminton-gear.jpg", alt: "Ракетка и воланы на корте" },
      { element: <DiscoveryGameCard game={{...game,activityKind:"regular"}} />, fallback: "court", image: "badminton-courts.jpg", alt: "Бадминтонный корт" },
      { element: <DiscoveryGameCard game={{...game,activityKind:"trainer_led"}} />, fallback: "court", image: "badminton-courts.jpg", alt: "Бадминтонный корт" },
    ];
    for (const {element,fallback,image,alt} of cases) {
      const markup = renderToStaticMarkup(element);
      expect(markup).toContain(`src="/discovery/${image}"`);
      expect(markup).toContain('data-cover="default"');
      expect(markup).toContain(`data-fallback="${fallback}"`);
      expect(markup).toContain(`alt="${alt}"`);
      expect(markup).toContain('loading="lazy"');
      expect(markup).toContain('decoding="async"');
      expect(markup).not.toContain("▱");
    }
  });
  it("uses stable equipment illustration when venueId is supplied without uploaded cover",()=>{
    const idA="00000037-1111-4111-8111-111111111111";
    const idB="00000037-1111-4111-8111-111111111112";
    const a=renderToStaticMarkup(<VenueCover venueId={idA}/>);
    const b=renderToStaticMarkup(<VenueCover venueId={idB}/>);
    const again=renderToStaticMarkup(<VenueCover venueId={idA}/>);
    expect(a).toContain(`src="${venueIllustrationUrl(idA)}"`);
    expect(a).toContain('data-fallback="illustration"');
    expect(a).toContain(`alt="${VENUE_ILLUSTRATION_ALT}"`);
    expect(a).not.toContain("Бадминтонный корт");
    expect(again).toContain(`src="${venueIllustrationUrl(idA)}"`);
    expect(VENUE_ILLUSTRATION_URLS).toContain(venueIllustrationUrl(idA) as typeof VENUE_ILLUSTRATION_URLS[number]);
    expect(VENUE_ILLUSTRATION_URLS).toContain(venueIllustrationUrl(idB) as typeof VENUE_ILLUSTRATION_URLS[number]);
    // Uploaded cover still wins over the generic illustration.
    const uploaded=renderToStaticMarkup(<VenueCover venueId={idA} cover={{uploadedUrl:url}} name="Synthetic"/>);
    expect(uploaded).toContain(url);
    expect(uploaded).not.toContain('data-fallback="illustration"');
    expect(uploaded).toContain('data-cover="uploaded"');
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
    const deleteInit=callAt(1)[1];
    expect(deleteInit.credentials).toBe("include");expect(deleteInit.headers.get("X-CSRF-Token")).toBe(access.csrfToken);expect(deleteInit.headers.get("Idempotency-Key")).toBeTruthy();
    const deleteBody=deleteInit.body;
    if(typeof deleteBody!=="string")throw new Error("DELETE body must be JSON text");
    expect(JSON.parse(deleteBody)).toEqual({expectedVersion:1});
    await venueCoverRequest(id,"GET",controller.signal);expect(callAt(2)[0]).toBe(`/v1/admin/venues/${id}/cover/access`);expect(callAt(2)[1].body).toBeUndefined();expect(callAt(2)[1].credentials).toBe("include");expect(callAt(2)[1].headers.has("X-CSRF-Token")).toBe(false);
  });
});

for (const method of ["GET", "PUT", "DELETE"] as const) {
  for (const status of [401, 403]) {
    it(`${method} rejects original ${status} without false success`, async () => {
      const localFetch = vi.fn(async () => new Response("{}", { status }));
      vi.stubGlobal("fetch", localFetch);
      const access = { version: 7, hasCover: true, csrfToken: "test-csrf", cover: { uploadedUrl: url } };
      const request = venueCoverRequest("00000037-1111-4111-8111-111111111111", method,
        new AbortController().signal, access, method === "PUT" ? new Blob(["image"], { type: "image/png" }) : undefined);
      await expect(request).rejects.toBeInstanceOf(VenueCoverError);
      await expect(request).rejects.toMatchObject({ status });
      expect(localFetch).toHaveBeenCalledTimes(1);
    });
  }
}
