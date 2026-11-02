"use client";
import { useEffect, useRef, useState } from "react";
import { getMe } from "../../../lib/api-client";
import type { ActivityKind, Me, Venue } from "../../../lib/consumer-types";
import { ConsumerShell } from "../ConsumerShell";
import { Button } from "../Button";
import { CommentsSection } from "../comments/CommentsSection";
import { VenueGallery } from "./VenueGallery";
import { VenuePublicProfile } from "./VenuePublicProfile";
import { VenuePublicContacts } from "../games/VenueSheet";
import { GamesMapView } from "../games/GamesMapView";
import { gamesMapReturnPath } from "../../../lib/games-venue-map";
export function VenuePage({venueId}:{venueId:string}) {
  const [context,setContext]=useState({day:"",returnTo:"/games?view=map"});
  useEffect(()=>{ const query=new URLSearchParams(window.location.search); setContext({day:query.get("day") ?? "",returnTo:gamesMapReturnPath(query.get("returnTo"))}); },[]);
  const activityValue = new URLSearchParams(context.returnTo.split("?")[1] ?? "").get("activity");
  const activity: "all" | ActivityKind = activityValue === "regular" || activityValue === "trainer_led" ? activityValue : "all";
  const [reload,setReload]=useState(0);
  const [meReload,setMeReload]=useState(0);
  const [result,setResult]=useState<{venueId:string;reload:number;venue:Venue|null;error:boolean}|null>(null);
  const [me,setMe]=useState<Me|null>(null);
  const meEpoch=useRef(0);
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
  // Same fence as OwnedGameSummaryPage: expiry clears me + invalidates epoch (no getMe reload loop).
  useEffect(()=>{
    const request=++meEpoch.current;
    setMe(null);
    void getMe().then((account)=>{
      if(request!==meEpoch.current)return;
      if(account.ok)setMe(account.data);
      else setMe(null);
    }).catch(()=>{ if(request===meEpoch.current)setMe(null); });
    return ()=>{ ++meEpoch.current; };
  },[venueId,meReload]);
  useEffect(()=>{
    const clearPrivate=()=>{ ++meEpoch.current; setMe(null); };
    const onSession=()=>{ clearPrivate(); setMeReload((n)=>n+1); };
    // private-expired: clear only — do not bump meReload (avoids getMe 401 → gb-private-expired loop).
    window.addEventListener("gb-private-expired", clearPrivate);
    window.addEventListener("gb-session-changed", onSession);
    return ()=>{
      window.removeEventListener("gb-private-expired", clearPrivate);
      window.removeEventListener("gb-session-changed", onSession);
    };
  },[]);
  // Comments bind to canonical venue.id after UI alias resolution; stale ids never enabled here.
  const commentsParentPublic = Boolean(venue && venue.id);
  return <ConsumerShell active="games" title="Площадка" mode="page" hideHeading><div className="gb-venue-page">
    <header className="gb-page-local-header">
      <Button variant="ghost" className="gb-game-back" href={context.returnTo}>← Назад к карте</Button>
      {venue ? <h1>{venue.name}</h1> : null}
      {venue ? <p className="gb-venue-page__address">{venue.address}</p> : null}
    </header>
    {venue?<><div className="gb-venue-layout"><div className="gb-venue-layout__main"><div className="gb-venue-media"><VenueGallery venue={venue} size="page" /></div><VenuePublicProfile venue={venue} omitContacts /><GamesMapView cityId={venue.cityId} day={context.day} venueId={venue.id} activity={activity}/><CommentsSection kind="venue" entityId={venue.id} me={me} parentPublic={commentsParentPublic} authReturnPath={`/venues/${encodeURIComponent(venue.id)}`} description="Вопросы о площадке и полезные детали для встречи" /></div><aside className="gb-venue-layout__rail" aria-label="Контекст площадки"><VenuePublicContacts value={venue.publicContacts} /><div className="gb-venue-rail-note"><strong>На карте</strong><p>Вернитесь к карте, чтобы увидеть площадку среди публичных игр города.</p><Button variant="outline" href={context.returnTo}>К карте</Button></div></aside></div>
    </>:error?<div role="alert"><p>Площадка недоступна.</p><Button onClick={()=>setReload(v=>v+1)}>Повторить</Button></div>:<p role="status">Загружаем площадку…</p>}
  </div></ConsumerShell>;
}
