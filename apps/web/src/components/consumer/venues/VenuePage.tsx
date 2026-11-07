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

export function VenuePage({venueId}:{venueId:string}) {
  const [context,setContext]=useState({day:"",returnTo:"/games?view=map"});
  useEffect(()=>{ const query=new URLSearchParams(window.location.search); setContext({day:query.get("day") ?? "",returnTo:gamesMapReturnPath(query.get("returnTo"))}); },[]);
  const activityValue = new URLSearchParams(context.returnTo.split("?")[1] ?? "").get("activity");
  const activity: "all" | ActivityKind = activityValue === "regular" || activityValue === "trainer_led" ? activityValue : "all";
  const [reload,setReload]=useState(0);
  const [result,setResult]=useState<{venueId:string;reload:number;venue:Venue|null;error:boolean}|null>(null);
  const [csrf,setCsrf]=useState<string|null>(null);
  const [signedIn,setSignedIn]=useState(false);
  // A prop change hides the old profile before the next effect runs.
  const current=result?.venueId===venueId&&result.reload===reload?result:null;
  const venue=current?.venue ?? null;
  const error=current?.error ?? false;
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
    if(shouldSkipUnauthenticatedPrivateGet("/v1/me","GET")){setSignedIn(false);setCsrf(null);return;}
    const controller=new AbortController();
    void fetch("/v1/me",{cache:"no-store",credentials:"include",signal:controller.signal})
      .then(async (r)=>{
        if(!r.ok){setSignedIn(false);setCsrf(null);return;}
        const body=await r.json() as {csrfToken?:string};
        setSignedIn(true);
        setCsrf(typeof body.csrfToken==="string"?body.csrfToken:null);
      })
      .catch(()=>{setSignedIn(false);setCsrf(null);});
    return ()=>controller.abort();
  },[venueId]);
  return <ConsumerShell active="games" title="Площадка" mode="page" hideHeading><div className="gb-venue-page">
    <header className="gb-page-local-header">
      <Button variant="ghost" className="gb-game-back" href={context.returnTo}>← Назад к карте</Button>
      {venue ? <h1>{venue.name}</h1> : null}
      {venue ? <p className="gb-venue-page__address">{venue.address}</p> : null}
    </header>
    {venue?<><div className="gb-venue-layout"><div className="gb-venue-layout__main"><div className="gb-venue-media"><VenueGallery venue={venue} size="page" /></div><VenuePublicProfile venue={venue} omitContacts /><GamesMapView cityId={venue.cityId} day={context.day} venueId={venue.id} activity={activity}/><SurfacePanel tone="bordered" aria-label="Отзывы о площадке"><VenueReviewsPanel venueId={venue.id} csrfToken={csrf} canWrite={signedIn && Boolean(csrf)} onLogin={()=>{ window.location.href=`/auth?returnTo=${encodeURIComponent(`/venues/${venue.id}`)}`; }} /></SurfacePanel></div><aside className="gb-venue-layout__rail" aria-label="Контекст площадки"><VenuePublicContacts value={venue.publicContacts} /><div className="gb-venue-rail-note"><strong>На карте</strong><p>Вернитесь к карте, чтобы увидеть площадку среди публичных игр города.</p><Button variant="outline" href={context.returnTo}>К карте</Button></div></aside></div>
    </>:error?<div role="alert"><p>Площадка недоступна.</p><Button onClick={()=>setReload(v=>v+1)}>Повторить</Button></div>:<p role="status">Загружаем площадку…</p>}
  </div></ConsumerShell>;
}
