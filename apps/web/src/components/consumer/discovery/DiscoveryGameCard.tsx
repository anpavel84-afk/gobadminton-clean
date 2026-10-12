/* canonical local editorial imagery, not a photo of this venue. */
import { GameShare } from "../games/GameShare";
import Link from "next/link";
import type { Game } from "../../../lib/consumer-types";
import { formatSeats, isTrainerLed, settlementTerms } from "../../../lib/game-presentation";
import { discoveryFormat, discoveryGameWhen } from "../../../lib/discovery-presentation";
import { DiscoveryIcon } from "./DiscoveryComposition";

export function DiscoveryGameCard({ game }: { game: Game }) {
  const trainer = isTrainerLed(game);
  const host = trainer && game.trainer ? game.trainer.displayName : game.organizer.displayName;
  const when = discoveryGameWhen(game);
  const format = discoveryFormat(game.formatKey);
  const initials = host.trim().split(/\s+/).slice(0, 2).map(p => p[0]).join("");
  return <article className={`gb-discovery-card${trainer ? " gb-discovery-card--trainer" : ""}`} data-activity={game.activityKind}>
    <div className="gb-discovery-card__image">
      <img src={`/discovery/${trainer ? "badminton-courts" : "badminton-gear"}.jpg`} alt="" loading="lazy" />
      <span className="gb-discovery-type">{trainer ? "С тренером" : "Обычная игра"}</span>
    </div>
    <div className="gb-discovery-card__content">
      <div className="gb-discovery-card__topline"><span>{when.day}</span><span className="gb-discovery-spots" data-full={game.availablePlaces <= 0 || game.status !== "published"}>{formatSeats(game)}</span></div>
      <strong className="gb-discovery-card__time">{when.time}</strong>
      <h3><Link href={`/games/${game.id}`}>{game.title}</Link></h3>
      <p className="gb-discovery-venue">{game.venue.name}</p>
      <p className="gb-discovery-address"><DiscoveryIcon name="pin" />{game.venue.address}</p>
      <div className="gb-discovery-meta"><span>Уровень: {game.levelRule.allowedLevelIds.join(", ")}</span>{format && <span>{format}</span>}</div>
      <p className="gb-discovery-terms">{settlementTerms(game.settlement)}</p>
      <div className="gb-discovery-host">
        <span className="gb-discovery-avatar" aria-hidden="true">{initials}</span>
        <span><small>{trainer && game.trainer ? "Тренер" : "Организатор"}</small><strong>{host}</strong></span>
        <div className="gb-discovery-card__actions"><Link className={`gb-c23-btn gb-c23-btn--${trainer ? "dark" : "outline"}`} href={`/games/${game.id}`} aria-label={`Подробнее: ${game.title}`}><span>Подробнее</span><DiscoveryIcon name="arrow" /></Link><GameShare gameId={game.id} /></div>
      </div>
    </div>
  </article>;
}
