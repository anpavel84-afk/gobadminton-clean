"use client";
import { useEffect, useRef } from "react";
import { bandLabel, RADAR_DISCLOSURE, RADAR_EMPTY, radarLevel } from "../../../lib/radar-presentation";
import { Button } from "../Button";
import { Avatar, Badge } from "../players/ProfileComposition";
import { RadarContact } from "./RadarContact";
import { useRadarSession } from "./RadarSessionProvider";

export function RadarNearbyList() {
  const { controller, view } = useRadarSession(); const heading = useRef<HTMLHeadingElement>(null);
  const selected = view.items.find(i => i.resultId === view.selected);
  const previous = useRef(view.selected);
  useEffect(() => {
    if (previous.current && !view.selected && document.activeElement?.closest(".radar-inline-preview")) heading.current?.focus();
    previous.current = view.selected;
  }, [view.selected]);
  return <section className="players-list radar-nearby-list" aria-busy={view.loading}><div className="players-list__heading"><span><small>От ближних к дальним</small><h2 tabIndex={-1} ref={heading}>Рядом с вами</h2></span><Button variant="ghost" disabled={view.phase !== "active" || view.loading} onClick={() => controller?.refresh()}>Обновить список</Button></div><p className="radar-list-disclosure">Порядок приблизительный: от ближних к дальним. {RADAR_DISCLOSURE}</p>
    {view.phase !== "active" ? <p role="status">Результаты появятся после подтверждения Radar.</p> : view.loading && !view.items.length ? <p role="status">Ищем игроков рядом…</p> : !view.items.length ? <p role="status">{RADAR_EMPTY}</p> : null}
    <ol className="radar-ordered-players" aria-label="Участники Radar рядом">{view.items.map(item => <li key={item.player.publicPlayerId}><article className="player-card radar-player-card"><Avatar avatar={item.player.avatar} name={item.player.displayName} tone={item.player.trainer ? "purple" : "yellow"} /><div className="player-card__main"><div className="player-card__title"><h3>{item.player.displayName}</h3>{item.player.trainer && <Badge trainer>Тренер</Badge>}</div><strong>{radarLevel(item.player)}</strong><span>{bandLabel[item.proximityBand]}</span></div><Button variant="outline" aria-label={`Посмотреть ${item.player.displayName}`} aria-expanded={view.selected === item.resultId} onClick={() => { if (view.selected === item.resultId) controller?.closePreview(); else void controller?.select(item); }}>Посмотреть</Button></article>
      {selected?.resultId === item.resultId && <section className="radar-inline-preview radar-player-preview" aria-label={`Профиль ${item.player.displayName}`}><div><h3>{item.player.displayName}</h3>{view.previewLoading && <p role="status">Открываем профиль…</p>}{view.preview && <><strong>{radarLevel(view.preview.player)}</strong><p>{bandLabel[view.preview.proximityBand]}</p><Button variant="dark" href={`/players/${item.player.publicPlayerId}`}>Открыть профиль</Button></>}</div><Button variant="ghost" onClick={() => { controller?.closePreview(); heading.current?.focus(); }}>Закрыть профиль</Button>{view.me && view.preview && <RadarContact key={item.resultRef} me={view.me} item={{ ...item, player: view.preview.player }} />}</section>}
    </li>)}</ol>
  </section>;
}
