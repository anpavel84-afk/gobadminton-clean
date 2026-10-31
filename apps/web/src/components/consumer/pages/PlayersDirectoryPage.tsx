"use client";

import "../../../styles/radar-geographic.css";
import "../../../styles/player-browse.css";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { listCities, listPlayers } from "../../../lib/api-client";
import type { City, PublicPlayer } from "../../../lib/consumer-types";
import { readSelectedLocation } from "../../../lib/location-context";
import { isSocialDirectoryDisabled } from "../../../lib/player-presentation";
import { parseBrowseView, PLAYER_BROWSE_DESKTOP_MQ, writeBrowseViewSearch, type PlayerBrowseView } from "../../../lib/player-browse";
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
import { PlayerBrowseOfferOpHost, PlayerBrowseOfferStatus } from "../players/PlayerBrowseOffers";
import { usePlayerBrowseOffers } from "../players/usePlayerBrowseOffers";
import { PlayersDirectoryToolbar } from "../players/PlayersDirectoryToolbar";
import { GamesViewAction } from "../games/GamesViewAction";

/**
 * Unified Radar notices (distance, transient, stale, auth) live in the header affordance.
 * Ordinary catalog errors keep ProfileState — do not mirror Radar notices in either layout.
 */
function directoryInFlowNotice(_notice: string): string | null {
  return null;
}

/** Desktop MQ + readiness; gate mobile fullscreen until MQ is known (no desktop flash). */
function usePlayersDirectoryDesktop(): { desktop: boolean; mqReady: boolean } {
  const [desktop, setDesktop] = useState(false);
  const [mqReady, setMqReady] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      setMqReady(true);
      return;
    }
    const media = window.matchMedia(PLAYER_BROWSE_DESKTOP_MQ);
    const sync = () => setDesktop(media.matches);
    sync();
    setMqReady(true);
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", sync);
      return () => media.removeEventListener("change", sync);
    }
    if (typeof media.addListener === "function") {
      media.addListener(sync);
      return () => media.removeListener(sync);
    }
  }, []);
  return { desktop, mqReady };
}

export function PlayersDirectoryPage({
  initialBrowseView = "list",
}: {
  /** Server-parsed from searchParams so first paint matches URL (stable header geometry). */
  initialBrowseView?: PlayerBrowseView;
} = {}) {
  const [players, setPlayers] = useState<PublicPlayer[]>([]);
  const [cities, setCities] = useState<City[]>([]);
  const [state, setState] = useState("loading");
  // Server passes URL view; client keeps it through hydration (no list→cards header flash).
  const [browseView, setBrowseView] = useState<PlayerBrowseView>(initialBrowseView);
  const [viewReady, setViewReady] = useState(true);
  const [portalReady, setPortalReady] = useState(false);
  const { desktop, mqReady } = usePlayersDirectoryDesktop();
  const cardsHistoryPushed = useRef(false);
  const listScrollY = useRef(0);
  const cardsTrigger = useRef<HTMLElement | null>(null);
  /** Set true on cards→list close so layout can focus the remounted finder CTA. */
  const pendingFinderFocus = useRef(false);
  const mobileFsDialogRef = useRef<HTMLDialogElement | null>(null);
  const closingFsRef = useRef(false);
  const mobileCtaZoneRef = useRef<HTMLDivElement | null>(null);
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
  useEffect(() => { setPortalReady(true); }, []);
  useEffect(() => {
    const restoreListChromeOnPop = () => {
      const trigger = cardsTrigger.current;
      cardsTrigger.current = null;
      cardsHistoryPushed.current = false;
      pendingFinderFocus.current = true;
      requestAnimationFrame(() => {
        window.scrollTo(0, listScrollY.current);
        if (trigger?.isConnected) {
          pendingFinderFocus.current = false;
          trigger.focus({ preventScroll: true });
        }
      });
    };
    const readView = () => {
      const next = parseBrowseView(window.location.search);
      setBrowseView(prev => {
        if (prev === "cards" && next === "list") restoreListChromeOnPop();
        return next;
      });
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
  function restoreListChrome() {
    const trigger = cardsTrigger.current;
    cardsTrigger.current = null;
    cardsHistoryPushed.current = false;
    // Focus after list/CTA remount (X / Escape / replaceState close). Do not steal focus from late receipts.
    pendingFinderFocus.current = true;
    requestAnimationFrame(() => {
      window.scrollTo(0, listScrollY.current);
      if (trigger?.isConnected) {
        pendingFinderFocus.current = false;
        trigger.focus({ preventScroll: true });
      }
    });
  }
  function closeMobileCards() {
    if (browseView !== "cards") return;
    if (closingFsRef.current) return;
    closingFsRef.current = true;
    // Close native dialog without relying on unmount cancel → history push.
    const dialog = mobileFsDialogRef.current;
    if (dialog?.open) {
      try { dialog.close(); } catch { /* ignore */ }
    }
    if (cardsHistoryPushed.current) {
      // Browser Back / popstate clears view — do not push another list entry (no growth loop).
      cardsHistoryPushed.current = false;
      window.history.back();
      closingFsRef.current = false;
      return;
    }
    const url = new URL(window.location.href);
    url.search = writeBrowseViewSearch(url.search, "list");
    window.history.replaceState(window.history.state, "", url);
    setBrowseView("list");
    restoreListChrome();
    closingFsRef.current = false;
  }
  function changeBrowseView(next: PlayerBrowseView) {
    if (next === browseView) return;
    if (next === "cards") {
      listScrollY.current = window.scrollY;
      cardsTrigger.current = document.activeElement as HTMLElement | null;
      const url = new URL(window.location.href);
      url.search = writeBrowseViewSearch(url.search, "cards");
      window.history.pushState(window.history.state, "", url);
      cardsHistoryPushed.current = true;
      setBrowseView("cards");
      return;
    }
    if (!desktop) {
      closeMobileCards();
      return;
    }
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
  // Wait for MQ before mobile portal — avoids fullscreen flash when desktop ≥1024 hydrates.
  const mobileCards = showCards && mqReady && !desktop;
  // After cards→list remount, focus current finder CTA when the captured trigger was detached (X/Escape/Back).
  useLayoutEffect(() => {
    if (showCards || !pendingFinderFocus.current) return;
    pendingFinderFocus.current = false;
    window.scrollTo(0, listScrollY.current);
    const cta = mobileCtaZoneRef.current?.querySelector<HTMLElement>(".pb-finder-cta") ?? null;
    if (cta && typeof cta.focus === "function") {
      cta.focus({ preventScroll: true });
    }
  }, [showCards]);
  const loadMore = () => { if (availableNextCursor) setCursor({ scope: ordinaryScope, value: availableNextCursor }); };
  // Batch eligibility for authenticated cards on both mobile and desktop; list stays complete.
  const offers = usePlayerBrowseOffers({
    finderActive: showCards,
    ordinaryScope,
    catalogPlayers: catalog.ordinary,
    catalogState: state,
    hasMore: Boolean(availableNextCursor),
    moreBusy,
    onLoadMore: loadMore,
  });
  const authCardsReady = showCards && offers.authState === "ready";
  // Guest desktop keeps public preview; loading/error cards avoid flashing already-sent peers.
  const deckPlayers = authCardsReady
    ? offers.eligibility.players
    : showCards && offers.authState !== "guest"
      ? []
      : catalog.ordinary;
  // Readonly eligibility gate for desktop auth cards — do not pass mobile operation host.
  const desktopFinderEligibility = showCards && desktop && offers.authState !== "guest"
    ? offers.eligibility
    : null;
  // Shared mobile overlay zone (finder + optional Radar map) — GamesViewAction nav measure pattern.
  useLayoutEffect(() => {
    if (desktop || showCards) return;
    const element = mobileCtaZoneRef.current;
    const nav = element?.closest(".gb-app-shell")?.querySelector(".gb-bottom-nav");
    if (!element || !nav) return;
    const viewport = window.visualViewport;
    const measure = () => {
      const navDisplayed = window.getComputedStyle(nav).display !== "none";
      if (!navDisplayed) {
        element.style.bottom = "";
        return;
      }
      const bottom = Math.min(
        nav.getBoundingClientRect().top,
        (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight),
      );
      element.style.bottom = `${Math.max(0, window.innerHeight - bottom)}px`;
    };
    const observer = new ResizeObserver(measure);
    observer.observe(nav);
    observer.observe(element);
    measure();
    window.addEventListener("resize", measure);
    viewport?.addEventListener("resize", measure);
    viewport?.addEventListener("scroll", measure);
    return () => {
      observer.disconnect();
      element.style.bottom = "";
      window.removeEventListener("resize", measure);
      viewport?.removeEventListener("resize", measure);
      viewport?.removeEventListener("scroll", measure);
    };
  }, [desktop, showCards, activationId]);
  // Mobile cards: native <dialog>.showModal for focus containment; body scroll lock; desktop resize tears down.
  useEffect(() => {
    if (!mobileCards || !portalReady) return;
    const previousOverflow = document.body.style.overflow;
    const previousScrollY = window.scrollY;
    document.body.style.overflow = "hidden";
    const dialog = mobileFsDialogRef.current;
    if (dialog && typeof dialog.showModal === "function" && !dialog.open) {
      try { dialog.showModal(); } catch { /* already open / unsupported */ }
    }
    return () => {
      document.body.style.overflow = previousOverflow;
      // Tear down without invoking closeMobileCards (avoids history push during unmount / desktop resize).
      closingFsRef.current = true;
      if (dialog?.open) {
        try { dialog.close(); } catch { /* ignore */ }
      }
      closingFsRef.current = false;
      if (parseBrowseView(window.location.search) === "list") {
        window.scrollTo(0, listScrollY.current || previousScrollY);
      }
    };
  }, [mobileCards, portalReady]);
  const inFlowNotice = directoryInFlowNotice(directory.view.notice);
  const radarBand = (
    <section className="players-radar-band" aria-label="Игроки рядом">
      <div><h2>Игроки рядом с вами</h2><p>Временный поиск по приблизительной близости</p></div>
      <div className="players-radar-band__controls">
        <RadarSwitchControl />
        <RadarStatusControls />
        {directory.view.authenticationRequired && <AuthEntry returnPath="/players">Войти для Radar</AuthEntry>}
      </div>
    </section>
  );
  // Desktop floating map CTA — unchanged GamesViewAction. Mobile map shares finder overlay zone.
  const playersMapCta = activationId ? (
    <GamesViewAction
      view="list"
      href="/players/radar"
      labelFull="Игроки на карте"
      labelShort="На карте"
      className="gb-players-map-cta"
      aria-label="Игроки на карте"
    />
  ) : null;
  const mobileFinderZone = !desktop && !showCards ? (
    <div ref={mobileCtaZoneRef} className="pb-mobile-finder-zone" data-radar={activationId ? "on" : "off"}>
      <Button
        variant="dark"
        className="pb-finder-cta"
        aria-label="Найти напарника"
        onClick={() => changeBrowseView("cards")}
      >
        <span className="pb-finder-cta__label">Найти напарника</span>
      </Button>
      {activationId ? (
        <Button
          variant="outline"
          href="/players/radar"
          className="pb-finder-map-secondary"
          aria-label="Игроки на карте"
        >
          На карте
        </Button>
      ) : null}
    </div>
  ) : null;
  const catalogFilters = (
    <>
      {inFlowNotice && <section className="radar-notice"><span role="status"><strong>{inFlowNotice}</strong></span></section>}
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
    </>
  );
  const desktopToolbar = (
    <PlayersDirectoryToolbar
      cities={cities}
      cityId={cityId}
      name={name}
      areaKey={areaKey}
      lookingOnly={lookingOnly}
      trainerOnly={trainerOnly}
      onCityId={setCityId}
      onName={setName}
      onAreaKey={setAreaKey}
      onLookingOnly={setLookingOnly}
      onTrainerOnly={setTrainerOnly}
      onReset={reset}
      onFilterCommit={() => setCursor(null)}
      notice={inFlowNotice}
    />
  );
  const deck = (
    <PlayerBrowseDeck
      players={deckPlayers}
      cities={cities}
      ordinaryScope={ordinaryScope}
      catalogState={authCardsReady && offers.eligibility.kind === "checking" ? "loading" : state}
      moreBusy={moreBusy}
      hasMore={Boolean(availableNextCursor)}
      onLoadMore={loadMore}
      placeLabel={placeLabel}
      desktop={desktop}
      mobileFullscreen={mobileCards}
      onCloseFullscreen={closeMobileCards}
      mobileOffers={mobileCards ? offers : null}
      finderEligibility={desktopFinderEligibility}
      onContinueFinder={desktopFinderEligibility ? () => offers.continueSearch() : undefined}
      onRetryFinder={desktopFinderEligibility ? () => offers.retryEligibility() : undefined}
    />
  );
  return <ConsumerShell active="players" title="Игроки" hideHeading><div className="fr3 players-page gb-player-browse" data-surface="players-directory" data-state={state} data-browse-view={showCards ? "cards" : "list"} data-directory-desktop={desktop ? "true" : "false"} inert={mobileCards ? true : undefined}>
    <section className={`players-hero${showCards ? " pb-hero--compact" : ""}`}>
      <div>
        <h1>Игроки</h1>
        {/* Always in DOM; CSS media + data-browse-view keep geometry stable (no JS subtitle flash). */}
        <p className="players-hero__subtitle">Найдите партнёров для хорошей игры.</p>
      </div>
      {/* Desktop ≥1024 keeps segmented list/cards. Mobile uses floating «Найти напарника» only. */}
      <div
        className="pb-view-switch"
        role="group"
        aria-label="Вид каталога"
        hidden={mqReady && !desktop ? true : undefined}
        aria-hidden={mqReady && !desktop ? true : undefined}
      >
        <button type="button" aria-pressed={!showCards} tabIndex={mqReady && !desktop ? -1 : undefined} onClick={() => changeBrowseView("list")}>
          <span aria-hidden="true">☰</span>
          <span className="pb-view-switch__label">Списком</span>
        </button>
        <button type="button" aria-pressed={showCards} tabIndex={mqReady && !desktop ? -1 : undefined} onClick={() => changeBrowseView("cards")}>
          <span aria-hidden="true">▣</span>
          <span className="pb-view-switch__label">По одному</span>
        </button>
      </div>
    </section>
    {desktop ? desktopToolbar : showCards ? null : (
      <>
        {radarBand}
        {catalogFilters}
      </>
    )}
    {/* Desktop: existing map CTA. Mobile list: shared finder+map zone (never inside fullscreen). */}
    {desktop && playersMapCta}
    {mobileFinderZone}
    {/* Keyed OpHost outside conditional dialog — survives X / next-card / portal teardown. */}
    {offers.activeOperation && (
      <PlayerBrowseOfferOpHost
        key={offers.activeOperation.token}
        operation={offers.activeOperation}
        onConfirmed={offers.onOperationConfirmed}
        onFailed={offers.onOperationFailed}
        onUnknown={offers.onOperationUnknown}
      />
    )}
    {!mobileCards && (
      <PlayerBrowseOfferStatus
        status={offers.status}
        onCheckStatus={() => offers.checkStatusReadonly()}
        unresolved={offers.unresolved}
        onCheckUnresolved={(peerId) => offers.checkStatusReadonly(peerId)}
        className="pb-offer-status--list"
      />
    )}
    {showCards && desktop ? (
      <section className="players-browse-deck" aria-label="Игроки по одному">
        {liveRadar && catalog.radar.length > 0 && (
          <p className="pb-radar-elsewhere" role="note">
            Участники Radar — в{" "}
            <button type="button" className="pb-radar-elsewhere__link" onClick={() => changeBrowseView("list")}>списке</button>
            . Карточки ниже — обычный каталог.
          </p>
        )}
        {deck}
      </section>
    ) : mobileCards && portalReady ? createPortal(
      <dialog
        ref={mobileFsDialogRef}
        className="gb-player-browse pb-mobile-fs"
        aria-label="Найти напарника"
        data-surface="player-browse-mobile-fs"
        onCancel={(event) => {
          // Escape: same close path as X (replace/back). Nested auth <dialog> is a separate top layer.
          event.preventDefault();
          if (!closingFsRef.current) closeMobileCards();
        }}
      >
        {deck}
      </dialog>,
      document.body,
    ) : showCards ? null : (
      <section className="players-list pb-list--finder-pad">
        {!desktop && (
          <div className="players-list__heading"><span><small>{filtered ? "Подходят по фильтрам" : "Игровое сообщество"}</small><h2>{cityName ? `Игроки · ${cityName}` : "Все игроки"}</h2></span><button onClick={reset}>Сбросить фильтры</button></div>
        )}
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
