"use client";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ComponentProps } from "react";
import { listAllCityVenues, listAllUpcomingCityGames } from "../../../lib/api-client";
import type { ActivityKind, Game, VenueSummary } from "../../../lib/consumer-types";
import { venueSchedules, startVenueMapRefresh, stableVenueCounts } from "../../../lib/games-venue-map";
import { MOSCOW_BUNDLE } from "../../../lib/radar-map-assets";
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
  const [snapshot, setSnapshot] = useState<{ cityId: string; venues: VenueSummary[]; games: Game[]; gamesReady: boolean } | null>(null);
  const [mapAvailable, setMapAvailable] = useState(true);
  const [mapErrorCardShown, setMapErrorCardShown] = useState(false);
  useEffect(() => { setMapErrorCardShown(false); }, [cityId]);
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
          return { cityId, venues: venues.ok ? venues.data : retained?.venues ?? [],
            games: games.ok ? games.data : [], gamesReady: games.ok && venues.ok };
        });
        setNow(Date.now()); setLoading(false);
      }).catch(() => { if (!signal.aborted) { setError(true); setSnapshot(previous => previous?.cityId === cityId ? { ...previous, gamesReady: false } : null); setLoading(false); } });
    });
    const reload = () => polling.refresh();
    // A session change invalidates permissions immediately, even during a load.
    const sessionChanged = () => { polling.stop(); setSnapshot(previous => previous ? { ...previous, gamesReady: false } : null); setRefresh(n => n + 1); };
    window.addEventListener("focus", reload); window.addEventListener("online", reload);
    window.addEventListener("gb-session-changed", sessionChanged);
    return () => {
      polling.stop();
      window.removeEventListener("focus", reload); window.removeEventListener("online", reload);
      window.removeEventListener("gb-session-changed", sessionChanged);
    };
  }, [cityId, day, refresh]);
  const venues = snapshot?.cityId === cityId ? snapshot.venues : [];
  const games = useMemo(() => (snapshot?.cityId === cityId ? snapshot.games : []).filter(game => activity === "all" || game.activityKind === activity), [snapshot, cityId, activity]);
  const all = useMemo(() => venueSchedules(venues, games, "", now), [venues, games, now]);
  const schedules = useMemo(() => venueSchedules(venues, games, day, now), [venues, games, day, now]);
  const previousCounts = useRef<Map<string, number> | null>(null);
  const counts = useMemo(() => {
    const next = snapshot?.cityId === cityId && snapshot.gamesReady ? new Map([...schedules].map(([id, games]) => [id, games.length])) : null;
    return previousCounts.current = stableVenueCounts(previousCounts.current, next);
  }, [schedules, snapshot, cityId]);
  const desktop = useDesktopMapInspector();
  const [selectedVenueId, setSelectedVenueId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [galleryIndex, setGalleryIndex] = useState(0);
  const clearVenueSelection = () => { setSelectedVenueId(null); setExpanded(false); setGalleryIndex(0); };
  // Sync handoff via same-turn CustomEvent: player sheet closes before venue state commits.
  // Desktop opens the right inspector immediately; mobile keeps the compact preview first.
  const selectVenue = (venue: VenueSummary) => {
    window.dispatchEvent(new Event("gb-map-select-venue"));
    setExpanded(desktop);
    setGalleryIndex(0);
    setSelectedVenueId(venue.id);
  };
  const selectedVenue = venues.find(item => item.id === selectedVenueId);
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
      escapeSelection.current = undefined;
      event.preventDefault(); setSelectedVenueId(null);
    };
    window.addEventListener("keydown", escape, true);
    return () => window.removeEventListener("keydown", escape, true);
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
  return <MapLayerFiltersProvider>
    <section className="gb-games-map" data-venue-preview={!!selectedVenue} aria-label="Игры на карте">
      {(!mapErrorCardShown || cityId !== MOSCOW_BUNDLE.cityId) && onReturnToList && <GamesMapBackButton onClick={onReturnToList} />}
      {cityId === MOSCOW_BUNDLE.cityId && mapAvailable && <MapLayerFiltersControls />}
      {loading && <p className="gb-map-sr-only" role="status">Загружаем все площадки и расписание…</p>}
      {error && <p role="alert">Не удалось загрузить полный каталог или расписание. Проверьте соединение и повторите. Непроверенные количества не показываем.</p>}
      {<>
        {cityId === MOSCOW_BUNDLE.cityId ? <MapView venues={venues} counts={counts} selectedVenueId={selectedVenueId} onSelect={selectVenue} onDeselect={clearVenueSelection} onAvailability={setMapAvailable} onErrorCardChange={setMapErrorCardShown} onReturnToList={onReturnToList} /> : <p role="alert">Карта выбранного города пока недоступна. Все площадки доступны списком.</p>}
        {selectedVenue && <VenuePopup key={selectedVenue.id} expanded={expanded || desktop} onExpandedChange={setExpanded} onDeselect={clearVenueSelection}
          preview={<VenuePreviewCard embedded coverSlot={<SelectedVenueCover slotRef={selectedCover.compact} className="gb-venue-preview-cover" />} coverFallback={selectedCover.fallback} venue={selectedVenue} games={all.get(selectedVenue.id) ?? []}
            gamesReady={snapshot?.cityId === cityId && snapshot.gamesReady} now={now} onOpen={() => setExpanded(true)}
            galleryIndex={galleryIndex} onGalleryIndexChange={onGalleryIndexChange} />}>
          <VenueSheet embedded coverSlot={<SelectedVenueCover slotRef={selectedCover.info} className="gb-venue-sheet-cover" />} coverFallback={selectedCover.fallback} active={expanded || desktop} venue={selectedVenue} games={all.get(selectedVenue.id) ?? []}
            gamesReady={snapshot?.cityId === cityId && snapshot.gamesReady === true} now={now}
            galleryIndex={galleryIndex} onGalleryIndexChange={onGalleryIndexChange}
            onCollapse={desktop ? clearVenueSelection : () => setExpanded(false)} onDeselect={clearVenueSelection} />
        </VenuePopup>}
        {!venues.length && <p className="gb-map-sr-only" role="status">В каталоге города пока нет площадок.</p>}
        {(!mapAvailable || cityId !== MOSCOW_BUNDLE.cityId) && <details className="gb-games-map-fallback">
          <summary>Площадки списком — карта или координаты недоступны</summary>
          <div role="group" aria-label="Все площадки города">{venues.map(venue => <button className="gb-discovery-chip" type="button" key={venue.id} onClick={() => selectVenue(venue)}>{venue.name} · {counts ? counts.get(venue.id) ?? 0 : "?"}</button>)}</div>
        </details>}
      </>}
    </section>
  </MapLayerFiltersProvider>;
}
