import type { Game, VenueSummary } from "../../../lib/consumer-types";
import { venueCreatePath } from "../../../lib/games-venue-map";
import { VenueCover } from "../venues/VenueCover";
import { DiscoveryGameCard } from "../discovery/DiscoveryGameCard";
import { Button } from "../Button";
import "../../../styles/venue-schedule-card.css";

/** Kit ContentCard image-top + SectionHeader + GameCard; see #28 parity record. */
export function VenueScheduleCard({ venue, games, gamesReady, day, hasUpcoming, scheduleOnly = false }: {
  venue: VenueSummary; games: Game[]; gamesReady: boolean; day: string; hasUpcoming: boolean; scheduleOnly?: boolean;
}) {
  return <article className="gb-venue-schedule" aria-label={`Площадка: ${venue.name}`}>
    {!scheduleOnly && <VenueCover name={venue.name} cover={venue.cover} />}
    <div className="gb-venue-schedule__body">
      {!scheduleOnly && <header><h2>{venue.name}</h2><p>{venue.address}</p></header>}
      <div className="gb-venue-schedule__actions">
        {!scheduleOnly && <Button variant="outline" href={`/venues/${encodeURIComponent(venue.id)}`}>О площадке</Button>}
        <Button href={venueCreatePath(new URLSearchParams({ venueId: venue.id }).toString())}>Создать игру на этой площадке</Button>
      </div>
      <h3>Расписание · {venue.timezone}</h3>
      {!gamesReady ? <p role="status">Расписание временно недоступно.</p> : <>
        {!games.length && <p>{day && hasUpcoming ? "Нет игр в выбранную дату" : "Нет предстоящих доступных игр"}</p>}
        <div className="gb-discovery-cards">{games.map(game => <DiscoveryGameCard key={game.id} game={game} />)}</div>
      </>}
    </div>
  </article>;
}
