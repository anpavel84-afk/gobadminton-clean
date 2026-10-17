"use client";
import { useEffect, useState } from "react";
import type { ActivityKind, Venue } from "../../../lib/consumer-types";
import { ConsumerShell } from "../ConsumerShell";
import { Button } from "../Button";
import { VenueCover } from "./VenueCover";
import { GamesMapView } from "../games/GamesMapView";
import { gamesMapReturnPath } from "../../../lib/games-venue-map";
import { VenueCoverEditor } from "./VenueCoverEditor";
export function VenuePage({venueId}:{venueId:string}) {
  const [context,setContext]=useState({day:"",returnTo:"/games?view=map"});
  useEffect(()=>{ const query=new URLSearchParams(window.location.search); setContext({day:query.get("day") ?? "",returnTo:gamesMapReturnPath(query.get("returnTo"))}); },[]);
  const activityValue = new URLSearchParams(context.returnTo.split("?")[1] ?? "").get("activity");
  const activity: "all" | ActivityKind = activityValue === "regular" || activityValue === "trainer_led" ? activityValue : "all";
  const [venue,setVenue]=useState<Venue|null>(null);
  const [error,setError]=useState(false);
  const [reload,setReload]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();let active=true;setError(false);setVenue(null);
    const timer=setTimeout(()=>controller.abort(),15000);
    void fetch(`/v1/venues/${encodeURIComponent(venueId)}`,{cache:"no-store",signal:controller.signal}).then(async r=>{
      if(!r.ok)throw new Error("unavailable");const value=await r.json() as Venue;
      if(active&&!controller.signal.aborted)setVenue(value);
    }).catch(()=>{if(active)setError(true);}).finally(()=>clearTimeout(timer));
    return ()=>{active=false;controller.abort();clearTimeout(timer);};
  },[venueId,reload]);
  return <ConsumerShell active="games" title="Площадка" mode="page" hideHeading><div className="gb-venue-page">
    <Button variant="ghost" href={context.returnTo}>Назад к карте</Button>
    {venue?<><h1>{venue.name}</h1><p>{venue.address}</p><div className="gb-venue-media"><VenueCover name={venue.name} cover={venue.cover}/></div><GamesMapView cityId={venue.cityId} day={context.day} venueId={venue.id} activity={activity}/>
      <VenueCoverEditor key={venue.id} venueId={venue.id} onChange={receipt=>setVenue(v=>v?{...v,cover:receipt.cover}:v)}/>
    </>:error?<div role="alert"><p>Площадка недоступна.</p><Button onClick={()=>setReload(v=>v+1)}>Повторить</Button></div>:<p role="status">Загружаем площадку…</p>}
  </div></ConsumerShell>;
}
