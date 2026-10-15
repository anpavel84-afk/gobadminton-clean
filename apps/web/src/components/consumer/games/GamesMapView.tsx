"use client";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { listAllCityVenues, listAllUpcomingCityGames } from "../../../lib/api-client";
import type { Game, VenueSummary } from "../../../lib/consumer-types";
import { venueSchedules } from "../../../lib/games-venue-map";
import { MOSCOW_BUNDLE } from "../../../lib/radar-map-assets";
import { VenueCover } from "../venues/VenueCover";
import { DiscoveryGameCard } from "../discovery/DiscoveryGameCard";
import { Button } from "../Button";
const MapView = dynamic(() => import("./GamesVenueMap").then(module => module.GamesVenueMap), { ssr: false });

/** Public venues never depend on Radar consent, a location fix or a people query. */
export function GamesMapView({ cityId, day }: { cityId: string; day: string }) {
  const [snapshot, setSnapshot] = useState<{ cityId: string; venues: VenueSummary[]; games: Game[]; gamesReady: boolean } | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    const clock = setInterval(() => setNow(Date.now()), 1000);
    const timer = setInterval(() => { setNow(Date.now()); setRefresh(n => n + 1); }, 30000);
    const reload = () => { setNow(Date.now()); setRefresh(n => n + 1); };
    window.addEventListener("focus", reload); window.addEventListener("online", reload);
    window.addEventListener("gb-session-changed", reload);
    return () => { clearInterval(clock); clearInterval(timer); window.removeEventListener("focus", reload); window.removeEventListener("online", reload); window.removeEventListener("gb-session-changed", reload); };
  }, []);
  useEffect(() => {
    let active = true; setLoading(true); setError(false); setSnapshot(null);
    void Promise.all([listAllCityVenues(cityId), listAllUpcomingCityGames(cityId)]).then(([venues, games]) => {
      if (!active) return;
      if (!venues.ok) { setError(true); setLoading(false); return; }
      setError(!games.ok);
      setSnapshot({ cityId, venues: venues.data, games: games.ok ? games.data : [], gamesReady: games.ok }); setNow(Date.now()); setLoading(false);
    }).catch(() => { if (active) { setError(true); setLoading(false); } });
    return () => { active = false; };
  }, [cityId, refresh]);
  const venues = snapshot?.cityId === cityId ? snapshot.venues : [];
  const games = snapshot?.cityId === cityId ? snapshot.games : [];
  const all = useMemo(() => venueSchedules(venues, games, "", now), [venues, games, now]);
  const schedules = useMemo(() => venueSchedules(venues, games, day, now), [venues, games, day, now]);
  const counts = useMemo(() => new Map([...schedules].map(([id, games]) => [id, games.length])), [schedules]);
  const venue = venues.find(venue => venue.id === selected);
  return <section aria-label="Игры на карте">
    <p className="gb-discovery-helper">Все площадки города. Число на маркере — доступные публичные игры{day ? " в выбранную дату" : ""}. Места и права проверяются при открытии игры.</p>
    <Button variant="outline" onClick={() => setRefresh(n => n + 1)} disabled={loading}>Обновить карту и расписание</Button>
    {loading && <p role="status">Загружаем все площадки и расписание…</p>}
    {error && <p role="alert">Не удалось загрузить полный каталог или расписание. Проверьте соединение и повторите. Непроверенные количества не показываем.</p>}
    {snapshot?.cityId === cityId && <>
      {cityId === MOSCOW_BUNDLE.cityId ? <MapView venues={venues} counts={counts} onSelect={venue => setSelected(venue.id)} /> : <p role="status">Карта выбранного города пока недоступна. Все площадки доступны списком.</p>}
      {venues.some(venue => typeof venue.latitude !== "number" || typeof venue.longitude !== "number") && <p role="status">Для части площадок нет координат: они доступны в списке ниже.</p>}
      {!venues.length && <p role="status">В каталоге города пока нет площадок.</p>}
      <div className="gb-discovery-chips" role="group" aria-label="Все площадки города">{venues.map(venue => <button className="gb-discovery-chip" type="button" key={venue.id} aria-pressed={selected === venue.id} onClick={() => setSelected(venue.id)}>{venue.name} · {snapshot.gamesReady ? counts.get(venue.id) ?? 0 : "?"}</button>)}</div>
      {venue && <article className="gb-discovery-state" aria-label={`Площадка: ${venue.name}`}>
        <VenueCover name={venue.name} cover={venue.cover} /><h2>{venue.name}</h2><p>{venue.address}</p>
        <Button variant="outline" href={`/venues/${encodeURIComponent(venue.id)}`}>О площадке</Button>
        <Button href={`/games/create?venueId=${encodeURIComponent(venue.id)}`}>Создать игру на этой площадке</Button>
        <h3>Расписание · {venue.timezone}</h3>
        {!snapshot.gamesReady && <p role="status">Расписание временно недоступно.</p>}
        {snapshot.gamesReady && !schedules.get(venue.id)?.length && <p>{day && all.get(venue.id)?.length ? "Нет игр в выбранную дату" : "Нет предстоящих доступных игр"}</p>}
        <div className="gb-discovery-cards">{schedules.get(venue.id)?.map(game => <DiscoveryGameCard key={game.id} game={game} />)}</div>
      </article>}
    </>}
  </section>;
}
