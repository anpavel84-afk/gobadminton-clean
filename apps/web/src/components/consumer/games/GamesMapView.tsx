"use client";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ComponentProps } from "react";
import { getMe, listAllCityVenues, listAllUpcomingCityGames } from "../../../lib/api-client";
import type { ActivityKind, Game, VenueSummary, Me } from "../../../lib/consumer-types";
import { venueSchedules, startVenueMapRefresh, stableVenueCounts, mapCommunityReturnPath, mapCommunitySelection } from "../../../lib/games-venue-map";
import { mapBundleForCity } from "../../../lib/radar-map-assets";
import { VenueScheduleCard } from "./VenueScheduleCard";
import "../../../styles/venue-schedule-card.css";
import "../../../styles/discovery.css";
import { GamesMapBackButton } from "./GamesMapBackButton";
import { VenuePreviewCard } from "./VenuePreviewCard";
import { VenuePopup } from "./VenuePopup";
import { useDesktopMapInspector } from "./DesktopMapInspector";
import { SelectedVenueCover, useSelectedVenueCover } from "../venues/SelectedVenueCover";
import { VenueSheet } from "./VenueSheet";
import { Button } from "../Button";
import { SurfacePanel } from "../Surfaces";
import { GamesMapModuleLoading } from "./GamesMapModuleLoading";
import { MapLayerFiltersControls, MapLayerFiltersProvider } from "./MapLayerFilters";
import type { GamesVenueMap } from "./GamesVenueMap";
import type { VenueCommunitySection } from "../venues/VenueCommunityContent";
import { useVenueCommunitySummaries } from "../../../lib/use-venue-community";

/** A failed chunk stays unavailable; recovery uses the existing venue list. */
function GamesMapModuleError({ onAvailability, onReturnToList }: ComponentProps<typeof GamesVenueMap>) {
  // Reveal the existing list without hiding the parent's return button.
  useEffect(() => { onAvailability?.(false); }, [onAvailability]);
  return <div className="gb-games-map-area gb-games-map-module-error-area">
    <SurfacePanel className="gb-games-map-module-error" role="alert">
      <h2>Карта не загрузилась</h2>
      <p>Не удалось загрузить модуль карты. Площадки доступны списком.</p>
      {onReturnToList ? <Button variant="outline" onClick={onReturnToList}>← К списку</Button> : <Button variant="outline" href="/games">← К списку</Button>}
    </SurfacePanel>
  </div>;
}

const MapView = dynamic(() => import("./GamesVenueMap").then(module => module.GamesVenueMap).catch(() => GamesMapModuleError), {
  ssr: false,
  loading: GamesMapModuleLoading,
});

/** Warm the existing GamesVenueMap chunk only — no MapLibre/WebGL/worker instantiation. */
export function warmGamesVenueMapModule(): Promise<void> {
  return import("./GamesVenueMap").then(() => undefined);
}

/** Public venues never depend on Radar consent, a location fix or a people query. */
export function GamesMapView({ cityId, day, venueId, activity = "all", onReturnToList }: { cityId: string; day: string; venueId?: string; activity?: "all" | ActivityKind; onReturnToList?: () => void }) {
  const [snapshot, setSnapshot] = useState<{ cityId: string; venues: VenueSummary[]; games: Game[]; gamesReady: boolean; venuesFulfilled: boolean } | null>(null);
  const [mapAvailable, setMapAvailable] = useState(true);
  const [mapErrorCardShown, setMapErrorCardShown] = useState(false);
  useEffect(() => { setMapAvailable(true); setMapErrorCardShown(false); }, [cityId]);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const clock = setInterval(() => setNow(previous => Math.floor(previous / 60000) === Math.floor(Date.now() / 60000) ? previous : Date.now()), 30000);
    const visible = () => { if (document.visibilityState === "visible") setNow(Date.now()); };
    document.addEventListener("visibilitychange", visible);
    return () => { clearInterval(clock); document.removeEventListener("visibilitychange", visible); };
  }, []);
  useEffect(() => {
    const polling = startVenueMapRefresh(async signal => {
      setLoading(true); setError(false);
      // Same-city refresh keeps the verified snapshot until a current response settles.
      setSnapshot(previous => previous?.cityId === cityId ? previous : null);
      await Promise.all([listAllCityVenues(cityId, signal), listAllUpcomingCityGames(cityId, signal)]).then(([venues, games]) => {
        if (signal.aborted) return;
        setError(!venues.ok || !games.ok);
        setSnapshot(previous => {
          const retained = previous?.cityId === cityId ? previous : null;
          return {
            cityId,
            venues: venues.ok ? venues.data : retained?.venues ?? [],
            games: games.ok ? games.data : [],
            gamesReady: games.ok && venues.ok,
            // Genuine empty only for the latest fulfilled current-city venues response.
            venuesFulfilled: venues.ok,
          };
        });
        setNow(Date.now()); setLoading(false);
      }).catch(() => { if (!signal.aborted) { setError(true); setSnapshot(previous => previous?.cityId === cityId ? { ...previous, gamesReady: false, venuesFulfilled: false } : null); setLoading(false); } });
    });
    const reload = () => polling.refresh();
    // Tab return: catalog refresh; twin window focus is coalesced inside startVenueMapRefresh.
    const onVisibility = () => { if (document.visibilityState === "visible") polling.refresh(); };
    // A session change invalidates permissions immediately, even during a load — never coalesce away.
    // Drop permission-bearing games immediately; keep public venue geometry until the replacement settles.
    const sessionChanged = () => { polling.stop(); setSnapshot(previous => previous ? { ...previous, games: [], gamesReady: false, venuesFulfilled: false } : null); setRefresh(n => n + 1); };
    window.addEventListener("focus", reload); window.addEventListener("online", reload);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("gb-session-changed", sessionChanged);
    return () => {
      polling.stop();
      window.removeEventListener("focus", reload); window.removeEventListener("online", reload);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("gb-session-changed", sessionChanged);
    };
  }, [cityId, day, refresh]);
  const venues = snapshot?.cityId === cityId ? snapshot.venues : [];
  const games = useMemo(() => (snapshot?.cityId === cityId ? snapshot.games : []).filter(game => activity === "all" || game.activityKind === activity), [snapshot, cityId, activity]);
  const all = useMemo(() => venueSchedules(venues, games, "", now), [venues, games, now]);
  const schedules = useMemo(() => venueSchedules(venues, games, day, now), [venues, games, day, now]);
  // Schedule-only embed on VenuePage does not mount map cards — skip public batch.
  const venueCommunityIds = useMemo(
    () => (venueId ? [] : venues.map((item) => item.id)),
    [venues, venueId],
  );
  const community = useVenueCommunitySummaries(venueCommunityIds);
  const previousCounts = useRef<Map<string, number> | null>(null);
  const counts = useMemo(() => {
    const next = snapshot?.cityId === cityId && snapshot.gamesReady ? new Map([...schedules].map(([id, games]) => [id, games.length])) : null;
    return previousCounts.current = stableVenueCounts(previousCounts.current, next);
  }, [schedules, snapshot, cityId]);
  const desktop = useDesktopMapInspector();
  const [selectedVenueId, setSelectedVenueId] = useState<string | null>(null);
  const [communitySection, setCommunitySection] = useState<VenueCommunitySection | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [authEpoch, setAuthEpoch] = useState(0);
  const unresolved = useRef(false);
  const onUnresolvedChange = useCallback((value: boolean) => { unresolved.current = value; }, []);
  const [holdNotice, setHoldNotice] = useState("");
  const canLeaveSelection = () => {
    if (unresolved.current || document.querySelector("dialog[open]")) {
      setHoldNotice("Завершите текущую операцию или проверьте её результат перед закрытием площадки.");
      return false;
    }
    setHoldNotice(""); return true;
  };
  useEffect(() => {
    if (venueId || !selectedVenueId) { setMe(null); return; }
    let live = true;
    void getMe().then(result => { if (live) setMe(result.ok ? result.data : null); });
    const fence = () => { live = false; setMe(null); setAuthEpoch(value => value + 1); };
    window.addEventListener("gb-session-changed", fence);
    window.addEventListener("gb-private-expired", fence);
    return () => { live = false; window.removeEventListener("gb-session-changed", fence); window.removeEventListener("gb-private-expired", fence); };
  }, [venueId, selectedVenueId, authEpoch]);
  const restored = useRef(false);
  useEffect(() => {
    if (venueId || restored.current || !snapshot?.venuesFulfilled || snapshot.cityId !== cityId) return;
    restored.current = true;
    const intent = mapCommunitySelection(window.location.search, window.location.hash, cityId);
    if (!intent || !snapshot.venues.some(value => value.id === intent.venueId && value.cityId === cityId)) return;
    setSelectedVenueId(intent.venueId); setCommunitySection(intent.section); setExpanded(true);
  }, [snapshot, cityId, venueId]);

  const [expanded, setExpanded] = useState(false);
  const [galleryIndex, setGalleryIndex] = useState(0);
  const clearVenueSelection = () => { if (!canLeaveSelection()) return; setCommunitySection(null); unresolved.current = false; setSelectedVenueId(null); setExpanded(false); setGalleryIndex(0);
    if (window.location.href && window.history?.replaceState) {
      const url = new URL(window.location.href);
      url.searchParams.delete("selectedVenue"); url.searchParams.delete("communityCity");
      if (["#ratings", "#discussion", "#reviews"].includes(url.hash)) url.hash = "";
      window.history.replaceState(window.history.state, "", url);
    }
  };
  // Sync handoff via same-turn CustomEvent: player sheet closes before venue state commits.
  // Desktop opens the right inspector immediately; mobile keeps the compact preview first.
  const selectVenue = (venue: VenueSummary) => {
    if (venue.id !== selectedVenueId && !canLeaveSelection()) return;
    if (venue.id !== selectedVenueId) { setCommunitySection(null); unresolved.current = false; }
    if (venue.id === selectedVenueId) return;
    window.dispatchEvent(new Event("gb-map-select-venue"));
    setExpanded(desktop);
    setGalleryIndex(0);
    setSelectedVenueId(venue.id);
  };
  const retainedSelection = useRef<VenueSummary | undefined>(undefined);
  const catalogSelection = venues.find(item => item.id === selectedVenueId);
  if (catalogSelection) retainedSelection.current = catalogSelection;
  const selectedVenue = catalogSelection ?? (unresolved.current && retainedSelection.current?.cityId === cityId && retainedSelection.current.id === selectedVenueId ? retainedSelection.current : undefined);
  const selectedCover = useSelectedVenueCover(cityId, selectedVenue);
  const onGalleryIndexChange = (index: number) => setGalleryIndex(index);
  const escapeSelection = useRef<VenueSummary | undefined>(undefined);
  useEffect(() => { escapeSelection.current = selectedVenue; }, [selectedVenue]);
  useEffect(() => { setSelectedVenueId(null); setExpanded(false); }, [cityId]);
  // Promote parent expanded on desktop while a venue is selected; do not force-collapse
  // on resize to mobile (keeps VenueSheet/create across the presentation change).
  useEffect(() => {
    if (selectedVenueId && desktop) setExpanded(true);
  }, [selectedVenueId, desktop]);
  useEffect(() => {
    if (selectedVenueId !== null && !selectedVenue) setSelectedVenueId(null);
  }, [selectedVenueId, selectedVenue]);
  useEffect(() => {
    const onPlayer = () => clearVenueSelection();
    window.addEventListener("gb-map-select-player", onPlayer);
    return () => window.removeEventListener("gb-map-select-player", onPlayer);
  }, []);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (!escapeSelection.current || event.key !== "Escape" || event.defaultPrevented || document.querySelector("dialog[open], [role=dialog]")) return;
      if (event.defaultPrevented) return;
      if (unresolved.current) { event.preventDefault(); setHoldNotice("Проверьте результат текущей операции перед закрытием площадки."); return; }
      escapeSelection.current = undefined;
      event.preventDefault(); clearVenueSelection();
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, []);
  const venue = venues.find(venue => venue.id === venueId);
  if (venueId) return <section aria-label="Расписание площадки">
    {loading && <p className="gb-map-sr-only" role="status">Загружаем расписание…</p>}
    {error && <p role="alert">Не удалось загрузить расписание. Проверьте соединение.</p>}
    <Button variant="outline" onClick={() => setRefresh(n => n + 1)} disabled={loading}>Обновить расписание</Button>
    {venue && <VenueScheduleCard scheduleOnly venue={venue} games={schedules.get(venue.id) ?? []}
      gamesReady={!!snapshot?.gamesReady} day={day} hasUpcoming={!!all.get(venue.id)?.length} />}
    {!loading && !error && !venue && <p className="gb-map-sr-only" role="status">Площадка отсутствует в каталоге города.</p>}
  </section>;
  const mapBundle = mapBundleForCity(cityId);
  return <MapLayerFiltersProvider>
    <section className="gb-games-map" data-venue-preview={!!selectedVenue} aria-label="Игры на карте">
      {(!mapErrorCardShown || !mapBundle) && onReturnToList && <GamesMapBackButton onClick={onReturnToList} />}
      {mapBundle && mapAvailable && <MapLayerFiltersControls />}
      {holdNotice && <p className="gb-venue-community-hold" role="alert">{holdNotice}</p>}
      {loading && <p className="gb-map-sr-only" role="status">Загружаем все площадки и расписание…</p>}
      {error && <p role="alert">Не удалось загрузить полный каталог или расписание. Проверьте соединение и повторите. Непроверенные количества не показываем.</p>}
      {<>
        {mapBundle ? <MapView key={cityId} cityId={cityId} venues={venues} counts={counts} selectedVenueId={selectedVenueId} onSelect={selectVenue} onDeselect={clearVenueSelection} onAvailability={setMapAvailable} onErrorCardChange={setMapErrorCardShown} onReturnToList={onReturnToList} /> : <p role="alert">Карта выбранного города пока недоступна. Все площадки доступны списком.</p>}
        {selectedVenue && <VenuePopup retainContent key={selectedVenue.id} expanded={expanded || desktop} onExpandedChange={value => { if (!value && document.querySelector("dialog[open]")) return; setExpanded(value); }} onDeselect={clearVenueSelection}
          preview={<VenuePreviewCard onCommunityOpen={section => { setCommunitySection(section); setExpanded(true); }} embedded coverSlot={<SelectedVenueCover slotRef={selectedCover.compact} className="gb-venue-preview-cover" />} coverFallback={selectedCover.fallback} coverReady={selectedCover.ready} onCoverRetry={selectedCover.retry} venue={selectedVenue} games={all.get(selectedVenue.id) ?? []}
            gamesReady={snapshot?.cityId === cityId && snapshot.gamesReady} now={now} onOpen={() => setExpanded(true)}
            galleryIndex={galleryIndex} onGalleryIndexChange={onGalleryIndexChange}
            communitySummary={community.summaries[selectedVenue.id] ?? null}
            communitySummaryState={community.state === "idle" ? "loading" : community.state}
            showCommunityRating={!expanded && !desktop} />}>
          <VenueSheet embedded coverSlot={<SelectedVenueCover slotRef={selectedCover.info} className="gb-venue-sheet-cover" />} coverFallback={selectedCover.fallback} coverReady={selectedCover.ready} onCoverRetry={selectedCover.retry} active={expanded || desktop} venue={selectedVenue} games={all.get(selectedVenue.id) ?? []}
            gamesReady={snapshot?.cityId === cityId && snapshot.gamesReady === true} now={now}
            galleryIndex={galleryIndex} onGalleryIndexChange={onGalleryIndexChange}
            communitySection={communitySection} onCommunitySectionChange={setCommunitySection} me={me} onUnresolvedChange={onUnresolvedChange}
            authReturnPath={typeof window === "undefined" ? "/games?view=map" : mapCommunityReturnPath(window.location.pathname, window.location.search, selectedVenue.id, cityId, day, activity)}
            onCollapse={desktop ? clearVenueSelection : () => setExpanded(false)} onDeselect={clearVenueSelection}
            communitySummary={community.summaries[selectedVenue.id] ?? null}
            communitySummaryState={community.state === "idle" ? "loading" : community.state}
            showCommunityRating={expanded || desktop} />
        </VenuePopup>}
        {!loading && snapshot?.cityId === cityId && snapshot.venuesFulfilled && !venues.length && <p className="gb-map-sr-only" role="status">В каталоге города пока нет площадок.</p>}
        {(!mapAvailable || !mapBundle) && <details className="gb-games-map-fallback">
          <summary>Площадки списком — карта или координаты недоступны</summary>
          <div role="group" aria-label="Все площадки города">{venues.map(venue => <button className="gb-discovery-chip" type="button" key={venue.id} onClick={() => selectVenue(venue)}>{venue.name} · {counts ? counts.get(venue.id) ?? 0 : "?"}</button>)}</div>
        </details>}
      </>}
    </section>
  </MapLayerFiltersProvider>;
}
