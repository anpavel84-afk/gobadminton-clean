"use client";

import "../../../styles/radar-geographic.css";
import "../../../styles/player-browse.css";
import { useEffect, useState } from "react";
import { listCities, listPlayers } from "../../../lib/api-client";
import type { City, PublicPlayer } from "../../../lib/consumer-types";
import { readSelectedLocation } from "../../../lib/location-context";
import { isSocialDirectoryDisabled } from "../../../lib/player-presentation";
import { parseBrowseView, writeBrowseViewSearch, type PlayerBrowseView } from "../../../lib/player-browse";
import { confirmedDirectoryActivation } from "../../../lib/radar-controller";
import { RadarSwitchControl, RadarStatusControls } from "../radar/RadarControls";
import { Button } from "../Button";
import { ConsumerShell } from "../ConsumerShell";
import { UnifiedPlayerCard } from "../radar/UnifiedPlayerCard";
import { UnifiedPlayerPreview } from "../radar/UnifiedPlayerPreview";
import { useUnifiedDirectory, useRadarConfig } from "../radar/RadarSessionProvider";
import type { UnifiedFilters } from "@gobadminton/contracts";
import { MOSCOW_BUNDLE } from "../../../lib/radar-map-assets";
import { mergeRadarCatalog, scopedCatalogCursor, unifiedDirectoryAvailable, type ScopedCatalogCursor } from "../../../lib/unified-directory";
import { useRadarSession, useDirectoryFilters } from "../radar/RadarSessionProvider";
import { AuthEntry, PlayerCard, ProfileState } from "../players/ProfileComposition";
import { PlayerBrowseDeck } from "../players/PlayerBrowseDeck";

export function PlayersDirectoryPage() {
  const [players, setPlayers] = useState<PublicPlayer[]>([]);
  const [cities, setCities] = useState<City[]>([]);
  const [state, setState] = useState("loading");
  // Default list for SSR/hydration; URL `view=cards` applies after mount.
  const [browseView, setBrowseView] = useState<PlayerBrowseView>("list");
  const [viewReady, setViewReady] = useState(false);
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
  const activationId = confirmedDirectoryActivation(view);
  // Radar query geography must never change the ordinary catalog selection.
  const queryCity = cityId || config?.cities.find(c => c.cityId === MOSCOW_BUNDLE.cityId)?.cityId || "";
  const queryFilters: UnifiedFilters = { cityId: queryCity, ...(areaKey.trim() ? { areaKey: areaKey.trim() } : {}), ...(name.trim().length >= 2 ? { name: name.trim() } : {}), ...(lookingOnly ? { looking: true } : {}), ...(trainerOnly ? { trainer: true } : {}) };
  const unifiedAvailable = unifiedDirectoryAvailable(config, directory.view);
  const eligibleCity = unifiedAvailable && config?.cities.some(c => c.cityId === queryCity) === true;
  const filterKey = JSON.stringify(queryFilters);

  const activationKey = activationId && view.status && "version" in view.status ? `${activationId}:${view.status.version}` : null;
  useEffect(() => {
    const unified = directory.controller;
    if (!unified) return;
    if (!activationId || view.pendingStop || !eligibleCity || !unifiedAvailable) { unified.ordinary(); return; }
    let cancelled = false;
    let arming = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      if (cancelled || arming) return;
      arming = true;
      try {
        if (timer !== undefined) clearTimeout(timer);
        if (!controller || confirmedDirectoryActivation(controller.snapshot()) !== activationId) { unified.ordinary(); return; }
        // Soft refresh stays !busy while pending; rely on matches + controller pending/cooldown gates.
        if (!unified.matches(queryFilters, activationKey)) {
          void unified.query(queryFilters, { kind: "current_activation", activationId }, activationKey);
        }
        // Schedule from controller refresh/cooldown/Retry-After (not a fixed 30s interval).
        const delay = Math.max(500, unified.nextRefreshAt() - Date.now());
        timer = setTimeout(arm, delay);
      } finally { arming = false; }
    };
    arm();
    // Re-arm on settlement so 429 Retry-After / 409/410 recover when allowed without hammering.
    const unsubscribe = unified.subscribe(arm);
    return () => { cancelled = true; if (timer !== undefined) clearTimeout(timer); unsubscribe(); };
  }, [controller, directory.controller, activationId, activationKey, view.pendingStop, eligibleCity, unifiedAvailable, filterKey]);
  const [reload, setReload] = useState(0);
  // Radar toggles do not change the ordinary query or its pagination.
  const ordinaryScope = JSON.stringify({ city: cityId, areaKey, name, lookingOnly, trainerOnly });
  const [cursor, setCursor] = useState<ScopedCatalogCursor | null>(null);
  const [nextCursor, setNextCursor] = useState<ScopedCatalogCursor | null>(null);
  const pageCursor = scopedCatalogCursor(cursor, ordinaryScope);
  const availableNextCursor = scopedCatalogCursor(nextCursor, ordinaryScope);
  const [moreBusy, setMoreBusy] = useState(false);
  // Scope A -> B -> A must NEVER resurrect A's old page-2 token. Clear saved
  // pagination in addition to checking the current token's scope.
  useEffect(() => {
    setCursor(null);
    setNextCursor(null);
    setPlayers([]);
    setMoreBusy(false);
  }, [ordinaryScope]);
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
  useEffect(() => {
    const readView = () => {
      setBrowseView(parseBrowseView(window.location.search));
      setViewReady(true);
    };
    readView();
    window.addEventListener("popstate", readView);
    return () => window.removeEventListener("popstate", readView);
  }, []);
  useEffect(() => { let live = true; void listCities().then(r => { if (live && r.ok) setCities(r.data.items); }); return () => { live = false; }; }, []);
  useEffect(() => {
    let live = true;
    if (!pageCursor) { setPlayers([]); setNextCursor(null); setMoreBusy(false); setState("loading"); } else setMoreBusy(true);
    const timer = setTimeout(() => { void listPlayers({ cityId: cityId || undefined, areaKey: areaKey.trim() || undefined, name: name.trim().length >= 2 ? name.trim() : undefined, looking: lookingOnly || undefined, trainer: trainerOnly || undefined, cursor: pageCursor ?? undefined, limit: 50 }).then(result => {
      if (!live) return;
      setMoreBusy(false);
      if (!result.ok) { setState(isSocialDirectoryDisabled(result) ? "unavailable" : "error"); return; }
      setPlayers(previous => pageCursor ? [...previous, ...result.data.items.filter(p => !previous.some(old => old.publicPlayerId === p.publicPlayerId))] : result.data.items);
      setNextCursor(result.data.nextCursor ? { scope: ordinaryScope, value: result.data.nextCursor } : null); setState(result.data.items.length || pageCursor ? "ready" : "empty");
    }); }, 200);
    return () => { live = false; clearTimeout(timer); };
  }, [ordinaryScope, pageCursor, reload]);
  function reset() { setName(""); setAreaKey(""); setCityId(""); setLookingOnly(false); setTrainerOnly(false); setCursor(null); }
  function changeBrowseView(next: PlayerBrowseView) {
    if (next === browseView) return;
    const url = new URL(window.location.href);
    url.search = writeBrowseViewSearch(url.search, next);
    window.history.pushState(window.history.state, "", url);
    setBrowseView(next);
  }
  // Renderable authorized window (45s TTL), not refresh-due matches (30s): soft refresh must keep rows.
  const liveRadar = Boolean(activationId && eligibleCity && directory.controller?.renderable(queryFilters, activationKey));
  const catalog = mergeRadarCatalog(players, directory.view, liveRadar);
  const cityName = cities.find(c => c.id === cityId)?.nameRu;
  const placeLabel = [cityName || (cityId ? "Город" : "Все города"), areaKey.trim() || "Все районы"].join(" · ");
  const showCards = viewReady && browseView === "cards";
  return <ConsumerShell active="players" title="Игроки" hideHeading><div className="fr3 players-page gb-player-browse" data-surface="players-directory" data-state={state} data-browse-view={showCards ? "cards" : "list"}>
    <section className="players-hero">
      <div>
        <h1>Игроки</h1>
        <p>Находите партнёров по уровню и игровому настрою.</p>
      </div>
      <div className="pb-view-switch" role="group" aria-label="Вид каталога">
        <button type="button" aria-pressed={showCards} onClick={() => changeBrowseView("cards")}>
          <span aria-hidden="true">▣</span>
          <span className="pb-view-switch__label">По одному</span>
        </button>
        <button type="button" aria-pressed={!showCards} onClick={() => changeBrowseView("list")}>
          <span aria-hidden="true">☰</span>
          <span className="pb-view-switch__label">Списком</span>
        </button>
      </div>
    </section>
    <section className="players-radar-band" aria-label="Игроки рядом">
      <div><h2>Игроки рядом с вами</h2><p>Временный поиск по приблизительной близости</p></div>
      <div className="players-radar-band__controls">
        <RadarSwitchControl />
        <RadarStatusControls />
        {activationId && <Button href="/players/radar" variant="dark">Показать на карте</Button>}
        {directory.view.authenticationRequired && <AuthEntry returnPath="/players">Войти для Radar</AuthEntry>}
      </div>
    </section>
    {directory.view.notice && <section className="radar-notice"><span role="status"><strong>{directory.view.notice}</strong></span></section>}
    <section className="player-controls" role="search" aria-label="Фильтры каталога">
      <label className="player-location"><span>Город</span><select aria-label="Город" value={cityId} onChange={e => { setCityId(e.target.value); setCursor(null); }}><option value="">Все города</option>{cities.map(c => <option value={c.id} key={c.id}>{c.nameRu}</option>)}</select></label>
      <label className="player-search"><img className="profile-icon" src="/canonical/search.svg" alt="" /><input aria-label="Найти игрока" type="search" placeholder="Найти игрока" value={name} onChange={e => { setName(e.target.value); setCursor(null); }} /></label>
      <label className="player-search area-filter"><input aria-label="Район / метро" placeholder="Район / метро" value={areaKey} maxLength={64} onChange={e => { setAreaKey(e.target.value); setCursor(null); }} /></label>
    </section>
    <div className="players-filter-chips" role="group" aria-label="Быстрые фильтры">
      <button className={`chip ${!lookingOnly && !trainerOnly ? "chip--active" : ""}`} aria-pressed={!lookingOnly && !trainerOnly} onClick={() => { setLookingOnly(false); setTrainerOnly(false); setCursor(null); }}>Все</button>
      <button className={`chip ${lookingOnly ? "chip--active" : ""}`} aria-pressed={lookingOnly} onClick={() => { setLookingOnly(!lookingOnly); setCursor(null); }}>Ищу игру</button>
      <button className={`chip ${trainerOnly ? "chip--active" : ""}`} aria-pressed={trainerOnly} onClick={() => { setTrainerOnly(!trainerOnly); setCursor(null); }}>Тренер</button>
    </div>
    {showCards ? (
      <section className="players-browse-deck" aria-label="Игроки по одному">
        {catalog.radar.length > 0 && (
          <div className="players-catalog-grid" aria-label="Участники Radar" style={{ marginBottom: 20 }}>
            {catalog.radar.map(row => <UnifiedPlayerCard key={row.publicPlayerId} row={row} city={cities.find(c => c.id === row.player.cityId)?.nameRu} onSelect={() => void directory.controller?.select(row)} />)}
            {catalog.moreRadar && <Button variant="outline" disabled={directory.view.busy} onClick={() => void directory.controller?.more()}>Ещё участники Radar</Button>}
          </div>
        )}
        <PlayerBrowseDeck
          players={catalog.ordinary}
          cities={cities}
          ordinaryScope={ordinaryScope}
          catalogState={state}
          moreBusy={moreBusy}
          hasMore={Boolean(availableNextCursor)}
          onLoadMore={() => { if (availableNextCursor) setCursor({ scope: ordinaryScope, value: availableNextCursor }); }}
          placeLabel={placeLabel}
        />
      </section>
    ) : (
      <section className="players-list"><div className="players-list__heading"><span><small>{filtered ? "Подходят по фильтрам" : "Игровое сообщество"}</small><h2>{cityName ? `Игроки · ${cityName}` : "Все игроки"}</h2></span><button onClick={reset}>Сбросить фильтры</button></div>
        <div className="players-catalog-grid" aria-label="Каталог игроков">
          {catalog.radar.map(row => <UnifiedPlayerCard key={row.publicPlayerId} row={row} city={cities.find(c => c.id === row.player.cityId)?.nameRu} onSelect={() => void directory.controller?.select(row)} />)}
          {catalog.moreRadar && <Button variant="outline" disabled={directory.view.busy} onClick={() => void directory.controller?.more()}>Ещё участники Radar</Button>}
          {catalog.ordinary.map(player => <PlayerCard key={player.publicPlayerId} player={player} city={cities.find(c => c.id === player.cityId)?.nameRu} />)}
        </div>
        {state === "loading" && <ProfileState title="Ищем игроков…" state="loading" />}
        {state === "unavailable" && <ProfileState title="Каталог игроков сейчас недоступен" state="unavailable">Попробуйте вернуться позже.</ProfileState>}
        {state === "error" && <ProfileState title="Не удалось загрузить каталог" state="error" retry={() => setReload(n => n + 1)}>Проверьте соединение и попробуйте снова.</ProfileState>}
        {state === "empty" && !catalog.radar.length && <ProfileState title={filtered ? "Никого не нашли" : "Игроков пока нет"} state="empty">{filtered ? "Попробуйте изменить или сбросить фильтры." : "Вернитесь немного позже."}</ProfileState>}
        {availableNextCursor && <Button variant="outline" disabled={moreBusy} onClick={() => setCursor({ scope: ordinaryScope, value: availableNextCursor })}>{moreBusy ? "Загрузка…" : "Показать ещё"}</Button>}
      </section>
    )}
    {liveRadar && directory.view.selected && <UnifiedPlayerPreview dialog onClose={() => directory.controller?.close()} />}
  </div></ConsumerShell>;
}
