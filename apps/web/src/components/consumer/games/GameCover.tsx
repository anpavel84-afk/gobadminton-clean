"use client";
import { useState } from "react";
import { VenueCover, venueCoverUrl } from "../venues/VenueCover";
export function gameCoverUrl(url:unknown):string|null {
  return typeof url==="string" && /^\/v1\/media\/game-covers\/[a-f0-9]{64}\.png$/.test(url)?url:venueCoverUrl(url);
}
/** All game surfaces consume the same server projection. Organizer avatars stay separate. */
export function GameCover({game,className=""}:{game:{cover?:{uploadedUrl:string|null};venue:{cover?:{uploadedUrl:string|null};name:string}};className?:string}){
  const url=gameCoverUrl(game.cover?.uploadedUrl);
  const [failed,setFailed]=useState<string|null>(null);
  if(!url || failed===url)return <VenueCover className={className} cover={game.venue.cover} name={game.venue.name}/>;
  return <span className={`gb-venue-cover ${className}`} data-cover="uploaded"><img src={url} alt={`Обложка игры: ${game.venue.name}`} loading="lazy" decoding="async" onError={()=>setFailed(url)}/></span>;
}
