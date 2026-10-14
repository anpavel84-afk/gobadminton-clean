"use client";

import "../../../styles/radar-geographic.css";
import { useEffect, useState } from "react";
import { listCities, listPlayers } from "../../../lib/api-client";
import type { City, PublicPlayer } from "../../../lib/consumer-types";
import { readSelectedLocation } from "../../../lib/location-context";
import { isSocialDirectoryDisabled } from "../../../lib/player-presentation";
import { Button } from "../Button";
import { ConsumerShell } from "../ConsumerShell";
import { RadarSwitchControl, RadarStatusControls } from "../radar/RadarControls";
import { UnifiedPlayerCard } from "../radar/UnifiedPlayerCard";
import { UnifiedPlayerPreview } from "../radar/UnifiedPlayerPreview";
import { useUnifiedDirectory, useRadarConfig } from "../radar/RadarSessionProvider";
import type { UnifiedFilters } from "@gobadminton/contracts";
import { MOSCOW_BUNDLE } from "../../../lib/radar-map-assets";
import { unifiedDirectoryAvailable } from "../../../lib/unified-directory";
import { useRadarSession, useDirectoryFilters } from "../radar/RadarSessionProvider";
import { AuthEntry, PlayerCard, ProfileState } from "../players/ProfileComposition";

export function PlayersDirectoryPage() {
  const [players, setPlayers] = useState<PublicPlayer[]>([]);
  const [cities, setCities] = useState<City[]>([]);
  const [state, setState] = useState("loading");
  const { controller, view } = useRadarSession();
  const { filters, update } = useDirectoryFilters();
  const { name, areaKey, cityId, lookingOnly, trainerOnly } = filters;
  const setName = (value: string) => update({ name: value });
  const setAreaKey = (value: string) => update({ areaKey: value });
  const setCityId = (value: string) => update({ cityId: value });
  const setLookingOnly = (value: boolean) => update({ lookingOnly: value });
  const setTrainerOnly = (value: boolean) => update({ trainerOnly: value });
  const directory = useUnifiedDirectory();
  const config = useRadarConfig();
  const unifiedMode = directory.view.mode === "unified";
  // Ordinary profiles remain usable while the private Radar context loads/expires.
  const directoryVisible = !unifiedMode || !directory.view.snapshot;
  const effectiveCityId = cityId || config?.cities.find(c => c.cityId === MOSCOW_BUNDLE.cityId)?.cityId || "";
  const queryFilters: UnifiedFilters = { cityId: effectiveCityId, ...(areaKey.trim() ? { areaKey: areaKey.trim() } : {}), ...(name.trim().length >= 2 ? { name: name.trim() } : {}), ...(lookingOnly ? { looking: true } : {}), ...(trainerOnly ? { trainer: true } : {}) };
  const unifiedAvailable = unifiedDirectoryAvailable(config, directory.view);
  const eligibleCity = unifiedAvailable && config?.cities.some(c => c.cityId === effectiveCityId) === true;
  const filterKey = JSON.stringify(queryFilters);
  const activationId = view.status?.state === "active" && view.status.contractVersion === "players-unified-radar-v1" && !view.pendingStop ? view.status.activationId : null;
  const activationKey = activationId && view.status && "version" in view.status ? `${activationId}:${view.status.version}` : null;
  useEffect(() => {
    const unified = directory.controller;
    if (!unified) return;
    if (!activationId || view.pendingStop || !eligibleCity || !unifiedAvailable) { unified.ordinary(); return; }
    const query = () => {
      if (!unified.snapshot().busy && !unified.matches(queryFilters, activationKey)) void unified.query(queryFilters, { kind: "current_activation", activationId }, activationKey);
    };
    query();
    const timer = setInterval(query, 30000);
    return () => clearInterval(timer);
  }, [directory.controller, activationKey, view.pendingStop, eligibleCity, unifiedAvailable, filterKey]);
  const [reload, setReload] = useState(0);
  const [cursor, setCursor] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [moreBusy, setMoreBusy] = useState(false);
  useEffect(() => {
    if (!controller) return;
    if (controller.listScrollY) requestAnimationFrame(() => window.scrollTo(0, controller.listScrollY));
    return () => { controller.listScrollY = window.scrollY; };
  }, [controller]);
  useEffect(() => { if (controller?.listScrollY && state === "ready") requestAnimationFrame(() => window.scrollTo(0, controller.listScrollY)); }, [controller, state]);
  const filtered = Boolean(name.trim().length >= 2 || areaKey.trim() || cityId || lookingOnly || trainerOnly);
  // Read session city after mount so SSR/client first paint stay aligned (hydration).
  useEffect(() => {
    const selected = readSelectedLocation()?.cityId ?? "";
    if (selected && !cityId) setCityId(selected);
  }, []);
  useEffect(() => { let live = true; void listCities().then(r => { if (live && r.ok) setCities(r.data.items); }); return () => { live = false; }; }, []);
  useEffect(() => {
    if (!directoryVisible) { setCursor(null); return; }
    let live = true;
    if (!cursor) { setPlayers([]); setState("loading"); } else setMoreBusy(true);
    const timer = setTimeout(() => { void listPlayers({ cityId: cityId || undefined, areaKey: areaKey.trim() || undefined, name: name.trim().length >= 2 ? name.trim() : undefined, looking: lookingOnly || undefined, trainer: trainerOnly || undefined, cursor: cursor ?? undefined, limit: 50 }).then(result => {
      if (!live) return;
      setMoreBusy(false);
      if (!result.ok) { setState(isSocialDirectoryDisabled(result) ? "unavailable" : "error"); return; }
      setPlayers(previous => cursor ? [...previous, ...result.data.items.filter(p => !previous.some(old => old.publicPlayerId === p.publicPlayerId))] : result.data.items);
      setNextCursor(result.data.nextCursor); setState(result.data.items.length || cursor ? "ready" : "empty");
    }); }, 200);
    return () => { live = false; clearTimeout(timer); };
  }, [cityId, areaKey, name, lookingOnly, trainerOnly, reload, cursor, directoryVisible]);
  function reset() { setName(""); setAreaKey(""); setCityId(""); setLookingOnly(false); setTrainerOnly(false); setCursor(null); }
  const cityName = cities.find(c => c.id === cityId)?.nameRu;
  return <ConsumerShell active="players" title="Игроки" hideHeading><div className="fr3 players-page" data-surface="players-directory" data-state={state}>
    <section className="players-hero"><div><span className="eyebrow">Игровое сообщество</span><h1>Игроки</h1><p>Находите партнёров по уровню, району и игровому настрою.</p></div><RadarSwitchControl /></section>
    <RadarStatusControls />
    {activationId && <div className="unified-actions"><Button href="/players/radar" variant="dark">Показать на карте</Button></div>}
    {directory.view.authenticationRequired && <AuthEntry returnPath="/players">Войти для участников Radar</AuthEntry>}
    {!unifiedMode && directory.view.notice && <section className="radar-notice"><span role="status"><strong>{directory.view.notice}</strong></span></section>}
    <section className="player-controls" role="search" aria-label="Фильтры каталога">
      <label className="player-location"><span>Город</span><select aria-label="Город" value={cityId} onChange={e => { setCityId(e.target.value); setCursor(null); }}><option value="">Все города</option>{cities.map(c => <option value={c.id} key={c.id}>{c.nameRu}</option>)}</select></label>
      <label className="player-search"><img className="profile-icon" src="/canonical/search.svg" alt="" /><input aria-label="Найти игрока" type="search" placeholder="Найти игрока" value={name} onChange={e => { setName(e.target.value); setCursor(null); }} /></label>
      <button className={`chip ${lookingOnly ? "chip--active" : ""}`} aria-pressed={lookingOnly} onClick={() => { setLookingOnly(!lookingOnly); setCursor(null); }}>Ищу игру</button>
      <button className={`chip ${trainerOnly ? "chip--active" : ""}`} aria-pressed={trainerOnly} onClick={() => { setTrainerOnly(!trainerOnly); setCursor(null); }}>Тренер</button>
      <label className="player-search area-filter"><input aria-label="Район" placeholder="Район" value={areaKey} maxLength={64} onChange={e => { setAreaKey(e.target.value); setCursor(null); }} /></label>
    </section>
    <section className="players-list"><div className="players-list__heading"><span><small>{filtered ? "Подходят по фильтрам" : "Игровое сообщество"}</small><h2>{cityName ? `Игроки · ${cityName}` : "Все игроки"}</h2></span><button onClick={reset}>Сбросить фильтры</button></div>
      {unifiedMode && directory.view.snapshot && <div className="unified-directory" aria-busy={directory.view.busy}><p role="status">{directory.view.notice || "Ищем участников Radar…"}</p>{directory.view.snapshot && <p>{directory.view.snapshot.query.originState === "authorized" ? "Участники Radar по близости" : "Участники Radar по городу"} · {directory.view.snapshot.totals.radarTotal}; всего игроков: {directory.view.snapshot.totals.matchingTotal}</p>}{directory.view.rows.map(row => <UnifiedPlayerCard key={row.publicPlayerId} row={row} city={cities.find(c => c.id === row.player.cityId)?.nameRu} onSelect={() => void directory.controller?.select(row)} />)}{directory.view.snapshot?.page.nextCursor && <Button variant="outline" disabled={directory.view.busy} onClick={() => void directory.controller?.more()}>Показать ещё</Button>}{directory.view.snapshot?.totals.matchingTotal === 0 && <ProfileState title="Никого не нашли" state="empty">Попробуйте изменить фильтры.</ProfileState>}</div>}
      {directoryVisible && state === "loading" && <ProfileState title="Ищем игроков…" state="loading" />}
      {directoryVisible && state === "unavailable" && <ProfileState title="Каталог игроков сейчас недоступен" state="unavailable">Попробуйте вернуться позже.</ProfileState>}
      {directoryVisible && state === "error" && <ProfileState title="Не удалось загрузить каталог" state="error" retry={() => setReload(n => n + 1)}>Проверьте соединение и попробуйте снова.</ProfileState>}
      {directoryVisible && state === "empty" && <ProfileState title={filtered ? "Никого не нашли" : "Игроков пока нет"} state="empty">{filtered ? "Попробуйте изменить или сбросить фильтры." : "Вернитесь немного позже."}</ProfileState>}
      {directoryVisible && state === "ready" && <><div aria-label="Каталог игроков">{players.map(player => <PlayerCard key={player.publicPlayerId} player={player} city={cities.find(c => c.id === player.cityId)?.nameRu} />)}</div>{nextCursor && <Button variant="outline" disabled={moreBusy} onClick={() => setCursor(nextCursor)}>{moreBusy ? "Загрузка…" : "Показать ещё"}</Button>}</>}
    </section>
    {directory.view.selected && <UnifiedPlayerPreview dialog onClose={() => directory.controller?.close()} />}
  </div></ConsumerShell>;
}
