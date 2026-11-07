import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import type * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// Narrow harness: only while invoking VenueCover as a function for load/error sequences.
const hooks = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, active: false }));
vi.mock("react", async importOriginal => {
  const ReactActual = await importOriginal<typeof React>();
  const readInitial = <T,>(initial: T | (() => T)): T =>
    typeof initial === "function" ? (initial as () => T)() : initial;
  return {
    ...ReactActual,
    useState<T>(initial: T | (() => T)) {
      if (!hooks.active) return ReactActual.useState(initial);
      const index = hooks.cursor++;
      const slots = hooks.slots;
      if (!(index in slots)) slots[index] = readInitial(initial);
      return [slots[index], (next: T | ((old: T) => T)) => {
        slots[index] = typeof next === "function" ? (next as (old: T) => T)(slots[index] as T) : next;
      }];
    },
  };
});

import { VenueCover, venueCoverUrl } from "../src/components/consumer/venues/VenueCover";
import { VenueCoverEditor } from "../src/components/consumer/venues/VenueCoverEditor";
import { DiscoveryGameCard } from "../src/components/consumer/discovery/DiscoveryGameCard";
import { GameHero } from "../src/components/consumer/games/GameDetailComposition";
import { VenueCoverError, venueCoverRequest } from "../src/lib/venue-cover-api";
import { VENUE_ILLUSTRATION_URLS, venueIllustrationUrl, venueMediaSkeletonStyle } from "../src/lib/venue-illustration";
import type { Game } from "../src/lib/consumer-types";

function skeletonMarkup(): string {
  const style = venueMediaSkeletonStyle();
  return `background-size:${style.backgroundSize}`;
}
afterEach(()=>{
  hooks.active = false;
  hooks.slots = [];
  hooks.cursor = 0;
  vi.unstubAllGlobals();
});
const url="/v1/media/venue-covers/"+"a".repeat(64)+".png";
const venueId="00000037-1111-4111-8111-111111111111";

type ImgProps = {
  src?: string;
  style?: { opacity?: number };
  onLoad?: () => void;
  onError?: () => void;
  ref?: ((node: { complete: boolean; naturalWidth: number } | null) => void) | { current: unknown };
};

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...Children.toArray(node.props.children as ReactNode).flatMap(elements)];
}

function renderCover(props: React.ComponentProps<typeof VenueCover>) {
  hooks.cursor = 0;
  hooks.active = true;
  try {
    return VenueCover(props);
  } finally {
    hooks.active = false;
  }
}

function coverImg(tree: ReactNode): ReactElement<ImgProps> {
  const img = elements(tree).find(node => node.type === "img") as ReactElement<ImgProps> | undefined;
  if (!img) throw new Error("missing img");
  return img;
}

describe("venue cover presentation / mutation wire protocol",()=>{
  beforeEach(() => {
    hooks.slots = [];
    hooks.cursor = 0;
    hooks.active = false;
  });
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
  it("shows neutral no-photo when venueId is supplied without uploaded cover; keeps illustration asset map",()=>{
    const idA="00000037-1111-4111-8111-111111111111";
    const idB="00000037-1111-4111-8111-111111111112";
    const a=renderToStaticMarkup(<VenueCover venueId={idA}/>);
    const again=renderToStaticMarkup(<VenueCover venueId={idA}/>);
    expect(a).toContain('data-state="empty"');
    expect(a).toContain("Фотографии площадки пока нет");
    expect(a).not.toContain("venue-illustrations");
    expect(a).not.toContain("data:image/svg+xml");
    expect(a).not.toContain("Бадминтонный корт");
    expect(again).toContain('data-state="empty"');
    expect(VENUE_ILLUSTRATION_URLS).toContain(venueIllustrationUrl(idA) as typeof VENUE_ILLUSTRATION_URLS[number]);
    expect(VENUE_ILLUSTRATION_URLS).toContain(venueIllustrationUrl(idB) as typeof VENUE_ILLUSTRATION_URLS[number]);
  });
  it("shows immediate static CSS skeleton while uploaded photo is pending before onLoad",()=>{
    const idA="00000037-1111-4111-8111-111111111111";
    // SSR/first paint: uploaded src present but not yet cover=uploaded; static skeleton fills the cell.
    const pending=renderToStaticMarkup(<VenueCover venueId={idA} cover={{uploadedUrl:url}} name="Synthetic"/>);
    expect(pending).toContain(url);
    expect(pending).toContain('data-cover="default"');
    expect(pending).toContain('data-pending="uploaded"');
    expect(pending).toContain(skeletonMarkup());
    expect(pending).toContain("linear-gradient");
    expect(pending).not.toContain("data:image/svg+xml");
    expect(pending).not.toContain("venue-illustrations");
    expect(pending).toContain("opacity:0");
    expect(pending).toContain("loading=\"lazy\"");
    // Without venueId: keep immediate uploaded paint (discovery/hero); do not invent illustration.
    const noVenue=renderToStaticMarkup(<VenueCover cover={{uploadedUrl:url}} name="Synthetic"/>);
    expect(noVenue).toContain(url);
    expect(noVenue).toContain('data-cover="uploaded"');
    expect(noVenue).not.toContain('data-pending="uploaded"');
    expect(noVenue).not.toContain("venue-illustrations");
    expect(noVenue).not.toContain("opacity:0");
  });
  it("resets pending eligibility when venue id or uploaded url changes",()=>{
    const idA="00000037-1111-4111-8111-111111111111";
    const idB="00000037-1111-4111-8111-111111111112";
    const urlB="/v1/media/venue-covers/"+"b".repeat(64)+".png";
    const first=renderToStaticMarkup(<VenueCover venueId={idA} cover={{uploadedUrl:url}} name="A"/>);
    expect(first).toContain(skeletonMarkup());
    const swappedVenue=renderToStaticMarkup(<VenueCover venueId={idB} cover={{uploadedUrl:url}} name="B"/>);
    expect(swappedVenue).toContain(skeletonMarkup());
    expect(swappedVenue).toContain('data-pending="uploaded"');
    const swappedUrl=renderToStaticMarkup(<VenueCover venueId={idA} cover={{uploadedUrl:urlB}} name="A"/>);
    expect(swappedUrl).toContain(urlB);
    expect(swappedUrl).toContain('data-pending="uploaded"');
    expect(swappedUrl).toContain(skeletonMarkup());
    // Genuine no-media — neutral empty, not equipment filler.
    const empty=renderToStaticMarkup(<VenueCover venueId={idA} cover={{uploadedUrl:null}} name="Synthetic"/>);
    expect(empty).toContain('data-state="empty"');
    expect(empty).toContain("Фотографии площадки пока нет");
    expect(empty).not.toContain("data:image/svg+xml");
    expect(empty).not.toContain(url);
  });
  it("original onError shows failed/retry without illustration filler; retry restores pending", () => {
    const props = { venueId, cover: { uploadedUrl: url }, name: "Synthetic" };
    let tree = renderCover(props);
    const original = coverImg(tree);
    expect(original.props.src).toBe(url);
    original.props.onError?.();
    tree = renderCover(props);
    const html = renderToStaticMarkup(tree);
    expect(html).toContain('data-state="error"');
    expect(html).toContain("Фото не загрузилось");
    expect(html).toContain("Повторить");
    expect(html).not.toContain("venue-illustrations");
    expect(html).not.toContain("data:image/svg+xml");
    expect(html).not.toContain(`src="${url}"`);
    const retry = elements(tree).find(node => node.type === "button");
    expect(retry).toBeTruthy();
    (retry!.props.onClick as (event: { preventDefault: () => void; stopPropagation: () => void }) => void)({
      preventDefault: () => {},
      stopPropagation: () => {},
    });
    tree = renderCover(props);
    expect(coverImg(tree).props.src).toBe(url);
    expect(renderToStaticMarkup(tree)).toContain('data-pending="uploaded"');
  });

  it("failed state without allowRetry stays non-interactive for picker parents", () => {
    const props = { venueId, cover: { uploadedUrl: url }, name: "Synthetic", allowRetry: false };
    let tree = renderCover(props);
    coverImg(tree).props.onError?.();
    tree = renderCover(props);
    const html = renderToStaticMarkup(tree);
    expect(html).toContain('data-state="error"');
    expect(html).toContain("Фото не загрузилось");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("data:image/svg+xml");
  });

  it("no-media empty state does not invent loaded imagery", () => {
    const props = { venueId, cover: { uploadedUrl: null as string | null }, name: "Synthetic" };
    const tree = renderCover(props);
    const html = renderToStaticMarkup(tree);
    expect(html).toContain('data-state="empty"');
    expect(html).toContain("Фотографии площадки пока нет");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("data:image/svg+xml");
  });

  it("cache-complete original and fresh venue/url reset via actual callbacks", () => {
    const props = { venueId, cover: { uploadedUrl: url }, name: "A" };
    let tree = renderCover(props);
    const original = coverImg(tree);
    const ref = original.props.ref;
    if (typeof ref === "function") ref({ complete: true, naturalWidth: 120 });
    tree = renderCover(props);
    expect(renderToStaticMarkup(tree)).toContain('data-cover="uploaded"');
    expect(renderToStaticMarkup(tree)).toContain("background-color:var(--c23-surface)");

    // Broken cache-complete uploaded → sticky fail (no illustration filler).
    hooks.slots = [];
    tree = renderCover(props);
    const broken = coverImg(tree);
    if (typeof broken.props.ref === "function") broken.props.ref({ complete: true, naturalWidth: 0 });
    tree = renderCover(props);
    expect(renderToStaticMarkup(tree)).toContain('data-state="error"');
    expect(renderToStaticMarkup(tree)).not.toContain("venue-illustrations");

    // Fresh url resets failure.
    const urlB = "/v1/media/venue-covers/" + "b".repeat(64) + ".png";
    tree = renderCover({ venueId, cover: { uploadedUrl: urlB }, name: "A" });
    expect(coverImg(tree).props.src).toBe(urlB);
    expect(renderToStaticMarkup(tree)).toContain('data-pending="uploaded"');
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
