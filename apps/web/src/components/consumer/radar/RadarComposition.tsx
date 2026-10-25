"use client";
import { CloseButton } from "../CloseButton";
import { useEffect, useRef, type ReactNode } from "react";
import { bandLabel, RADAR_DISCLOSURE, radarLevel, radarPosition } from "../../../lib/radar-presentation";
import type { RadarItem, RadarPreview } from "../../../lib/radar-types";
import { Avatar, Badge } from "../players/ProfileComposition";
import { Button } from "../Button";

export function RadarCanvas({ items, selected, onSelect, active }: { items: RadarItem[]; selected: string | null; onSelect: (item: RadarItem) => void; active: boolean }) {
  return <section className="radar-field" aria-label="Схема близости" aria-describedby="radar-disclosure"><div className="radar-map-motifs" aria-hidden="true"><span className="radar-map-river radar-map-river--one" /><span className="radar-map-river radar-map-river--two" /><i className="radar-map-line radar-map-line--one" /><i className="radar-map-line radar-map-line--two" /><i className="radar-map-line radar-map-line--three" /><i className="radar-map-line radar-map-line--four" /></div><div className="radar-orbits">
    <i className="radar-zone radar-zone--outer" aria-hidden="true" /><i className="radar-zone radar-zone--middle" aria-hidden="true" /><i className="radar-zone radar-zone--near" aria-hidden="true" />
    <span className="radar-zone-label radar-zone-label--outer">Дальняя зона</span><span className="radar-zone-label radar-zone-label--middle">Средняя зона</span><span className="radar-zone-label radar-zone-label--near">Ближняя зона</span>
    <div className={`radar-own ${active ? "is-active" : ""}`}><i /><i /><span>Вы</span></div>
    {items.map(item => <button type="button" key={item.resultId} className={`radar-marker ${item.player.trainer ? "is-trainer" : ""}`} style={radarPosition(item)} aria-label={`${item.player.displayName} · ${bandLabel[item.proximityBand]}`} aria-pressed={selected === item.resultId} onClick={() => onSelect(item)}><Avatar avatar={item.player.avatar} name={item.player.displayName} tone={item.player.trainer ? "purple" : "yellow"} /></button>)}
  </div><p id="radar-disclosure" className="radar-disclosure">{RADAR_DISCLOSURE} Схема близости. Точки расположены условно и не показывают район или направление. Точное положение не показывается.</p></section>;
}
export function RadarResults({ items, selected, onSelect, preview, loading, actions, children }: { items: RadarItem[]; selected: string | null; onSelect: (item: RadarItem) => void; preview: RadarPreview | null; loading: boolean; actions?: ReactNode; children?: ReactNode }) {
  return <><header className="radar-panel-heading"><small>Игроки рядом</small><h2>Рядом с вами</h2></header><p className="radar-panel-disclosure">{RADAR_DISCLOSURE}</p>{children}
    <ol className="radar-result-list" aria-label="Игроки рядом">{items.map(item => <li key={item.resultId}><button type="button" aria-pressed={selected === item.resultId} onClick={() => onSelect(item)}><Avatar avatar={item.player.avatar} name={item.player.displayName} tone={item.player.trainer ? "purple" : "yellow"} /><span><strong>{item.player.displayName}</strong><small>{bandLabel[item.proximityBand]}{item.player.trainer ? " · Тренер" : ""}</small></span></button></li>)}</ol>
    {loading && <p role="status">Открываем профиль…</p>}
    {preview && <article className="radar-player-preview"><Avatar avatar={preview.player.avatar} name={preview.player.displayName} tone={preview.player.trainer ? "purple" : "yellow"} /><div><h3>{preview.player.displayName}</h3><strong>{radarLevel(preview.player)}</strong><p>{bandLabel[preview.proximityBand]}</p>{preview.player.trainer && <Badge trainer>Тренер</Badge>}</div><Button variant="dark" href={`/players/${preview.player.publicPlayerId}`}>Открыть профиль</Button>{actions}</article>}
  </>;
}
/** Non-modal drawer/sheet keeps the persistent Stop/status and navigation operable. */
export function RadarPanel({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open || !window.matchMedia("(max-width: 900px)").matches) return;
    const trigger = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    return () => { if (trigger?.isConnected) trigger.focus(); };
  }, [open]);
  return <aside ref={panel} id="radar-results" tabIndex={-1} className={`radar-panel ${open ? "is-open" : ""}`} aria-label="Список и профиль игроков" onKeyDown={e => { if (e.key === "Escape") onClose(); }}><div className="radar-panel-toolbar"><i className="radar-sheet-handle" /><CloseButton aria-label="Закрыть список" onClick={onClose} /></div><div className="radar-panel-scroll">{children}</div></aside>;
}
