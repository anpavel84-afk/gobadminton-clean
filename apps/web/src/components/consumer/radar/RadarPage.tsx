"use client";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { candidateMapAllowed, publicDevMapAllowed } from "../../../lib/radar-map-assets";
import { distanceText } from "../../../lib/unified-directory";
import { Button } from "../Button";
import { RadarSwitchControl, RadarStatusControls } from "./RadarControls";
import { UnifiedPlayerPreview } from "./UnifiedPlayerPreview";
import { useDirectoryFilters, useRadarSession, useUnifiedDirectory } from "./RadarSessionProvider";
import "../../../styles/radar-geographic.css";
const GeographicRadarMap = dynamic(() => import("./GeographicRadarMap").then(m => m.GeographicRadarMap), { ssr: false });
export function RadarPage() {
  const { view: session } = useRadarSession(); const { controller, view } = useUnifiedDirectory();
  const { filters } = useDirectoryFilters();
  const [venueCount, setVenueCount] = useState<number | null>(null);
  const [failed, setFailed] = useState(false); const [listOpen, setListOpen] = useState(false); const [expanded, setExpanded] = useState(false);
  const [candidate, setCandidate] = useState(false); const sheet = useRef<HTMLElement>(null); const touchY = useRef<number | null>(null); const trigger = useRef<HTMLElement | null>(null);
  const snapshot = view.snapshot;
  const mapCityId = snapshot?.cityId ?? filters.cityId;
  useEffect(() => {
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = overflow; };
  }, []);
  useEffect(() => {
    const host = window.location.hostname;
    setCandidate(snapshot ? candidateMapAllowed(snapshot, host) : publicDevMapAllowed(host, mapCityId));
    setFailed(false);
  }, [snapshot?.query.queryRef, mapCityId]);
  useEffect(() => { if (candidate && controller && !view.mapPage && !view.busy) void controller.map(); }, [candidate, controller, view.mapPage, view.busy]);
  useEffect(() => { if (view.selected) { setExpanded(false); } else { if (trigger.current?.isConnected) trigger.current.focus(); } }, [view.selected]);
  useEffect(() => { if (listOpen) sheet.current?.focus(); }, [listOpen]);
  const mapped = candidate && !failed;
  function close() { controller?.close(); setListOpen(false); setExpanded(false); }
  return <main id="gb-main" className="gb-consumer g2-radar-map fr3" aria-label="Карта участников Radar">
    <header className="g2-map-header"><Link className="g2-map-back" href="/players">← К списку</Link><span><strong>Участники Radar</strong><small>{session.confirmedOn ? "Вы делитесь геопозицией" : "Вы смотрите, не делясь геопозицией"}</small></span><RadarSwitchControl map /></header>
    <div className="g2-map-session"><RadarStatusControls map /></div>
    {mapped ? <GeographicRadarMap controller={controller} rows={snapshot && view.mapPage ? view.pins : []} selected={view.selected} onSelect={row => { trigger.current = document.activeElement as HTMLElement; setListOpen(false); void controller?.select(row); }} onVenueCount={setVenueCount} onUnavailable={() => setFailed(true)} /> : <section className="g2-map-fallback"><h1>{failed ? "Не удалось загрузить карту" : "Карта пока недоступна"}</h1><p>{!snapshot ? "Карта пока доступна только для Москвы. Выберите Москву в списке игроков." : "Карта пока доступна только для Москвы. Другие города остаются в списке игроков."}</p><Button href="/players">К списку игроков</Button></section>}
    {mapped && <><div className="g2-map-summary"><button disabled={!snapshot || !controller} aria-expanded={listOpen} aria-controls="g2-map-panel" onClick={() => { trigger.current = document.activeElement as HTMLElement; if (!listOpen) controller?.close(); setListOpen(!listOpen); }}>{`${venueCount ?? "…"} площадок · ${snapshot && view.mapPage ? view.pins.length : 0} игроков Radar`}</button><small>Площадки — публичный каталог. Игроки отображаются только при наличии разрешённой сервером Radar-сессии. {view.mapPage?.hasMore ? "Показана часть участников." : ""}</small>{view.mapPage?.nextMapCursor && <Button variant="outline" disabled={view.busy} onClick={() => void controller?.map(true)}>Следующие точки</Button>}{view.notice && <small role="status">{view.notice}</small>}</div>
      {snapshot && !view.busy && view.mapPage && !view.pins.length && <p className="g2-map-empty" role="status">Нет участников с действующей разрешённой геопозицией. Площадки остаются на карте.</p>}
      {(listOpen || view.selected) && <aside id="g2-map-panel" ref={sheet} tabIndex={-1} aria-label="Игроки на карте" className={`g2-map-panel ${expanded || listOpen ? "is-expanded" : ""}`} onKeyDown={e => { if (e.key === "Escape") close(); }}>
        <header onTouchStart={e => { touchY.current = e.touches[0]?.clientY ?? null; }} onTouchEnd={e => { const y = e.changedTouches[0]?.clientY; if (touchY.current !== null && y !== undefined) { if (y - touchY.current > 70) setExpanded(false); if (touchY.current - y > 70) setExpanded(true); } touchY.current = null; }}><button aria-label={expanded ? "Свернуть карточку" : "Развернуть карточку"} aria-expanded={expanded} className="g2-sheet-handle" onClick={() => setExpanded(!expanded)}>—</button><button aria-label="Закрыть карточку игрока" onClick={close}>×</button></header>
        {view.selected ? <UnifiedPlayerPreview onClose={close} /> : <><h2>Игроки на карте</h2>{view.pins.map(row => <button className="g2-map-list-row" key={row.publicPlayerId} onClick={() => { trigger.current = document.activeElement as HTMLElement; setListOpen(false); void controller?.select(row); }}><strong>{row.player.displayName}</strong><small>{distanceText(row.radar?.distance ?? null) ?? "Расстояние неизвестно"}</small></button>)}</>}
      </aside>}
    </>}
  </main>;
}
