"use client";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { listAllCityVenues, listAllUpcomingCityGames } from "../../../lib/api-client";
import type { ActivityKind, Game, VenueSummary } from "../../../lib/consumer-types";
import { venueSchedules, startVenueMapRefresh } from "../../../lib/games-venue-map";
import { MOSCOW_BUNDLE } from "../../../lib/radar-map-assets";
import { VenueScheduleCard } from "./VenueScheduleCard";
import "../../../styles/venue-schedule-card.css";
import "../../../styles/discovery.css";
import { venueMapPath } from "../../../lib/games-venue-map";
import { Button } from "../Button";
const MapView = dynamic(() => import("./GamesVenueMap").then(module => module.GamesVenueMap), { ssr: false });

/** Public venues never depend on Radar consent, a location fix or a people query. */
export function GamesMapView({ cityId, day, venueId, activity = "all" }: { cityId: string; day: string; venueId?: string; activity?: "all" | ActivityKind }) {
  const [snapshot, setSnapshot] = useState<{ cityId: string; venues: VenueSummary[]; games: Game[]; gamesReady: boolean } | null>(null);
  const [mapAvailable, setMapAvailable] = useState(true);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(clock);
  }, []);
  useEffect(() => {
    const polling = startVenueMapRefresh(async signal => {
      setLoading(true); setError(false);
      // Keep public geography mounted; never display old schedule hints during revalidation.
      setSnapshot(previous => previous?.cityId === cityId ? { ...previous, games: [], gamesReady: false } : null);
      await Promise.all([listAllCityVenues(cityId, signal), listAllUpcomingCityGames(cityId, signal)]).then(([venues, games]) => {
        if (signal.aborted) return;
        setError(!venues.ok || !games.ok);
        setSnapshot(previous => {
          const retained = previous?.cityId === cityId ? previous : null;
          if (!venues.ok && !retained) return null;
          return { cityId, venues: venues.ok ? venues.data : retained!.venues,
            games: games.ok ? games.data : [], gamesReady: games.ok };
        });
        setNow(Date.now()); setLoading(false);
      }).catch(() => { if (!signal.aborted) { setError(true); setLoading(false); } });
    });
    const reload = () => polling.refresh();
    // A session change invalidates permissions immediately, even during a load.
    const sessionChanged = () => setRefresh(n => n + 1);
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
  const counts = useMemo(() => new Map([...schedules].map(([id, games]) => [id, games.length])), [schedules]);
  const venue = venues.find(venue => venue.id === venueId);
  const openVenue = (venue: VenueSummary) => window.location.assign(venueMapPath(venue.id, day, window.location.pathname + window.location.search));
  if (venueId) return <section aria-label="Расписание площадки">
    {loading && <p role="status">Загружаем расписание…</p>}
    {error && <p role="alert">Не удалось загрузить расписание. Проверьте соединение.</p>}
    <Button variant="outline" onClick={() => setRefresh(n => n + 1)} disabled={loading}>Обновить расписание</Button>
    {venue && <VenueScheduleCard scheduleOnly venue={venue} games={schedules.get(venue.id) ?? []}
      gamesReady={!!snapshot?.gamesReady} day={day} hasUpcoming={!!all.get(venue.id)?.length} />}
    {!loading && !error && !venue && <p role="status">Площадка отсутствует в каталоге города.</p>}
  </section>;
  return <section className="gb-games-map" aria-label="Игры на карте">
    <div className="gb-games-map-toolbar"><details className="gb-games-map-help"><summary aria-label="О карте и количествах">О карте</summary><p className="gb-discovery-helper">Все площадки города. Число на маркере — доступные публичные игры{day ? " в выбранную дату" : ""}. Места и права проверяются при открытии игры.</p></details>
    <Button variant="outline" onClick={() => setRefresh(n => n + 1)} disabled={loading} aria-label="Обновить карту и расписание">Обновить</Button></div>
    {loading && <p role="status">Загружаем все площадки и расписание…</p>}
    {error && <p role="alert">Не удалось загрузить полный каталог или расписание. Проверьте соединение и повторите. Непроверенные количества не показываем.</p>}
    {snapshot?.cityId === cityId && <>
      {cityId === MOSCOW_BUNDLE.cityId ? <MapView venues={venues} counts={snapshot.gamesReady ? counts : null} onSelect={openVenue} onAvailability={setMapAvailable} /> : <p role="status">Карта выбранного города пока недоступна. Все площадки доступны списком.</p>}
      {!venues.length && <p role="status">В каталоге города пока нет площадок.</p>}
      {(!mapAvailable || cityId !== MOSCOW_BUNDLE.cityId || venues.some(venue => typeof venue.latitude !== "number" || typeof venue.longitude !== "number" || !Number.isFinite(venue.latitude) || !Number.isFinite(venue.longitude) || venue.longitude < 36 || venue.longitude > 39.5 || venue.latitude < 54.5 || venue.latitude > 56.5)) && <details className="gb-games-map-fallback">
        <summary>Площадки списком — карта или координаты недоступны</summary>
        <div role="group" aria-label="Все площадки города">{venues.map(venue => <button className="gb-discovery-chip" type="button" key={venue.id} onClick={() => openVenue(venue)}>{venue.name} · {snapshot.gamesReady ? counts.get(venue.id) ?? 0 : "?"}</button>)}</div>
      </details>}
    </>}
  </section>;
}
