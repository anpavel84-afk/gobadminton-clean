"use client";
import { useEffect, useState } from "react";
import type { ActivityKind, Venue } from "../../../lib/consumer-types";
import { ConsumerShell } from "../ConsumerShell";
import { Button } from "../Button";
import { SurfacePanel } from "../Surfaces";
import { VenueGallery } from "./VenueGallery";
import { VenuePublicProfile } from "./VenuePublicProfile";
import { VenuePublicContacts } from "../games/VenueSheet";
import { GamesMapView } from "../games/GamesMapView";
import { gamesMapReturnPath } from "../../../lib/games-venue-map";
import { shouldSkipUnauthenticatedPrivateGet } from "../../../lib/session-presence";
import { VenueReviewsPanel } from "./VenueReviewsPanel";
import { VenueCommunityRating } from "./VenueCommunityRating";
import { CommentsSection } from "../comments/CommentsSection";
import type { Me } from "../../../lib/consumer-types";
import "../../../styles/venue-community.css";

/** Allowlisted community section ids only — never treat the hash as a free selector. */
function knownVenueCommunityTargetId(hash: string): "ratings" | "discussion" | "reviews" | null {
  const id = hash.startsWith("#") ? hash.slice(1) : hash;
  if (id === "ratings" || id === "discussion" || id === "reviews") return id;
  return null;
}

export function VenuePage({venueId}:{venueId:string}) {
  const [context,setContext]=useState({day:"",returnTo:"/games?view=map"});
  useEffect(()=>{ const query=new URLSearchParams(window.location.search); setContext({day:query.get("day") ?? "",returnTo:gamesMapReturnPath(query.get("returnTo"))}); },[]);
  const activityValue = new URLSearchParams(context.returnTo.split("?")[1] ?? "").get("activity");
  const activity: "all" | ActivityKind = activityValue === "regular" || activityValue === "trainer_led" ? activityValue : "all";
  const [reload,setReload]=useState(0);
  const [result,setResult]=useState<{venueId:string;reload:number;venue:Venue|null;error:boolean}|null>(null);
  const [me,setMe]=useState<Me|null>(null);
  // A prop change hides the old profile before the next effect runs.
  const current=result?.venueId===venueId&&result.reload===reload?result:null;
  const venue=current?.venue ?? null;
  const error=current?.error ?? false;
  const authReturnPath=`/venues/${venueId}`;
  useEffect(()=>{
    const controller=new AbortController();let active=true;
    setResult({venueId,reload,venue:null,error:false});
    const timer=setTimeout(()=>controller.abort(),15000);
    void fetch(`/v1/venues/${encodeURIComponent(venueId)}`,{cache:"no-store",signal:controller.signal}).then(async r=>{
      if(!r.ok)throw new Error("unavailable");const value=await r.json() as Venue;
      if(active&&!controller.signal.aborted)setResult({venueId,reload,venue:value,error:false});
    }).catch(()=>{if(active)setResult({venueId,reload,venue:null,error:true});}).finally(()=>clearTimeout(timer));
    return ()=>{active=false;controller.abort();clearTimeout(timer);};
  },[venueId,reload]);
  useEffect(()=>{
    // Explicit guest hint: clear local identity without a direct /v1/me probe.
    if(shouldSkipUnauthenticatedPrivateGet("/v1/me","GET")){setMe(null);return;}
    const controller=new AbortController();
    void fetch("/v1/me",{cache:"no-store",credentials:"include",signal:controller.signal})
      .then(async (r)=>{
        if(!r.ok){setMe(null);return;}
        const body=await r.json() as Me;
        setMe(body);
      })
      .catch(()=>{setMe(null);});
    return ()=>controller.abort();
  },[venueId]);
  // Late fragment: venue markup arrives after fetch; re-apply known hashes with CSS scroll-margin.
  useEffect(() => {
    if (!venue) return;
    let cancelled = false;
    let frame = 0;

    const scrollKnownHash = () => {
      if (cancelled) return;
      const targetId = knownVenueCommunityTargetId(window.location.hash);
      if (!targetId) return;
      const node = document.getElementById(targetId);
      if (!node) return;
      node.scrollIntoView({ block: "start", behavior: "auto" });
    };

    frame = window.requestAnimationFrame(() => {
      frame = window.requestAnimationFrame(scrollKnownHash);
    });

    const onHashChange = () => {
      scrollKnownHash();
    };
    window.addEventListener("hashchange", onHashChange);

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      window.removeEventListener("hashchange", onHashChange);
    };
  }, [venueId, venue]);
  return <ConsumerShell active="games" title="Площадка" mode="page" hideHeading><div className="gb-venue-page">
    <header className="gb-page-local-header">
      <Button variant="ghost" className="gb-game-back" href={context.returnTo}>← Назад к карте</Button>
      {venue ? <h1>{venue.name}</h1> : null}
      {venue ? <p className="gb-venue-page__address">{venue.address}</p> : null}
    </header>
    {venue?<><div className="gb-venue-layout"><div className="gb-venue-layout__main"><div className="gb-venue-media"><VenueGallery venue={venue} size="page" /></div><VenuePublicProfile venue={venue} omitContacts /><GamesMapView cityId={venue.cityId} day={context.day} venueId={venue.id} activity={activity}/><div className="gb-venue-community"><VenueCommunityRating venueId={venue.id} signedIn={Boolean(me?.id && me.csrfToken)} actorId={me?.id ?? null} csrfToken={me?.csrfToken ?? null} authReturnPath={authReturnPath} /><section className="gb-venue-community__panel" id="discussion" aria-labelledby="discussion-title"><div className="gb-venue-community__heading"><div><h2 id="discussion-title">Обсуждение и фотографии</h2><p>Вопросы и впечатления о площадке · не проверенные отзывы после игры</p></div></div><p className="gb-venue-community__limitation">Добавление фотографий к публикациям появится позже. Сейчас доступен текст.</p><CommentsSection kind="venue" entityId={venue.id} me={me} description="Обсуждение площадки" authReturnPath={`${authReturnPath}#discussion`} parentPublic /></section><SurfacePanel tone="bordered" aria-label="Отзывы после игры" id="reviews"><VenueReviewsPanel venueId={venue.id} csrfToken={me?.csrfToken ?? null} canWrite={Boolean(me?.id && me.csrfToken)} onLogin={()=>{ window.location.href=`/auth?returnTo=${encodeURIComponent(authReturnPath)}`; }} /></SurfacePanel></div></div><aside className="gb-venue-layout__rail" aria-label="Контекст площадки"><VenuePublicContacts value={venue.publicContacts} /><div className="gb-venue-rail-note"><strong>На карте</strong><p>Вернитесь к карте, чтобы увидеть площадку среди публичных игр города.</p><Button variant="outline" href={context.returnTo}>К карте</Button></div></aside></div>
    </>:error?<div role="alert"><p>Площадка недоступна.</p><Button onClick={()=>setReload(v=>v+1)}>Повторить</Button></div>:<p role="status">Загружаем площадку…</p>}
  </div></ConsumerShell>;
}
