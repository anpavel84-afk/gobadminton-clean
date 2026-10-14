"use client";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { MOSCOW_BUNDLE, candidateMapConfigAllowed } from "../../../lib/radar-map-assets";
import { distanceText } from "../../../lib/unified-directory";
import { Button } from "../Button";
import { RadarStatusAffordance } from "./RadarSessionProvider";
import { UnifiedPlayerPreview } from "./UnifiedPlayerPreview";
import { useRadarSession, useUnifiedDirectory, useRadarConfig, useDirectoryFilters } from "./RadarSessionProvider";
import "../../../styles/radar-geographic.css";
const GeographicRadarMap = dynamic(() => import("./GeographicRadarMap").then(m => m.GeographicRadarMap), { ssr: false });
export function RadarPage() {
  const { view: session } = useRadarSession(); const { controller, view } = useUnifiedDirectory();
  const [failed, setFailed] = useState(false); const [listOpen, setListOpen] = useState(false); const [expanded, setExpanded] = useState(false);
  const [candidate, setCandidate] = useState(false); const sheet = useRef<HTMLElement>(null); const touchY = useRef<number | null>(null); const trigger = useRef<HTMLElement | null>(null);
  const snapshot = view.snapshot;
  const config = useRadarConfig(); const { filters } = useDirectoryFilters();
  const cityId = filters.cityId || config?.cities.find(c => c.cityId === MOSCOW_BUNDLE.cityId)?.cityId;
  const activationId = session.status?.state === "active" && session.status.contractVersion === "players-unified-radar-v1" && !session.pendingStop ? session.status.activationId : null;
  const activationKey = activationId && session.status && "version" in session.status ? `${activationId}:${session.status.version}` : null;
  const queryFilters = { cityId: cityId ?? "", areaKey: filters.areaKey.trim() || undefined, name: filters.name.trim().length >= 2 ? filters.name.trim() : undefined, looking: filters.lookingOnly || undefined, trainer: filters.trainerOnly || undefined };
  const filterKey = JSON.stringify(queryFilters);
  useEffect(() => {
    if (!controller || !activationId || !cityId || !config?.unifiedDirectory.enabled || !config.cities.some(c => c.cityId === cityId)) return;
    const recover = () => { const current = controller.snapshot(); if (!current.busy && !current.capabilityUnavailable && !current.authenticationRequired && !controller.matches(queryFilters, activationKey)) void controller.query(queryFilters, { kind: "current_activation", activationId }, activationKey); };
    recover(); const timer = setInterval(recover, 30000); return () => clearInterval(timer);
  }, [controller, activationKey, filterKey, config]);

  useEffect(() => {
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = overflow; };
  }, []);
  // Public DEV basemap registration is independent of expiring private
  // query tokens. Never use stale queries to authorize Radar pins.
  useEffect(() => {
    setCandidate(candidateMapConfigAllowed(config, cityId, window.location.origin) && Boolean(session.me));
    setFailed(false);
  }, [config, cityId, session.me?.id]);
  useEffect(() => {
    if (candidate && controller && snapshot && !view.mapPage && !view.busy) void controller.map();
  }, [candidate, controller, snapshot?.query.queryRef, view.mapPage, view.busy]);
  useEffect(() => { if (view.selected) { setExpanded(false); } else { if (trigger.current?.isConnected) trigger.current.focus(); } }, [view.selected]);
  useEffect(() => { if (listOpen) sheet.current?.focus(); }, [listOpen]);
  const mapped = candidate && !failed && controller && session.me;
  function close() { controller?.close(); setListOpen(false); setExpanded(false); }
  return <main id="gb-main" className="gb-consumer g2-radar-map fr3" aria-label="Карта участников Radar">
    <header className="g2-map-header"><Link className="g2-map-back" href="/players">← К списку</Link><span><strong>Участники Radar</strong></span><RadarStatusAffordance /></header>
    {mapped ? <GeographicRadarMap controller={controller} rows={view.pins} selected={view.selected} onSelect={row => { trigger.current = document.activeElement as HTMLElement; setListOpen(false); void controller.select(row); }} onUnavailable={() => setFailed(true)} /> : <section className="g2-map-fallback"><h1>{failed ? "Не удалось загрузить карту" : !config ? "Проверяем доступность карты…" : "Карта пока недоступна"}</h1><p>{failed ? "Проверьте подключение к картографическим ресурсам." : "Карта доступна для Москвы только на DEV после входа."}</p><Button href="/players">К списку игроков</Button></section>}
    {mapped && <><div className="g2-map-summary"><button aria-expanded={listOpen} aria-controls="g2-map-panel" onClick={() => { trigger.current = document.activeElement as HTMLElement; if (!listOpen) controller.close(); setListOpen(!listOpen); }}>{view.busy ? "Загружаем игроков…" : `На карте: ${view.pins.length} из ${snapshot?.totals.radarTotal ?? 0}`}</button><small>Приблизительные геопозиции. {view.mapPage?.hasMore ? "Показана часть участников." : ""}</small>{view.mapPage?.nextMapCursor && <Button variant="outline" disabled={view.busy} onClick={() => void controller.map(true)}>Следующие точки</Button>}{view.notice && <small role="status">{view.notice}</small>}</div>
      {!view.busy && !view.pins.length && <p className="g2-map-empty" role="status">{view.stale || !snapshot ? "Обновляем участников Radar. Карта города доступна." : "Нет участников с геопозицией. Обычные профили доступны в списке."}</p>}
      {(listOpen || view.selected) && <aside id="g2-map-panel" ref={sheet} tabIndex={-1} aria-label="Игроки на карте" className={`g2-map-panel ${expanded || listOpen ? "is-expanded" : ""}`} onKeyDown={e => { if (e.key === "Escape") close(); }}>
        <header onTouchStart={e => { touchY.current = e.touches[0]?.clientY ?? null; }} onTouchEnd={e => { const y = e.changedTouches[0]?.clientY; if (touchY.current !== null && y !== undefined) { if (y - touchY.current > 70) setExpanded(false); if (touchY.current - y > 70) setExpanded(true); } touchY.current = null; }}><button aria-label={expanded ? "Свернуть карточку" : "Развернуть карточку"} aria-expanded={expanded} className="g2-sheet-handle" onClick={() => setExpanded(!expanded)}>—</button><button aria-label="Закрыть карточку игрока" onClick={close}>×</button></header>
        {view.selected ? <UnifiedPlayerPreview onClose={close} /> : <><h2>Игроки на карте</h2>{view.pins.map(row => <button className="g2-map-list-row" key={row.publicPlayerId} onClick={() => { trigger.current = document.activeElement as HTMLElement; setListOpen(false); void controller.select(row); }}><strong>{row.player.displayName}</strong><small>{distanceText(row.radar?.distance ?? null) ?? "Расстояние неизвестно"}</small></button>)}</>}
      </aside>}
    </>}
  </main>;
}
